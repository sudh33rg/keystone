import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type { CopilotAdapter } from "../copilot/CopilotAdapter";
import type { WorkflowService } from "../workflow/WorkflowService";
import type { CanonicalWorkflow } from "../../shared/contracts/canonicalWorkflow";
import { canonicalWorkTypeLabel } from "../../shared/contracts/canonicalWorkflow";
import { KeystoneGptApproxTokenizer } from "../context/TokenCounterRegistry";
import { normalizeContent } from "../context/compressionUtils";
import {
  STAGE_WORKSPACE_SCHEMA_VERSION,
  StageWorkspacePersistentStateSchema,
  type CompleteState,
  type IntentAnalysis,
  type InvestigationQuestion,
  type InvestigationState,
  type StageContextPackage,
  type StageCopilotConfiguration,
  type StageDelegationMode,
  type StageDelegationRecord,
  type StageEvidence,
  type StageIntelligenceState,
  type StagePrompt,
  type StageResult,
  type StageScopeItem,
  type StageValidation,
  type StageWorkspacePersistentState,
  type UnderstandPrimaryAction,
  type UnderstandState,
  type UnderstandingSection,
} from "../../shared/contracts/stageWorkspace";

export class StageWorkspaceError extends Error {
  constructor(public readonly code: string, message: string, public readonly recoverable = true) {
    super(message);
    this.name = "StageWorkspaceError";
  }
}

export interface StageWorkspacePersistence {
  read(): Promise<unknown>;
  write(value: StageWorkspacePersistentState): Promise<void>;
}

export class FileStageWorkspacePersistence implements StageWorkspacePersistence {
  constructor(private readonly path: string, private readonly writer = new AtomicFileWriter()) {}
  async read(): Promise<unknown> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as unknown;
    } catch (cause) {
      if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
      return undefined;
    }
  }
  write(value: StageWorkspacePersistentState): Promise<void> {
    return this.writer.writeJson(this.path, value);
  }
}

const UNDERSTAND_AREAS = [
  "purpose",
  "technologies",
  "modules",
  "entry points",
  "flows",
  "persistence",
  "integrations",
  "tests",
] as const;

/**
 * StageWorkspaceService drives the Understand → Investigation → Complete
 * vertical journey. All state transitions are computed on the host from
 * persisted state; the webview only supplies user content (text, approvals).
 */
export class StageWorkspaceService {
  private state: StageWorkspacePersistentState = emptyState();
  private readonly tokenizer = new KeystoneGptApproxTokenizer();

  constructor(
    private readonly persistence: StageWorkspacePersistence,
    private readonly workflows: WorkflowService,
    private readonly intelligence: IntelligenceSnapshotReader,
    private readonly copilot: CopilotAdapter,
    private readonly startIntelligenceScan?: () => Promise<void>,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly createId: () => string = randomUUID,
  ) {}

  async initialize(): Promise<void> {
    const stored = await this.persistence.read();
    if (stored === undefined) return;
    const parsed = StageWorkspacePersistentStateSchema.safeParse(stored);
    if (parsed.success) this.state = parsed.data;
  }

  // ── Understand ────────────────────────────────────────────────────────

  async loadUnderstand(workflowId: string): Promise<UnderstandState> {
    const workflow = this.requireWorkflow(workflowId);
    const stage = this.requireStage(workflow, "understand");
    const existing = this.state.understand[stage.id];
    const intelligenceState = this.intelligenceState();
    const configuration = await this.buildConfiguration(existing?.configuration.mode, existing?.configuration.skill);
    const base: UnderstandState = existing
      ? { ...existing, intelligence: intelligenceState, configuration }
      : {
          schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION,
          workflowId,
          stageId: stage.id,
          intelligence: intelligenceState,
          configuration,
          delegations: [],
          primaryAction: "initialize-intelligence",
          completion: { allowed: false, unmet: [] },
          updatedAt: this.now(),
        };
    const next = this.recompute(base, stage.status === "completed");
    await this.saveUnderstand(next);
    return next;
  }

  async initializeIntelligence(workflowId: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (state.intelligence.status === "ready") return state;
    if (!this.startIntelligenceScan)
      throw new StageWorkspaceError(
        "INTELLIGENCE_SCAN_UNAVAILABLE",
        "Repository Intelligence indexing is not available in this environment. Open the Intelligence page to inspect the runtime state.",
      );
    await this.startIntelligenceScan();
    return this.loadUnderstand(workflowId);
  }

  async analyzeIntent(workflowId: string): Promise<UnderstandState> {
    const workflow = this.requireWorkflow(workflowId);
    const state = await this.loadUnderstand(workflowId);
    const snapshot = this.intelligence.getSnapshot();
    if (!snapshot)
      throw new StageWorkspaceError(
        "INTELLIGENCE_UNAVAILABLE",
        "Repository Intelligence has no snapshot yet. Initialize Repository Intelligence first.",
      );
    const analysis = this.buildAnalysis(workflow, snapshot);
    const next = this.recompute({ ...state, analysis, contextPackage: undefined, prompt: undefined });
    await this.saveUnderstand(next);
    return next;
  }

  async approveAnalysis(workflowId: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.analysis)
      throw new StageWorkspaceError("ANALYSIS_MISSING", "Analyze the intent before approving the analysis.");
    const next = this.recompute({ ...state, analysis: { ...state.analysis, approved: true } });
    await this.saveUnderstand(next);
    return next;
  }

  async setScopeItemIncluded(workflowId: string, itemId: string, included: boolean, reason?: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.analysis) throw new StageWorkspaceError("ANALYSIS_MISSING", "Analyze the intent before adjusting scope.");
    const scope = state.analysis.scope.map((item) =>
      item.id === itemId
        ? { ...item, included, ...(included ? {} : { exclusionReason: reason?.trim() || "Excluded by user." }) }
        : item,
    );
    if (!scope.some((item) => item.id === itemId))
      throw new StageWorkspaceError("SCOPE_ITEM_NOT_FOUND", "The scope item was not found in the current analysis.");
    const next = this.recompute({
      ...state,
      analysis: { ...state.analysis, scope },
      contextPackage: state.contextPackage ? { ...state.contextPackage, status: "stale" } : undefined,
      prompt: undefined,
    });
    await this.saveUnderstand(next);
    return next;
  }

  async resolveAmbiguity(workflowId: string, ambiguityId: string, resolution: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.analysis) throw new StageWorkspaceError("ANALYSIS_MISSING", "Analyze the intent before resolving ambiguities.");
    if (!resolution.trim()) throw new StageWorkspaceError("RESOLUTION_REQUIRED", "A resolution note is required.");
    const ambiguities = state.analysis.ambiguities.map((item) =>
      item.id === ambiguityId ? { ...item, resolved: true, resolution: resolution.trim() } : item,
    );
    const next = this.recompute({ ...state, analysis: { ...state.analysis, ambiguities } });
    await this.saveUnderstand(next);
    return next;
  }

  async setConfiguration(workflowId: string, input: { mode?: StageDelegationMode; skill?: string }): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    const configuration = await this.buildConfiguration(input.mode ?? state.configuration.mode, input.skill ?? state.configuration.skill);
    const next = this.recompute({ ...state, configuration });
    await this.saveUnderstand(next);
    return next;
  }

  async generateContext(workflowId: string): Promise<UnderstandState> {
    const workflow = this.requireWorkflow(workflowId);
    const state = await this.loadUnderstand(workflowId);
    if (!state.analysis?.approved)
      throw new StageWorkspaceError("ANALYSIS_NOT_APPROVED", "Approve the intent analysis before generating context.");
    const contextPackage = this.buildContextPackage(workflow, state);
    const next = this.recompute({ ...state, contextPackage, prompt: undefined });
    await this.saveUnderstand(next);
    return next;
  }

  async approveContext(workflowId: string, packageId: string, revision: number): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    const pkg = state.contextPackage;
    if (!pkg || pkg.id !== packageId || pkg.revision !== revision)
      throw new StageWorkspaceError("CONTEXT_REVISION_MISMATCH", "The context package changed. Review the latest revision before approving.");
    if (pkg.status === "stale")
      throw new StageWorkspaceError("CONTEXT_STALE", "The context package is stale. Regenerate it from the current scope first.");
    const workflow = this.requireWorkflow(workflowId);
    const approved: StageContextPackage = { ...pkg, status: "approved", approvedAt: this.now() };
    const prompt = this.buildPrompt(workflow, { ...state, contextPackage: approved });
    const next = this.recompute({ ...state, contextPackage: approved, prompt });
    await this.saveUnderstand(next);
    return next;
  }

  async delegate(workflowId: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.prompt || state.contextPackage?.status !== "approved")
      throw new StageWorkspaceError("PROMPT_NOT_READY", "Approve the context package to prepare the exact prompt before delegating.");
    const mode = state.configuration.mode;
    const record = await this.performDelegation(state, mode);
    const next = this.recompute({ ...state, delegations: [...state.delegations, record] });
    await this.saveUnderstand(next);
    return next;
  }

  async captureResult(
    workflowId: string,
    input: { source: StageResult["source"]; content: string; referencedFiles?: string[]; unresolvedQuestions?: string[]; notes?: string },
  ): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!input.content.trim())
      throw new StageWorkspaceError("RESULT_CONTENT_REQUIRED", "Result content is required to record a result.");
    if (state.delegations.length === 0 && input.source !== "manual")
      throw new StageWorkspaceError("NO_EXECUTION_RECORD", "Delegate the prompt or record the result as manual work first.");
    const result: StageResult = {
      id: this.createId(),
      source: input.source,
      content: input.content.trim(),
      referencedFiles: (input.referencedFiles ?? extractReferencedFiles(input.content)).slice(0, 200),
      unresolvedQuestions: (input.unresolvedQuestions ?? []).slice(0, 50),
      notes: input.notes?.trim() ?? "",
      capturedAt: this.now(),
    };
    const next = this.recompute({ ...state, result, validation: undefined });
    await this.saveUnderstand(next);
    return next;
  }

  async validateResult(workflowId: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.result) throw new StageWorkspaceError("RESULT_MISSING", "Capture a result before validating it.");
    const validation = this.buildValidation(state);
    const next = this.recompute({ ...state, validation });
    await this.saveUnderstand(next);
    return next;
  }

  async acceptValidationWarnings(workflowId: string): Promise<UnderstandState> {
    const state = await this.loadUnderstand(workflowId);
    if (!state.validation) throw new StageWorkspaceError("VALIDATION_MISSING", "Validate the result before accepting warnings.");
    if (state.validation.status !== "sufficient-with-warnings")
      throw new StageWorkspaceError("WARNINGS_NOT_ACCEPTABLE", "Only a Sufficient with Warnings validation can be accepted with warnings.");
    const next = this.recompute({ ...state, validation: { ...state.validation, warningsAccepted: true } });
    await this.saveUnderstand(next);
    return next;
  }

  async completeUnderstand(workflowId: string): Promise<{ state: UnderstandState; workflow: CanonicalWorkflow }> {
    const state = await this.loadUnderstand(workflowId);
    const gate = this.completionGate(state);
    if (!gate.allowed)
      throw new StageWorkspaceError("COMPLETION_BLOCKED", `Understand cannot complete yet: ${gate.unmet.join(" ")}`);
    const workflow = await this.workflows.completeStage(workflowId, state.stageId);
    const completed = this.recompute({ ...state, completedAt: this.now() }, true);
    await this.saveUnderstand(completed);
    // Seed the investigation stage when the next ready stage is an investigation.
    const nextStage = workflow.stages.find((item) => item.id === workflow.currentStageId);
    if (nextStage?.type === "investigation") await this.seedInvestigation(workflow, nextStage.id, completed);
    return { state: completed, workflow };
  }

  // ── Investigation ─────────────────────────────────────────────────────

  async loadInvestigation(workflowId: string): Promise<InvestigationState> {
    const workflow = this.requireWorkflow(workflowId);
    const stage = this.requireStage(workflow, "investigation");
    let state = this.state.investigation[stage.id];
    if (!state) {
      const understand = Object.values(this.state.understand).find((item) => item.workflowId === workflowId);
      state = this.buildInvestigationSeed(workflow, stage.id, understand);
      await this.saveInvestigation(state);
    }
    const next = this.recomputeInvestigation(state);
    await this.saveInvestigation(next);
    return next;
  }

  async upsertQuestion(
    workflowId: string,
    input: { questionId?: string; text?: string; required?: boolean; answer?: string; evidence?: StageEvidence[] },
  ): Promise<InvestigationState> {
    const state = await this.loadInvestigation(workflowId);
    let questions: InvestigationQuestion[];
    if (input.questionId) {
      const existing = state.questions.find((item) => item.id === input.questionId);
      if (!existing) throw new StageWorkspaceError("QUESTION_NOT_FOUND", "The investigation question was not found.");
      questions = state.questions.map((item) =>
        item.id !== input.questionId
          ? item
          : {
              ...item,
              text: input.text?.trim() || item.text,
              required: input.required ?? item.required,
              answer: input.answer !== undefined ? input.answer.trim() : item.answer,
              evidence: input.evidence ?? item.evidence,
              status: (input.answer !== undefined ? input.answer.trim() : item.answer) ? "answered" : "open",
            },
      );
    } else {
      if (!input.text?.trim()) throw new StageWorkspaceError("QUESTION_TEXT_REQUIRED", "Question text is required.");
      questions = [
        ...state.questions,
        { id: this.createId(), text: input.text.trim(), required: input.required ?? false, status: "open", answer: "", evidence: input.evidence ?? [] },
      ];
    }
    const next = this.recomputeInvestigation({ ...state, questions });
    await this.saveInvestigation(next);
    return next;
  }

  async setConclusion(workflowId: string, conclusion: string, limitations: string[], accepted: boolean): Promise<InvestigationState> {
    const state = await this.loadInvestigation(workflowId);
    if (accepted && !conclusion.trim())
      throw new StageWorkspaceError("CONCLUSION_REQUIRED", "A conclusion is required before it can be accepted.");
    const next = this.recomputeInvestigation({
      ...state,
      conclusion: conclusion.trim(),
      limitations: limitations.map((item) => item.trim()).filter(Boolean).slice(0, 30),
      conclusionAccepted: accepted && Boolean(conclusion.trim()),
    });
    await this.saveInvestigation(next);
    return next;
  }

  async completeInvestigation(workflowId: string): Promise<{ state: InvestigationState; workflow: CanonicalWorkflow }> {
    const state = await this.loadInvestigation(workflowId);
    if (!state.completion.allowed)
      throw new StageWorkspaceError("COMPLETION_BLOCKED", `Investigation cannot complete yet: ${state.completion.unmet.join(" ")}`);
    const workflow = await this.workflows.completeStage(workflowId, state.stageId);
    const completed = { ...state, completedAt: this.now(), updatedAt: this.now() };
    await this.saveInvestigation(completed);
    return { state: completed, workflow };
  }

  // ── Complete stage ────────────────────────────────────────────────────

  loadComplete(workflowId: string): CompleteState {
    const workflow = this.requireWorkflow(workflowId);
    const stage = workflow.stages.find((item) => item.type === "complete") ?? workflow.stages[workflow.stages.length - 1];
    if (!stage) throw new StageWorkspaceError("STAGE_NOT_FOUND", "This workflow has no completion stage.");
    const understand = Object.values(this.state.understand).find((item) => item.workflowId === workflowId);
    const investigation = Object.values(this.state.investigation).find((item) => item.workflowId === workflowId);
    const evidence: StageEvidence[] = [
      ...(understand?.analysis?.scope.filter((item) => item.included).map((item) => ({ kind: item.kind, reference: item.reference, label: item.label })) ?? []),
      ...(investigation?.questions.flatMap((item) => item.evidence) ?? []),
    ].slice(0, 200);
    const outcome = investigation?.conclusion || understand?.result?.content.slice(0, 20_000) || "No recorded outcome yet.";
    return {
      schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION,
      workflowId,
      stageId: stage.id,
      intentText: workflow.intent.text,
      workTypeLabel: canonicalWorkTypeLabel(workflow.intent.workType),
      outcome,
      completedStages: workflow.stages.map((item) => ({ displayName: item.displayName, completed: item.status === "completed" })),
      evidence,
      limitations: [
        ...(investigation?.limitations ?? []),
        ...(understand?.analysis?.ambiguities.filter((item) => !item.resolved).map((item) => item.text) ?? []),
      ].slice(0, 60),
      ...(understand?.contextPackage
        ? {
            tokenMetrics: {
              candidateTokens: understand.contextPackage.candidateTokens,
              compressedTokens: understand.contextPackage.compressedTokens,
              reductionPercent: understand.contextPackage.reductionPercent,
              tokenMeasurement: understand.contextPackage.tokenMeasurement,
            },
          }
        : {}),
      delegationHistory: understand?.delegations ?? [],
      updatedAt: this.now(),
    };
  }

  async archiveWorkflow(workflowId: string): Promise<CanonicalWorkflow> {
    const workflow = this.requireWorkflow(workflowId);
    const completeStage = workflow.stages.find((item) => item.type === "complete" && item.status !== "completed");
    if (completeStage) return this.workflows.completeStage(workflowId, completeStage.id);
    return workflow;
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private requireWorkflow(workflowId: string): CanonicalWorkflow {
    const workflow = this.workflows.getWorkflow(workflowId);
    if (!workflow) throw new StageWorkspaceError("WORKFLOW_NOT_FOUND", "The selected workflow was not found.");
    return workflow;
  }

  private requireStage(workflow: CanonicalWorkflow, type: "understand" | "investigation") {
    const stage = workflow.stages.find((item) => item.type === type);
    if (!stage) throw new StageWorkspaceError("STAGE_NOT_FOUND", `This workflow has no ${type} stage.`);
    return stage;
  }

  private intelligenceState(): StageIntelligenceState {
    const snapshot = this.intelligence.getSnapshot();
    if (!snapshot)
      return { status: "unavailable", generation: 0, files: 0, symbols: 0, relationships: 0, message: "Repository Intelligence has not indexed this repository yet." };
    return {
      status: "ready",
      generation: snapshot.manifest.generation,
      files: snapshot.files.length,
      symbols: snapshot.symbols.length,
      relationships: snapshot.relationships.length,
      message: `Indexed ${snapshot.files.length} files, ${snapshot.symbols.length} symbols, ${snapshot.relationships.length} relationships.`,
    };
  }

  private async buildConfiguration(mode?: StageDelegationMode, skill?: string): Promise<StageCopilotConfiguration> {
    const capabilities = this.copilot.getCapabilities() ?? (await this.copilot.refreshCapabilities().catch(() => undefined));
    const chatAvailable = capabilities?.chatAvailable ?? false;
    const clipboardAvailable = capabilities?.supportedInvocationMethods.includes("clipboard-v1") ?? true;
    const agents = chatAvailable ? await this.copilot.discoverAgents().catch(() => []) : [];
    const agent = agents[0];
    const resolvedMode: StageDelegationMode = mode && (mode !== "chat-open" || chatAvailable) ? mode : chatAvailable ? "chat-open" : clipboardAvailable ? "clipboard" : "manual";
    return {
      mode: resolvedMode,
      agentId: agent?.id ?? "copilot-chat",
      agentLabel: agent?.displayName ?? (chatAvailable ? "GitHub Copilot Chat" : "No Copilot agent detected"),
      agentAvailable: chatAvailable,
      skill: skill ?? "repository-understanding",
      instructions: [
        "Base every statement only on the supplied evidence package.",
        "Cite the file, symbol, or document supporting each important claim.",
        "State unresolved or low-confidence areas explicitly instead of guessing.",
      ],
      capabilities: [
        { id: "chat-open", label: "Open Copilot Chat with prompt", available: chatAvailable, detail: chatAvailable ? "workbench.action.chat.open is registered." : "Copilot Chat is not available in this environment." },
        { id: "clipboard", label: "Copy prompt to clipboard", available: clipboardAvailable, detail: "Copies the exact approved prompt for manual paste." },
        { id: "manual", label: "Manual work", available: true, detail: "Record work you performed yourself." },
      ],
    };
  }

  private buildAnalysis(workflow: CanonicalWorkflow, snapshot: IntelligenceSnapshot): IntentAnalysis {
    const intent = workflow.intent.text.toLowerCase();
    const terms = intent.split(/[^a-z0-9]+/).filter((term) => term.length > 2);
    const files = snapshot.files;
    const docs = files.filter((file) => file.category === "documentation");
    const manifests = files.filter((file) => file.category === "manifest");
    const tests = files.filter((file) => file.category === "test" || file.isTest);
    const source = files.filter((file) => file.category === "source");
    const languages = countTop(files.map((file) => file.language), 6);
    const modules = countTop(source.map((file) => file.relativePath.split("/").slice(0, 2).join("/")), 8);
    const entryCandidates = source.filter((file) => /(^|\/)(extension|main|index|app)\.[a-z]+$/.test(file.relativePath)).slice(0, 6);
    const broadIntent = /what is|overview|explain|understand|repo|repository|architecture/.test(intent);
    const matched = broadIntent
      ? []
      : source.filter((file) => terms.some((term) => file.relativePath.toLowerCase().includes(term))).slice(0, 20);
    const scopeFiles = [
      ...manifests.slice(0, 3),
      ...docs.slice(0, 5),
      ...entryCandidates,
      ...(matched.length ? matched : source.slice(0, 10)),
    ];
    const seen = new Set<string>();
    const scope: StageScopeItem[] = [];
    for (const file of scopeFiles) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      const isMatched = matched.includes(file) || entryCandidates.includes(file);
      scope.push({
        id: file.id,
        kind: file.category === "documentation" ? "document" : file.isTest || file.category === "test" ? "test" : "file",
        reference: file.relativePath,
        label: file.relativePath,
        confidence: isMatched || file.category === "manifest" || file.category === "documentation" ? "confirmed" : "inferred",
        included: true,
      });
    }
    for (const test of tests.slice(0, 5)) {
      if (seen.has(test.id)) continue;
      seen.add(test.id);
      scope.push({ id: test.id, kind: "test", reference: test.relativePath, label: test.relativePath, confidence: "inferred", included: true });
    }
    const topSymbols = snapshot.symbols.filter((symbol) => symbol.type === "class" && symbol.exported).slice(0, 12);
    const sections: UnderstandingSection[] = [
      section("Repository purpose", docs.length ? `Documentation is present (${docs.slice(0, 3).map((file) => file.relativePath).join(", ")}); the repository's stated purpose is described there.` : "No documentation files were indexed; the repository purpose is not confirmed by evidence.", docs.length ? "confirmed" : "unresolved", docs.slice(0, 3).map((file) => fileEvidence(file.relativePath, "document"))),
      section("Main technologies", `Indexed languages: ${languages.map(([name, count]) => `${name} (${count} files)`).join(", ") || "none detected"}.`, languages.length ? "confirmed" : "unresolved", manifests.slice(0, 3).map((file) => fileEvidence(file.relativePath, "file"))),
      section("Important modules", `Largest module areas by file count: ${modules.map(([name, count]) => `${name} (${count})`).join(", ") || "none"}.`, modules.length ? "confirmed" : "unresolved", modules.slice(0, 5).map(([name]) => ({ kind: "module" as const, reference: name, label: name }))),
      section("Entry points", entryCandidates.length ? `Likely entry points: ${entryCandidates.map((file) => file.relativePath).join(", ")}.` : "No conventional entry-point file names were found; entry points are unresolved.", entryCandidates.length ? "inferred" : "unresolved", entryCandidates.map((file) => fileEvidence(file.relativePath, "file"))),
      section("Key exported classes", topSymbols.length ? `Exported classes include: ${topSymbols.map((symbol) => symbol.name).join(", ")}.` : "No exported class symbols were indexed.", topSymbols.length ? "confirmed" : "unresolved", topSymbols.slice(0, 8).map((symbol) => ({ kind: "symbol" as const, reference: symbol.id, label: symbol.qualifiedName }))),
      section("Relationships and flows", `${snapshot.relationships.length} relationships are indexed; major control and data flows are derived from these edges.`, snapshot.relationships.length ? "inferred" : "unresolved", []),
      section("Tests", tests.length ? `${tests.length} test files are indexed (e.g. ${tests.slice(0, 3).map((file) => file.relativePath).join(", ")}).` : "No test files were indexed.", tests.length ? "confirmed" : "unresolved", tests.slice(0, 3).map((file) => fileEvidence(file.relativePath, "test"))),
    ];
    const ambiguities = [] as IntentAnalysis["ambiguities"];
    if (!docs.length) ambiguities.push({ id: "no-docs", text: "No documentation was found; repository purpose is inferred from structure only.", blocking: false, resolved: false });
    if (workflow.specification === undefined && !broadIntent && matched.length === 0)
      ambiguities.push({ id: "no-scope-match", text: "The intent did not match indexed file paths; the selected scope is a structural default.", blocking: false, resolved: false });
    const objective = broadIntent
      ? `Produce an evidence-backed explanation of this repository: purpose, technologies, modules, entry points, major flows, persistence, integrations, tests, and unresolved areas.`
      : `Understand the repository areas relevant to: ${workflow.intent.text}`;
    const requiredFacts = broadIntent
      ? ["Repository purpose", "Main technologies", "Important modules", "Entry points", "Test layout"]
      : ["Relevant files for the intent", "Key symbols in scope", "Test coverage of the scope"];
    const body = JSON.stringify({ objective, scope: scope.map((item) => item.reference), generation: snapshot.manifest.generation });
    return {
      id: this.createId(),
      objective,
      sections,
      scope: scope.slice(0, 200),
      assumptions: broadIntent ? ["The indexed snapshot reflects the current repository revision."] : ["Path-name matching approximates relevance; adjust the scope if items are missing."],
      ambiguities,
      requiredFacts,
      recommendedNextAction: "Review the repository understanding and scope, then generate the context package.",
      intelligenceRevision: snapshot.manifest.generation,
      contentHash: createHash("sha256").update(body).digest("hex"),
      approved: false,
      createdAt: this.now(),
    };
  }

  private buildContextPackage(workflow: CanonicalWorkflow, state: UnderstandState): StageContextPackage {
    const analysis = state.analysis!;
    const included = analysis.scope.filter((item) => item.included);
    const sections = analysis.sections.map((item) => `${item.title} [${item.confidence}]: ${item.statement}`);
    const rawParts = [
      `Intent: ${workflow.intent.text}`,
      ...(workflow.specification ? [`Specification: ${workflow.specification.text}`] : []),
      `Objective: ${analysis.objective}`,
      ...sections,
      ...included.map((item) => `${item.kind}: ${item.reference}`),
    ];
    const candidateText = rawParts.join("\n");
    const compressedText = normalizeContent(candidateText);
    const candidateTokens = this.tokenizer.count(candidateText) + included.length * 40;
    const compressedTokens = this.tokenizer.count(compressedText);
    const reduction = candidateTokens > 0 ? Math.max(0, Math.min(100, Math.round(((candidateTokens - compressedTokens) / candidateTokens) * 100))) : 0;
    const items = included.map((item) => ({
      id: item.id,
      label: item.label,
      kind: item.kind,
      tokens: this.tokenizer.count(item.reference) + 40,
      included: true,
    }));
    const requiredFacts = analysis.requiredFacts.map((fact) => ({
      fact,
      covered: sections.some((text) => text.toLowerCase().includes(fact.toLowerCase().split(" ")[0] ?? "")),
    }));
    const previous = state.contextPackage;
    return {
      id: this.createId(),
      revision: (previous?.revision ?? 0) + 1,
      status: "generated",
      candidateTokens,
      compressedTokens,
      reductionPercent: reduction,
      tokenMeasurement: "estimated",
      items: items.slice(0, 300),
      requiredFacts,
      intelligenceRevision: analysis.intelligenceRevision,
      content: compressedText.slice(0, 500_000),
      generatedAt: this.now(),
    };
  }

  private buildPrompt(workflow: CanonicalWorkflow, state: UnderstandState): StagePrompt {
    const analysis = state.analysis!;
    const pkg = state.contextPackage!;
    const included = analysis.scope.filter((item) => item.included);
    const lines = [
      "# Keystone Understand stage",
      "",
      `## Original intent`,
      workflow.intent.text,
      ...(workflow.specification ? ["", "## Specification", workflow.specification.text] : []),
      "",
      "## Interpreted objective",
      analysis.objective,
      "",
      "## Approved repository understanding",
      ...analysis.sections.map((item) => `- ${item.title} [${item.confidence}]: ${item.statement}`),
      "",
      "## Approved repository scope (evidence)",
      ...included.map((item) => `- ${item.kind}: ${item.reference}`),
      "",
      "## Instructions",
      ...state.configuration.instructions.map((item) => `- ${item}`),
      "",
      "## Task",
      "Based only on the supplied evidence, explain: repository purpose; architecture and modules; activation/runtime flow; persistence; test strategy; the Repository Intelligence implementation; the workflow implementation; the context-compression implementation; the Copilot delegation mechanism; incomplete areas; and architectural risks.",
      "",
      "## Expected output",
      "- A structured explanation addressing every area above.",
      "- Cite a file, symbol, or document for each important statement.",
      "- List unresolved questions explicitly.",
      "",
      "## Restrictions",
      "- Do not invent files, symbols, or behavior not present in the evidence.",
      "- Mark inferred statements as inferred.",
      "",
      "## Completion criteria",
      "The answer addresses repository purpose, technologies, modules, entry points, major flows, persistence, integrations, tests, constraints, and unresolved questions.",
    ];
    const content = lines.join("\n");
    return {
      id: this.createId(),
      revision: (state.prompt?.revision ?? 0) + 1,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      contextPackageRevision: pkg.revision,
      preparedAt: this.now(),
    };
  }

  private async performDelegation(state: UnderstandState, mode: StageDelegationMode): Promise<StageDelegationRecord> {
    const prompt = state.prompt!;
    const base = {
      id: this.createId(),
      workflowId: state.workflowId,
      stageId: state.stageId,
      promptRevision: prompt.revision,
      contextPackageRevision: prompt.contextPackageRevision,
      executionProfileRevision: 0,
      createdAt: this.now(),
    };
    if (mode === "manual")
      return { ...base, mode, capabilityUsed: "manual", status: "manual", statusDetail: "Manual work selected. No prompt was sent anywhere." };
    if (mode === "chat-open") {
      try {
        await this.copilot.copyPrompt(prompt.content);
        await this.copilot.openCopilot();
        return { ...base, mode, capabilityUsed: "workbench.action.chat.open", status: "copied-chat-opened", statusDetail: "Prompt copied. Copilot Chat opened. Paste the prompt to run it — Keystone did not submit it." };
      } catch (cause) {
        return { ...base, mode, capabilityUsed: "workbench.action.chat.open", status: "failed", statusDetail: "Copilot Chat could not be opened.", failureReason: cause instanceof Error ? cause.message : String(cause) };
      }
    }
    try {
      await this.copilot.copyPrompt(prompt.content);
      return { ...base, mode, capabilityUsed: "clipboard", status: "copied", statusDetail: "Prompt copied to the clipboard. Paste it into Copilot Chat manually." };
    } catch (cause) {
      return { ...base, mode, capabilityUsed: "clipboard", status: "failed", statusDetail: "The prompt could not be copied.", failureReason: cause instanceof Error ? cause.message : String(cause) };
    }
  }

  private buildValidation(state: UnderstandState): StageValidation {
    const result = state.result!;
    const text = result.content.toLowerCase();
    const areaTerms: Record<string, string[]> = {
      purpose: ["purpose", "goal", "what it does", "problem"],
      technologies: ["typescript", "javascript", "language", "technolog", "framework"],
      modules: ["module", "component", "layer", "package", "service"],
      "entry points": ["entry", "activation", "activate", "main", "bootstrap"],
      flows: ["flow", "pipeline", "sequence", "lifecycle"],
      persistence: ["persist", "storage", "store", "file", "database"],
      integrations: ["integration", "copilot", "external", "api"],
      tests: ["test", "vitest", "spec", "coverage"],
    };
    const covered: string[] = [];
    const missing: string[] = [];
    for (const area of UNDERSTAND_AREAS) {
      if ((areaTerms[area] ?? [area]).some((term) => text.includes(term))) covered.push(area);
      else missing.push(area);
    }
    const snapshot = this.intelligence.getSnapshot();
    const contradictions: StageValidation["contradictions"] = [];
    for (const path of result.referencedFiles.slice(0, 50)) {
      if (snapshot && !snapshot.files.some((file) => file.relativePath === path || file.relativePath.endsWith(path)))
        contradictions.push({ statement: `Referenced file '${path}' is not in the indexed repository.`, evidence: { kind: "file", reference: path, label: path } });
    }
    const stale = Boolean(snapshot && state.analysis && snapshot.manifest.generation !== state.analysis.intelligenceRevision);
    const warnings = [
      ...(result.unresolvedQuestions.length ? [`${result.unresolvedQuestions.length} unresolved questions were recorded with the result.`] : []),
      ...(missing.length > 0 && missing.length <= 2 ? missing.map((area) => `The result does not clearly address: ${area}.`) : []),
    ];
    const status: StageValidation["status"] = contradictions.length
      ? "contradicted"
      : stale
        ? "stale"
        : missing.length > 2
          ? "incomplete"
          : warnings.length
            ? "sufficient-with-warnings"
            : "sufficient";
    return {
      id: this.createId(),
      resultId: result.id,
      status,
      coveredAreas: covered,
      missingAreas: missing,
      warnings,
      contradictions,
      intelligenceRevision: snapshot?.manifest.generation ?? 0,
      warningsAccepted: false,
      validatedAt: this.now(),
    };
  }

  private completionGate(state: UnderstandState): { allowed: boolean; unmet: string[] } {
    const unmet: string[] = [];
    if (!state.analysis?.approved) unmet.push("The intent analysis is not approved.");
    if (state.analysis?.ambiguities.some((item) => item.blocking && !item.resolved)) unmet.push("Blocking ambiguities are unresolved.");
    if (state.contextPackage?.status !== "approved") unmet.push("The context package is not approved.");
    if (!state.delegations.length && state.result?.source !== "manual") unmet.push("No delegation or manual execution record exists.");
    if (!state.result) unmet.push("No result has been captured.");
    if (!state.validation) unmet.push("The result has not been validated.");
    else if (state.validation.resultId !== state.result?.id) unmet.push("The validation is for an earlier result. Validate again.");
    else if (state.validation.status === "sufficient-with-warnings" && !state.validation.warningsAccepted) unmet.push("Validation warnings have not been accepted.");
    else if (state.validation.status !== "sufficient" && state.validation.status !== "sufficient-with-warnings") unmet.push(`Validation status is ${state.validation.status}.`);
    return { allowed: unmet.length === 0, unmet };
  }

  private recompute(state: UnderstandState, completed = Boolean(state.completedAt)): UnderstandState {
    const completion = this.completionGate(state);
    const primaryAction: UnderstandPrimaryAction = completed || state.completedAt
      ? "stage-completed"
      : state.intelligence.status !== "ready"
        ? "initialize-intelligence"
        : !state.analysis
          ? "analyze-intent"
          : !state.analysis.approved
            ? "approve-analysis"
            : !state.contextPackage || state.contextPackage.status === "stale"
              ? "generate-context"
              : state.contextPackage.status !== "approved"
                ? "review-approve-context"
                : !state.delegations.some((item) => item.status !== "failed") && state.result?.source !== "manual"
                  ? "delegate"
                  : !state.result
                    ? "capture-result"
                    : !state.validation || state.validation.resultId !== state.result.id
                      ? "validate-result"
                      : completion.allowed
                        ? "complete-stage"
                        : "validate-result";
    return { ...state, primaryAction, completion, updatedAt: this.now() };
  }

  private recomputeInvestigation(state: InvestigationState): InvestigationState {
    const unmet: string[] = [];
    const required = state.questions.filter((item) => item.required);
    if (required.some((item) => item.status !== "answered")) unmet.push("Required questions are unanswered.");
    if (required.some((item) => item.status === "answered" && item.evidence.length === 0)) unmet.push("Answered required questions need linked evidence.");
    if (!state.conclusion.trim()) unmet.push("A conclusion is required.");
    if (!state.conclusionAccepted) unmet.push("The conclusion has not been accepted.");
    return { ...state, completion: { allowed: unmet.length === 0, unmet }, updatedAt: this.now() };
  }

  private buildInvestigationSeed(workflow: CanonicalWorkflow, stageId: string, understand?: UnderstandState): InvestigationState {
    const seedTexts = [
      "What problem does this repository solve?",
      "What are the main runtime components?",
      "How does extension activation work?",
      "How is Repository Intelligence created and stored?",
      "How are workflows persisted?",
      "How does context compression work?",
      "How does Copilot delegation work?",
      "Which capabilities remain incomplete?",
      "What are the major architectural risks?",
    ];
    return this.recomputeInvestigation({
      schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION,
      workflowId: workflow.id,
      stageId,
      objective: understand?.analysis?.objective ?? workflow.intent.text,
      questions: seedTexts.map((text, index) => ({ id: this.createId(), text, required: index < 4, status: "open", answer: "", evidence: [] })),
      limitations: [],
      conclusion: "",
      conclusionAccepted: false,
      completion: { allowed: false, unmet: [] },
      updatedAt: this.now(),
    });
  }

  private async seedInvestigation(workflow: CanonicalWorkflow, stageId: string, understand: UnderstandState): Promise<void> {
    if (this.state.investigation[stageId]) return;
    await this.saveInvestigation(this.buildInvestigationSeed(workflow, stageId, understand));
  }

  private async saveUnderstand(state: UnderstandState): Promise<void> {
    const next: StageWorkspacePersistentState = {
      ...this.state,
      revision: this.state.revision + 1,
      understand: { ...this.state.understand, [state.stageId]: state },
      updatedAt: this.now(),
    };
    await this.persistence.write(next);
    this.state = next;
  }

  private async saveInvestigation(state: InvestigationState): Promise<void> {
    const next: StageWorkspacePersistentState = {
      ...this.state,
      revision: this.state.revision + 1,
      investigation: { ...this.state.investigation, [state.stageId]: state },
      updatedAt: this.now(),
    };
    await this.persistence.write(next);
    this.state = next;
  }
}

function emptyState(updatedAt = new Date().toISOString()): StageWorkspacePersistentState {
  return { schemaVersion: STAGE_WORKSPACE_SCHEMA_VERSION, revision: 0, understand: {}, investigation: {}, updatedAt };
}

function section(title: string, statement: string, confidence: UnderstandingSection["confidence"], evidence: StageEvidence[]): UnderstandingSection {
  return { title, statement, confidence, evidence: evidence.slice(0, 50) };
}

function fileEvidence(path: string, kind: StageEvidence["kind"]): StageEvidence {
  return { kind, reference: path, label: path };
}

function countTop(values: string[], top: number): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]).slice(0, top);
}

function extractReferencedFiles(content: string): string[] {
  const matches = content.match(/[\w./-]+\.(?:ts|tsx|js|jsx|json|md|css|html|py|yml|yaml)\b/g) ?? [];
  return [...new Set(matches)].slice(0, 200);
}
