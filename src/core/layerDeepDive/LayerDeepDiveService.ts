import { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { CopilotAdapter } from "../copilot/CopilotAdapter";
import type { LayerDeepDivePersistence } from "../persistence/LayerDeepDivePersistence";
import type { LayerDeepDiveRequest, LayerDeepDiveResponse, LayerDeepDiveLayer } from "../../shared/contracts/layerDeepDive";

export interface LayerDeepDiveServices {
  copilot: CopilotAdapter;
  persistence: LayerDeepDivePersistence;
  logger: KeystoneLogger;
  contextForLayer?: (layer: LayerDeepDiveLayer, workflowId: string) => Promise<string>;
}

export class LayerDeepDiveService {
  constructor(private readonly services: LayerDeepDiveServices) {}

  async start(input: LayerDeepDiveRequest): Promise<LayerDeepDiveResponse> {
    const now = new Date().toISOString();
    const context = await this.buildContext(input);

    const response: LayerDeepDiveResponse = {
      schemaVersion: 1,
      id: crypto.randomUUID(),
      requestId: input.id,
      workflowId: input.workflowId,
      layer: input.layer,
      status: "queued",
      prompt: input.prompt,
      contextSummary: context,
      recommendation: undefined,
      structuredFindings: [],
      evidenceIds: [],
      confidence: undefined,
      copilotResponse: undefined,
      errors: [],
      createdAt: now,
      updatedAt: now,
      contentHash: "",
    };

    if (!input.delegateToCopilot) {
      const finished = { ...response, status: "complete" as const, finishedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), contentHash: "" };
      return this.persistResponse(input, finished);
    }

    const running = { ...response, status: "running" as const, updatedAt: new Date().toISOString(), startedAt: new Date().toISOString(), contentHash: "" };
    await this.services.persistence.update((state) => ({
      ...state,
      requests: [...state.requests, input],
      responses: [...state.responses, this.persistShape(running)],
    }));

    try {
      const copilotResponse = await this.delegateToCopilot(input, context);
      const finished: LayerDeepDiveResponse = {
        ...running,
        status: "complete",
        recommendation: copilotResponse.recommendation,
        structuredFindings: copilotResponse.structuredFindings,
        confidence: copilotResponse.confidence,
        delegationMode: copilotResponse.delegationMode,
        copilotResponse: copilotResponse.text,
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "",
      };
      return this.persistResponse(input, finished);
    }
    catch (error) {
      const failed: LayerDeepDiveResponse = {
        ...running,
        status: "failed",
        errors: [error instanceof Error ? error.message : String(error)],
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "",
      };
      return this.persistResponse(input, failed);
    }
  }

  async findByWorkflow(workflowId: string): Promise<LayerDeepDiveResponse[]> {
    return this.services.persistence.snapshot.responses.filter((item) => item.workflowId === workflowId);
  }

  private async buildContext(input: LayerDeepDiveRequest): Promise<string> {
    const layer = input.layer.toUpperCase();
    const focus = input.contextFocus.length > 0 ? input.contextFocus.join(", ") : "general scoped context";
    return [
      `Layer: ${layer}`,
      `Workflow: ${input.workflowId}`,
      `Focus: ${focus}`,
      `Prompt: ${input.prompt}`,
      "Bound context: intelligence-derived symbols, changed files, and relevant findings only.",
    ].join("\n");
  }

  private async delegateToCopilot(
    input: LayerDeepDiveRequest,
    context: string,
  ): Promise<{
    text: string;
    recommendation: string;
    structuredFindings: unknown[];
    confidence: number;
    delegationMode: "direct" | "assisted" | "clipboard";
  }> {
    const prompt = [
      "You are Keystone's layer deep-dive reviewer.",
      context,
      input.prompt,
      "Return only concise findings with file references and recommended fixes.",
    ].join("\n\n");

    const capabilities = this.services.copilot.getCapabilities();
    if (capabilities?.promptInsertionAvailable) {
      await this.services.copilot.insertPrompt(prompt);
      return {
        text: `Inserted ${input.layer} deep-dive prompt into Copilot.`,
        recommendation: "Review inserted prompt in Copilot.",
        structuredFindings: [],
        confidence: 0.5,
        delegationMode: "assisted",
      };
    }

    await this.services.copilot.copyPrompt(prompt);
    return {
      text: `Copied ${input.layer} deep-dive prompt to clipboard.`,
      recommendation: "Paste into Copilot manually.",
      structuredFindings: [],
      confidence: 0.3,
      delegationMode: "clipboard",
    };
  }

  private persistShape(response: LayerDeepDiveResponse): LayerDeepDiveResponse {
    return { ...response, contentHash: crypto.randomUUID() };
  }

  private async persistResponse(input: LayerDeepDiveRequest, response: LayerDeepDiveResponse): Promise<LayerDeepDiveResponse> {
    await this.services.persistence.update((state) => ({
      ...state,
      requests: [...state.requests, input],
      responses: [...state.responses, this.persistShape(response)],
    }));
    return response;
  }
}
