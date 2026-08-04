import * as vscode from "vscode";

import type { ContextOperation, ContextPackage } from "@core/context/contextEngine";
import {
  COPILOT_RESPONSE_TOOL,
  COPILOT_RESPONSE_TOOL_NAME,
  normalizeCopilotResponse,
  parseCopilotResponse,
  type CopilotResponseEnvelope,
  type StructuredResponseSource
} from "@core/copilot/responseContract";
import { KEYSTONE_CONTEXT_TOOL_NAME } from "./keystoneContextTool";

export type DelegationOperation = ContextOperation | "CONTINUE";

export interface CopilotDelegationRequest {
  intentId: string;
  operation: DelegationOperation;
  objective: string;
  userInput?: string;
  expectedResponseType?: string;
  /** Optional only for continuing an already prepared interaction. */
  contextPackageId?: string;
  cancellationToken?: vscode.CancellationToken;
}

export interface DelegationContext {
  contextPackage: ContextPackage;
  /** Durable Intent state for a continuation; raw Copilot conversation is never reused. */
  continuationPrompt?: string;
}

export type DelegationContextResolver = (
  request: CopilotDelegationRequest,
  token: vscode.CancellationToken
) => Promise<DelegationContext>;

export interface CopilotDelegationCallbacks {
  /** Only user-visible response text is streamed. Tool/API protocol parts stay internal. */
  onText(text: string): void;
  onContextExpansion(input: unknown, turn: number): void;
  onActivity?(stage: string, message: string, progress: number): void;
}

export interface DelegationObservability {
  intentId: string;
  operation: DelegationOperation;
  contextPackageId?: string;
  contextUsage?: CopilotDelegationResult["contextUsage"];
  model?: CopilotDelegationResult["model"];
  startState: "started";
  endState: "completed" | "cancelled" | "failed";
  errorCode?:
    "no-model" | "access-denied" | "cancelled" | "model-failed" | "context-preparation-failed";
}

export interface CopilotDelegationResult {
  success: boolean;
  captured: boolean;
  text?: string;
  structured?: CopilotResponseEnvelope;
  structuredStatus?: "complete" | "partial" | "absent";
  structuredSource?: StructuredResponseSource;
  structuredWarning?: string;
  model?: { id: string; vendor?: string; family?: string; version?: string; name?: string };
  contextPackageId?: string;
  contextUsage?: {
    estimatedTransmittedTokens: number;
    allCandidateCount: number;
    transmittedCandidateCount: number;
    retainedCandidateCount: number;
    omittedContextCount: number;
  };
  startedAt: string;
  completedAt: string;
  cancellation?: "requested" | "cancelled";
  error?: string;
  observability: DelegationObservability;
}

const CONTEXT_TOOL = {
  name: KEYSTONE_CONTEXT_TOOL_NAME,
  description:
    "Retrieve the smallest missing repository fact from Keystone's prepared ContextPackage.",
  inputSchema: {
    type: "object",
    properties: {
      packageId: { type: "string" },
      operation: {
        type: "string",
        enum: [
          "get_intelligence",
          "get_symbols",
          "get_relationships",
          "get_flows",
          "get_impact",
          "get_intent",
          "expand_context"
        ]
      },
      query: { type: "string" },
      contextReference: { type: "string" },
      level: { type: "string" },
      limit: { type: "number" }
    },
    required: ["packageId", "operation"]
  }
} as const;

/**
 * Keystone's single boundary to the VS Code Language Model API.
 * Context selection and prompt assembly happen here; callers provide Intent intent,
 * not an independently constructed Copilot prompt.
 */
export class CopilotDelegationService {
  private active?: vscode.CancellationTokenSource;

  constructor(private readonly resolveContext: DelegationContextResolver) {}

  async delegate(
    request: CopilotDelegationRequest,
    callbacks: CopilotDelegationCallbacks
  ): Promise<CopilotDelegationResult> {
    const startedAt = new Date().toISOString();
    const cancellation = new vscode.CancellationTokenSource();
    const externalCancellation = request.cancellationToken?.onCancellationRequested(() =>
      cancellation.cancel()
    );
    this.active = cancellation;
    let contextPackageId: string | undefined;
    let modelMetadata: CopilotDelegationResult["model"];
    let contextUsage: CopilotDelegationResult["contextUsage"];
    let knownEvidence: ContextPackage["evidence"] | undefined;
    let rawText = "";
    let streamedReadableLength = 0;
    let contextResolutionFailed = false;
    let structuredResponse: ReturnType<typeof normalizeCopilotResponse> | undefined;

    const finish = (
      result: Omit<CopilotDelegationResult, "startedAt" | "completedAt" | "observability">
    ): CopilotDelegationResult => {
      const completedAt = new Date().toISOString();
      return {
        ...result,
        startedAt,
        completedAt,
        observability: {
          intentId: request.intentId,
          operation: request.operation,
          contextPackageId,
          contextUsage,
          model: modelMetadata,
          startState: "started",
          endState:
            result.cancellation === "cancelled"
              ? "cancelled"
              : result.success
                ? "completed"
                : "failed",
          ...(result.error && !result.cancellation
            ? { errorCode: classifyErrorCode(result.error) }
            : {}),
          ...(result.cancellation ? { errorCode: "cancelled" as const } : {})
        }
      };
    };

    try {
      callbacks.onActivity?.("context-preparing", "Preparing the approved ContextPackage", 8);
      contextResolutionFailed = true;
      const context = await this.resolveContext(request, cancellation.token);
      contextResolutionFailed = false;
      if (cancellation.token.isCancellationRequested) throw new CopilotDelegationCancelledError();
      contextPackageId = context.contextPackage.id;
      knownEvidence = context.contextPackage.evidence;
      contextUsage = contextUsageFor(context.contextPackage);
      callbacks.onActivity?.("context-ready", "ContextPackage ready for Copilot", 15);

      const models = await vscode.lm.selectChatModels({ vendor: "copilot" });
      if (cancellation.token.isCancellationRequested) throw new CopilotDelegationCancelledError();
      const model = selectDefaultModel(models);
      if (!model) {
        const error =
          "No Copilot-backed language model is available. Sign in to Copilot or enable a Copilot model, then try again.";
        return finish({ success: false, captured: false, contextPackageId, contextUsage, error });
      }
      modelMetadata = modelMetadataFor(model);
      callbacks.onActivity?.(
        "model-selected",
        `Using ${model.name || model.family || model.id}`,
        22
      );

      const prompt = buildDelegationPrompt(request, context, contextPackageId, model);
      callbacks.onActivity?.("request-started", "Sending the bounded request to Copilot", 28);
      let messages: vscode.LanguageModelChatMessage[] = [
        vscode.LanguageModelChatMessage.User(prompt)
      ];
      const contextTool =
        vscode.lm.tools.find((item) => item.name === KEYSTONE_CONTEXT_TOOL_NAME) ?? CONTEXT_TOOL;
      const responseTool = COPILOT_RESPONSE_TOOL as unknown as vscode.LanguageModelChatTool;
      for (let turn = 0; turn < 8; turn += 1) {
        if (cancellation.token.isCancellationRequested) throw new CopilotDelegationCancelledError();
        const response = await model.sendRequest(
          messages,
          {
            tools: [contextTool, responseTool],
            justification:
              "Keystone is delegating a user-approved Intent with bounded repository context."
          },
          cancellation.token
        );
        const assistantParts: unknown[] = [];
        const toolCalls: vscode.LanguageModelToolCallPart[] = [];
        for await (const part of response.stream) {
          if (cancellation.token.isCancellationRequested)
            throw new CopilotDelegationCancelledError();
          if (part instanceof vscode.LanguageModelTextPart) {
            rawText += part.value;
            assistantParts.push(part);
            streamedReadableLength = streamReadableText(rawText, streamedReadableLength, callbacks);
            callbacks.onActivity?.(
              "streaming",
              "Streaming Copilot response",
              35 + Math.min(45, Math.ceil(rawText.length / 160))
            );
          } else if (part instanceof vscode.LanguageModelToolCallPart) {
            assistantParts.push(part);
            if (part.name === COPILOT_RESPONSE_TOOL_NAME) {
              structuredResponse = normalizeCopilotResponse(part.input, rawText, {
                operation: request.operation,
                knownEvidence: context.contextPackage.evidence,
                source: "language-model-tool"
              });
              callbacks.onActivity?.(
                "structured-result",
                structuredResponse.structuredStatus === "complete"
                  ? "Structured Copilot outcome captured"
                  : "Readable Copilot response captured; structured outcome is incomplete",
                88
              );
            } else {
              toolCalls.push(part);
            }
          } else if (typeof part === "string") {
            rawText += part;
            assistantParts.push(part);
            streamedReadableLength = streamReadableText(rawText, streamedReadableLength, callbacks);
          }
        }
        if (structuredResponse || !toolCalls.length) break;
        messages = [...messages, vscode.LanguageModelChatMessage.Assistant(assistantParts)];
        for (const call of toolCalls) {
          if (cancellation.token.isCancellationRequested)
            throw new CopilotDelegationCancelledError();
          callbacks.onActivity?.(
            "context-retrieval",
            "Inspecting a targeted Keystone context expansion",
            52
          );
          callbacks.onContextExpansion(call.input, turn);
          const toolResult = await vscode.lm.invokeTool(
            call.name,
            { input: call.input, toolInvocationToken: undefined },
            cancellation.token
          );
          messages.push(
            vscode.LanguageModelChatMessage.User([
              new vscode.LanguageModelToolResultPart(call.callId, toolResult.content)
            ])
          );
        }
      }
      if (cancellation.token.isCancellationRequested) throw new CopilotDelegationCancelledError();
      const parsed =
        structuredResponse ??
        parseCopilotResponse(rawText, {
          operation: request.operation,
          knownEvidence,
          source: "json-recovery"
        });
      callbacks.onActivity?.("response-ready", "Copilot response received", 90);
      return finish({
        success: true,
        captured: true,
        text: parsed.readableText,
        structured: parsed.structured,
        structuredStatus: parsed.structuredStatus,
        structuredSource: parsed.structuredSource,
        structuredWarning: parsed.warning,
        model: modelMetadata,
        contextPackageId,
        contextUsage
      });
    } catch (error) {
      if (
        error instanceof CopilotDelegationCancelledError ||
        cancellation.token.isCancellationRequested
      ) {
        const parsed = rawText
          ? parseCopilotResponse(rawText, {
              operation: request.operation,
              knownEvidence,
              source: "json-recovery"
            })
          : structuredResponse;
        callbacks.onActivity?.("cancelled", "Copilot operation stopped", 100);
        return finish({
          success: false,
          captured: false,
          text: parsed?.readableText,
          structured: parsed?.structured,
          structuredStatus: parsed?.structuredStatus,
          structuredSource: parsed?.structuredSource,
          structuredWarning: parsed?.warning,
          model: modelMetadata,
          contextPackageId,
          contextUsage,
          cancellation: "cancelled",
          error: "Copilot operation was cancelled."
        });
      }
      const message = actionableError(error, contextPackageId, contextResolutionFailed);
      callbacks.onActivity?.("failed", message, 100);
      return finish({
        success: false,
        captured: false,
        model: modelMetadata,
        contextPackageId,
        contextUsage,
        error: message
      });
    } finally {
      externalCancellation?.dispose();
      if (this.active === cancellation) this.active = undefined;
      cancellation.dispose();
    }
  }

  cancel(): void {
    this.active?.cancel();
  }
}

export class CopilotDelegationCancelledError extends Error {
  constructor() {
    super("Copilot operation was cancelled.");
    this.name = "CopilotDelegationCancelledError";
  }
}

function selectDefaultModel(
  models: readonly vscode.LanguageModelChat[]
): vscode.LanguageModelChat | undefined {
  return [...models].sort((left, right) => {
    const score = (model: vscode.LanguageModelChat): number => {
      const family = `${model.family} ${model.name}`.toLowerCase();
      return (
        (family.includes("code") ? 3 : 0) +
        (family.includes("gpt-4") ? 2 : 0) +
        Math.min(2, Math.floor((model.maxInputTokens || 0) / 32_000))
      );
    };
    return score(right) - score(left) || left.id.localeCompare(right.id);
  })[0];
}

function modelMetadataFor(model: vscode.LanguageModelChat): CopilotDelegationResult["model"] {
  return {
    id: model.id,
    vendor: model.vendor,
    family: model.family,
    version: model.version,
    name: model.name
  };
}

function contextUsageFor(contextPackage: ContextPackage): CopilotDelegationResult["contextUsage"] {
  return {
    estimatedTransmittedTokens: contextPackage.estimatedTransmittedTokens,
    allCandidateCount: contextPackage.allCandidateCount,
    transmittedCandidateCount: contextPackage.transmittedContext.length,
    retainedCandidateCount: contextPackage.retainedContext.length,
    omittedContextCount: contextPackage.omittedContext.length
  };
}

function buildDelegationPrompt(
  request: CopilotDelegationRequest,
  context: DelegationContext,
  contextPackageId: string,
  model: vscode.LanguageModelChat
): string {
  const contextPackage = context.contextPackage;
  const modelInputBudget = model.maxInputTokens || 4_096;
  // The selected model's input limit includes the instruction envelope and room for a
  // response/tool turn. Keep the transmitted package conservative; retained context stays
  // available through keystone_get_context using the same package ID.
  const contextBudget = Math.max(800, Math.min(2_200, Math.floor(modelInputBudget * 0.45)));
  const boundedContent = boundedContextContent(contextPackage.content, contextBudget);
  return [
    "You are GitHub Copilot executing a user-approved Keystone delegation inside VS Code.",
    request.operation === "CONTINUE"
      ? "Continue the existing Intent from durable state; do not reconstruct or request the prior raw conversation."
      : "Keystone has completed repository intelligence and Intent preparation. Treat the bounded ContextPackage below as the source of repository-specific facts.",
    "Use Keystone targeted retrieval only when a fact is missing. Do not perform broad repository search, dump the repository, or invent evidence.",
    "Return a concise human-readable explanation in text. Then call keystone_record_structured_response once with the durable outcome. Use the operation-specific details shape when useful: UNDERSTAND_INTENT (understanding, likelyScope, constraintsDetected, repositoryEvidence), PLAN_CHANGE (approach, affectedAreas, dependencies, risks, proposedActions), IMPLEMENT (workPerformed, changedAreas, unresolvedIssues, nextAction), or REVIEW_CHANGE (findings, severity, evidence, recommendation). Keep every model-generated statement a COPILOT_RECOMMENDATION unless its evidence reference matches the supplied ContextPackage; never invent source facts or evidence IDs. If the structured call cannot be completed, the readable text remains the authoritative user-facing response.",
    `Intent ID: ${request.intentId}`,
    `Operation: ${request.operation}`,
    `Objective: ${request.objective}`,
    request.expectedResponseType ? `Expected response type: ${request.expectedResponseType}` : "",
    request.userInput ? `User request: ${request.userInput}` : "",
    context.contextPackage.intent.text ? `Intent: ${context.contextPackage.intent.text}` : "",
    context.continuationPrompt ? `Durable Intent continuation:\n${context.continuationPrompt}` : "",
    `Approved ContextPackage ${contextPackageId} (estimated ${contextPackage.estimatedTransmittedTokens} transmitted tokens):`,
    boundedContent
  ]
    .filter(Boolean)
    .join("\n\n");
}

function boundedContextContent(content: string, tokenBudget: number): string {
  const characterBudget = Math.max(3_200, tokenBudget * 4);
  if (content.length <= characterBudget) return content;
  return `${content.slice(0, characterBudget).trim()}\n\n[Keystone transmitted a bounded prefix for this model input limit. Use keystone_get_context with the same ContextPackage ID for a targeted retained-context expansion.]`;
}

function streamReadableText(
  rawText: string,
  lastStreamedLength: number,
  callbacks: CopilotDelegationCallbacks
): number {
  const structuredStart = rawText.search(
    /```(?:json)?\s*|\{\s*"(?:summary|findings|recommendation|userVisibleResponse)"\s*:/i
  );
  const visible = (structuredStart >= 0 ? rawText.slice(0, structuredStart) : rawText).trimStart();
  if (visible.length <= lastStreamedLength) return lastStreamedLength;
  callbacks.onText(visible.slice(lastStreamedLength));
  return visible.length;
}

function actionableError(
  error: unknown,
  contextPackageId?: string,
  contextResolutionFailed = false
): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/denied|permission|consent|not authorized|access/i.test(raw))
    return "Copilot access was denied. Allow the model request in VS Code and try the Intent again.";
  if (contextResolutionFailed || /context|package|stale|snapshot|intelligence/i.test(raw))
    return `Context preparation failed${contextPackageId ? ` for ${contextPackageId}` : ""}: ${raw} Regenerate the Intent context, then retry.`;
  return `Copilot model request failed: ${raw} Check Copilot availability and try again.`;
}

function classifyErrorCode(error: string): DelegationObservability["errorCode"] {
  if (/no Copilot-backed language model/i.test(error)) return "no-model";
  if (/access was denied/i.test(error)) return "access-denied";
  if (/context preparation failed/i.test(error)) return "context-preparation-failed";
  return "model-failed";
}
