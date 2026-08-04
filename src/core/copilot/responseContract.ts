import type { ContextEvidenceReference, ContextOperation } from "../context/contextEngine";

export type CopilotProvenance =
  | "SOURCE_FACT"
  | "DERIVED_INTERPRETATION"
  | "COPILOT_RECOMMENDATION"
  | "USER_ACCEPTED_DECISION";

/** Evidence is only a SOURCE_FACT when Keystone can match it to the prepared ContextPackage. */
export interface CopilotEvidenceReference extends ContextEvidenceReference {
  provenance: CopilotProvenance;
  source: "context-package" | "copilot-assertion";
  verifiedAgainstContext: boolean;
}

export interface CopilotFinding {
  summary: string;
  severity?: "info" | "low" | "medium" | "high" | "critical";
  evidence?: CopilotEvidenceReference[];
  /** The model's claim is never promoted to a Keystone source fact automatically. */
  provenance: "COPILOT_RECOMMENDATION";
  claimedProvenance?: CopilotProvenance;
}

export interface CopilotDecisionProposal {
  title: string;
  recommendation: string;
  reason?: string;
  evidence?: CopilotEvidenceReference[];
  provenance: "COPILOT_RECOMMENDATION";
}

export interface CopilotScopeChangeProposal {
  summary: string;
  affectedAreas: string[];
  reason?: string;
  options: Array<"EXPAND_SCOPE" | "KEEP_CURRENT_SCOPE" | "CREATE_FOLLOW_UP" | "DISCUSS">;
}

export interface UnderstandIntentResponseDetails {
  operation: "UNDERSTAND_INTENT";
  understanding?: string;
  likelyScope?: string[];
  constraintsDetected?: string[];
  questions?: string[];
  repositoryEvidence?: CopilotEvidenceReference[];
}

export interface PlanChangeResponseDetails {
  operation: "PLAN_CHANGE";
  approach?: string;
  affectedAreas?: string[];
  dependencies?: string[];
  risks?: string[];
  proposedActions?: string[];
}

export interface ImplementResponseDetails {
  operation: "IMPLEMENT";
  workPerformed?: string[];
  changedAreas?: string[];
  unresolvedIssues?: string[];
  nextAction?: string;
}

export interface ReviewChangeResponseDetails {
  operation: "REVIEW_CHANGE";
  findings?: CopilotFinding[];
  severity?: "info" | "low" | "medium" | "high" | "critical";
  evidence?: CopilotEvidenceReference[];
  recommendation?: string;
}

export type CopilotOperationResponseDetails =
  | UnderstandIntentResponseDetails
  | PlanChangeResponseDetails
  | ImplementResponseDetails
  | ReviewChangeResponseDetails
  | { operation: Exclude<ContextOperation, "UNDERSTAND_INTENT" | "PLAN_CHANGE" | "IMPLEMENT" | "REVIEW_CHANGE">; [key: string]: unknown };

/** Common, intentionally sparse durable envelope returned by a Copilot interaction. */
export interface CopilotResponseEnvelope {
  summary?: string;
  findings?: CopilotFinding[];
  recommendation?: string;
  affectedAreas?: string[];
  risks?: string[];
  blockers?: string[];
  decisionsProposed?: CopilotDecisionProposal[];
  questions?: string[];
  proposedActions?: string[];
  scopeChange?: CopilotScopeChangeProposal;
  artifacts?: string[];
  evidenceReferences?: CopilotEvidenceReference[];
  userVisibleResponse: string;
  /** Model output is an assertion until the user accepts it into Intent state. */
  provenance: "COPILOT_RECOMMENDATION";
  claimedProvenance?: CopilotProvenance;
  structuredStatus: "complete" | "partial" | "absent";
  operation?: string;
  details?: CopilotOperationResponseDetails;
}

export type StructuredResponseSource = "language-model-tool" | "json-recovery";

export interface ParsedCopilotResponse {
  readableText: string;
  structured?: CopilotResponseEnvelope;
  structuredStatus: "complete" | "partial" | "absent";
  structuredSource?: StructuredResponseSource;
  warning?: string;
}

export interface ResponseContractParseOptions {
  operation?: string;
  knownEvidence?: readonly ContextEvidenceReference[];
  source?: StructuredResponseSource;
}

export const COPILOT_RESPONSE_TOOL_NAME = "keystone_record_structured_response";

/** Passed directly to vscode.lm.sendRequest; the tool call gives Keystone structured data. */
export const COPILOT_RESPONSE_TOOL = {
  name: COPILOT_RESPONSE_TOOL_NAME,
  description:
    "Record the structured durable outcome of the current Keystone operation. Use only facts supported by the supplied ContextPackage and keep recommendations marked as recommendations.",
  inputSchema: {
    type: "object",
    properties: {
      summary: { type: "string" },
      findings: { type: "array", items: { type: "object" } },
      recommendation: { type: "string" },
      affectedAreas: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      blockers: { type: "array", items: { type: "string" } },
      decisionsProposed: { type: "array", items: { type: "object" } },
      questions: { type: "array", items: { type: "string" } },
      proposedActions: { type: "array", items: { type: "string" } },
      scopeChange: { type: "object" },
      artifacts: { type: "array", items: { type: "string" } },
      evidenceReferences: { type: "array", items: { type: "object" } },
      userVisibleResponse: { type: "string" },
      provenance: { type: "string" },
      operation: { type: "string" },
      details: { type: "object" }
    },
    additionalProperties: true
  }
} as const;

const fieldNames = [
  "summary",
  "findings",
  "recommendation",
  "affectedAreas",
  "risks",
  "blockers",
  "decisionsProposed",
  "questions",
  "proposedActions",
  "scopeChange",
  "artifacts",
  "evidenceReferences",
  "userVisibleResponse",
  "provenance",
  "operation",
  "details"
] as const;

/**
 * Parses a fallback JSON response without making JSON the normal user experience.
 * Tool-call input should be passed with source="language-model-tool".
 */
export function parseCopilotResponse(
  text: string,
  options: ResponseContractParseOptions = {}
): ParsedCopilotResponse {
  const readableText = text.trim();
  const candidates = [readableText, extractJsonBlock(readableText)].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index
  );
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (!isRecord(value)) continue;
      const normalized = normalizeEnvelope(value, readableText, options);
      if (normalized.envelope) {
        return {
          readableText: normalized.envelope.userVisibleResponse || readableText,
          structured: normalized.envelope,
          structuredStatus: normalized.status,
          structuredSource: options.source ?? "json-recovery",
          warning: normalized.warning
        };
      }
    } catch {
      // The model may have emitted partial JSON. The human-readable response remains valid.
    }
  }
  const hasStructuredHint = fieldNames.some((field) =>
    new RegExp(`"${field}"\\s*:`, "i").test(text)
  );
  return {
    readableText,
    structuredStatus: hasStructuredHint ? "partial" : "absent",
    warning: hasStructuredHint
      ? "Copilot returned a partially malformed structured response; readable text was preserved."
      : undefined
  };
}

/** Normalize tool-call input using the same contract and no model-generated source facts. */
export function normalizeCopilotResponse(
  value: unknown,
  readableText: string,
  options: ResponseContractParseOptions = {}
): ParsedCopilotResponse {
  if (!isRecord(value)) {
    return {
      readableText: readableText.trim(),
      structuredStatus: "partial",
      structuredSource: options.source ?? "language-model-tool",
      warning: "Copilot returned malformed structured data; readable response was preserved."
    };
  }
  const normalized = normalizeEnvelope(value, readableText.trim(), options);
  if (!normalized.envelope) {
    return {
      readableText: readableText.trim(),
      structuredStatus: "partial",
      structuredSource: options.source ?? "language-model-tool",
      warning: "Copilot returned an incomplete structured response; readable response was preserved."
    };
  }
  return {
    readableText: normalized.envelope.userVisibleResponse || readableText.trim(),
    structured: normalized.envelope,
    structuredStatus: normalized.status,
    structuredSource: options.source ?? "language-model-tool",
    warning: normalized.warning
  };
}

function normalizeEnvelope(
  value: Record<string, unknown>,
  fallback: string,
  options: ResponseContractParseOptions
): { envelope?: CopilotResponseEnvelope; status: "complete" | "partial"; warning?: string } {
  const hasKnownField = fieldNames.some((field) => field in value);
  if (!hasKnownField) return { status: "partial" };
  const userVisibleResponse = asString(value.userVisibleResponse) ?? fallback;
  const claimedProvenance = isProvenance(value.provenance) ? value.provenance : undefined;
  const warnings: string[] = [];
  if (!userVisibleResponse) warnings.push("No readable response was returned.");
  if (value.userVisibleResponse !== undefined && !asString(value.userVisibleResponse))
    warnings.push("userVisibleResponse was malformed.");
  for (const field of [
    "findings",
    "affectedAreas",
    "risks",
    "blockers",
    "decisionsProposed",
    "questions",
    "proposedActions",
    "artifacts",
    "evidenceReferences"
  ]) {
    if (value[field] !== undefined && !Array.isArray(value[field]))
      warnings.push(`${field} was malformed.`);
  }
  if (value.details !== undefined && !isRecord(value.details))
    warnings.push("operation details were malformed.");
  const findings = asFindings(value.findings, options);
  const decisions = asDecisions(value.decisionsProposed, options);
  const scopeChange = asScopeChange(value.scopeChange);
  if (Array.isArray(value.findings) && value.findings.some((item) => !isRecord(item)))
    warnings.push("findings contained malformed entries.");
  if (Array.isArray(value.decisionsProposed) && decisions === undefined)
    warnings.push("decisionsProposed was malformed.");
  if (
    Array.isArray(value.decisionsProposed) &&
    value.decisionsProposed.some(
      (item) => !isRecord(item) || !asString(item.title) || !asString(item.recommendation)
    )
  )
    warnings.push("decisionsProposed contained incomplete entries.");
  if (value.scopeChange !== undefined && scopeChange === undefined)
    warnings.push("scopeChange was malformed.");
  const evidenceReferences = asEvidence(value.evidenceReferences, options);
  const details = asDetails(value.details, options);
  const status = warnings.length ? "partial" : "complete";
  return {
    envelope: {
      summary: asString(value.summary),
      findings,
      recommendation: asString(value.recommendation),
      affectedAreas: asStrings(value.affectedAreas),
      risks: asStrings(value.risks),
      blockers: asStrings(value.blockers),
      decisionsProposed: decisions,
      questions: asStrings(value.questions),
      proposedActions: asStrings(value.proposedActions),
      scopeChange,
      artifacts: asStrings(value.artifacts),
      evidenceReferences,
      userVisibleResponse,
      provenance: "COPILOT_RECOMMENDATION",
      claimedProvenance,
      structuredStatus: status,
      operation: asString(value.operation) ?? options.operation,
      details
    },
    status,
    warning: warnings.length
      ? `Copilot returned a partially malformed structured response; readable response was preserved (${warnings.join(" ")})`
      : undefined
  };
}

function asFindings(value: unknown, options: ResponseContractParseOptions): CopilotFinding[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => ({
    summary: asString(item.summary) ?? asString(item.title) ?? "Unspecified finding",
    severity: isSeverity(item.severity) ? item.severity : undefined,
    evidence: asEvidence(item.evidence, options),
    provenance: "COPILOT_RECOMMENDATION" as const,
    claimedProvenance: isProvenance(item.provenance) ? item.provenance : undefined
  }));
}

function asDecisions(value: unknown, options: ResponseContractParseOptions): CopilotDecisionProposal[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const decisions = value.filter(isRecord).flatMap((item) => {
    const recommendation = asString(item.recommendation);
    const title = asString(item.title);
    if (!recommendation || !title) return [];
    return [{
      title,
      recommendation,
      reason: asString(item.reason),
      evidence: asEvidence(item.evidence, options),
      provenance: "COPILOT_RECOMMENDATION" as const
    }];
  });
  return decisions.length || value.length === 0 ? decisions : undefined;
}

function asScopeChange(value: unknown): CopilotScopeChangeProposal | undefined {
  if (!isRecord(value)) return undefined;
  const summary = asString(value.summary);
  const affectedAreas = asStrings(value.affectedAreas);
  if (!summary || !affectedAreas?.length) return undefined;
  const options = (asStrings(value.options) ?? []).filter(
    (item): item is CopilotScopeChangeProposal["options"][number] =>
      ["EXPAND_SCOPE", "KEEP_CURRENT_SCOPE", "CREATE_FOLLOW_UP", "DISCUSS"].includes(item)
  );
  return { summary, affectedAreas, reason: asString(value.reason), options };
}

function asEvidence(
  value: unknown,
  options: ResponseContractParseOptions
): CopilotEvidenceReference[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter(isRecord).map((item) => {
    const reference = {
      id: asString(item.id),
      entityId: asString(item.entityId),
      relationshipId: asString(item.relationshipId),
      flowId: asString(item.flowId),
      evidenceId: asString(item.evidenceId),
      kind: asString(item.kind) ?? "copilot-assertion",
      label: asString(item.label) ?? "Unspecified evidence",
      path: asString(item.path),
      startLine: asNumber(item.startLine),
      endLine: asNumber(item.endLine)
    } satisfies ContextEvidenceReference;
    const verifiedAgainstContext = Boolean(
      options.knownEvidence?.some((known) => sameEvidence(reference, known))
    );
    return {
      ...reference,
      provenance: verifiedAgainstContext ? ("SOURCE_FACT" as const) : ("COPILOT_RECOMMENDATION" as const),
      source: verifiedAgainstContext ? ("context-package" as const) : ("copilot-assertion" as const),
      verifiedAgainstContext
    };
  });
}

function asDetails(value: unknown, options: ResponseContractParseOptions): CopilotOperationResponseDetails | undefined {
  if (!isRecord(value)) return undefined;
  const operation = asString(value.operation) ?? options.operation;
  if (!operation) return undefined;
  return {
    ...value,
    operation,
    repositoryEvidence: asEvidence(value.repositoryEvidence, options),
    evidence: asEvidence(value.evidence, options),
    findings: asFindings(value.findings, options),
    affectedAreas: asStrings(value.affectedAreas),
    likelyScope: asStrings(value.likelyScope),
    constraintsDetected: asStrings(value.constraintsDetected),
    dependencies: asStrings(value.dependencies),
    risks: asStrings(value.risks),
    proposedActions: asStrings(value.proposedActions),
    workPerformed: asStrings(value.workPerformed),
    changedAreas: asStrings(value.changedAreas),
    unresolvedIssues: asStrings(value.unresolvedIssues),
    nextAction: asString(value.nextAction),
    understanding: asString(value.understanding),
    approach: asString(value.approach),
    recommendation: asString(value.recommendation),
    severity: isSeverity(value.severity) ? value.severity : undefined
  } as CopilotOperationResponseDetails;
}

function sameEvidence(left: ContextEvidenceReference, right: ContextEvidenceReference): boolean {
  const keys: Array<keyof ContextEvidenceReference> = [
    "id",
    "entityId",
    "relationshipId",
    "flowId",
    "evidenceId"
  ];
  if (keys.some((key) => left[key] && right[key] && left[key] === right[key])) return true;
  return Boolean(left.label && right.label && left.label === right.label && left.path === right.path);
}

function extractJsonBlock(text: string): string | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : undefined;
}

function asStrings(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isSeverity(value: unknown): value is CopilotFinding["severity"] {
  return ["info", "low", "medium", "high", "critical"].includes(value as string);
}
function isProvenance(value: unknown): value is CopilotProvenance {
  return [
    "SOURCE_FACT",
    "DERIVED_INTERPRETATION",
    "COPILOT_RECOMMENDATION",
    "USER_ACCEPTED_DECISION"
  ].includes(value as string);
}
