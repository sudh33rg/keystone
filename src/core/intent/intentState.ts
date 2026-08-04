import { randomUUID } from "node:crypto";

import type { ContextEvidenceReference } from "../context/contextEngine";
import type {
  CopilotResponseEnvelope,
  CopilotScopeChangeProposal
} from "../copilot/responseContract";
import { JsonStorage } from "../platform/storage/jsonStorage";

export type IntentLifecycle =
  "DRAFT" | "UNDERSTANDING" | "READY" | "IN_PROGRESS" | "BLOCKED" | "REVIEW" | "COMPLETE";

export type IntentProvenance =
  | "source-fact"
  | "derived-interpretation"
  | "user"
  | "keystone-intelligence"
  | "workspace-observation"
  | "copilot-recommendation"
  | "user-accepted-copilot-recommendation"
  | "derived-keystone-state";

export interface IntentDecision {
  id: string;
  title: string;
  recommendation: string;
  reason?: string;
  status: "PROPOSED" | "ACCEPTED" | "REJECTED" | "SUPERSEDED";
  provenance: IntentProvenance;
  evidence?: ContextEvidenceReference[];
  createdAt: string;
  resolvedAt?: string;
  /** Optional user explanation for a resolution; the proposal reason is preserved. */
  resolutionReason?: string;
}

/** Provenance for the intentionally compact string-valued parts of Intent state. */
export interface IntentProvenanceRecord {
  field: string;
  value: string;
  provenance: IntentProvenance;
  recordedAt: string;
  sourceId?: string;
}

export interface IntentScope {
  included: string[];
  excluded: string[];
  boundaries: string[];
  followUps: string[];
}

export type IntentScopeChangeStatus =
  | "PROPOSED"
  | "EXPANDED"
  | "KEPT"
  | "FOLLOW_UP_CANDIDATE"
  | "DISCUSSION";

export interface IntentScopeChangeProposal extends CopilotScopeChangeProposal {
  id: string;
  originalScope: IntentScope;
  status: IntentScopeChangeStatus;
  provenance: IntentProvenance;
  createdAt: string;
  resolvedAt?: string;
  decisionId?: string;
}

export interface IntentOutcome {
  id: string;
  category:
    "understanding" | "finding" | "recommendation" | "risk" | "blocker" | "action" | "evidence";
  text: string;
  provenance: IntentProvenance;
  evidence?: ContextEvidenceReference[];
  createdAt: string;
}

export interface IntentState {
  version: 1;
  id: string;
  goal: string;
  understanding: string[];
  scope: IntentScope;
  scopeChangeProposals: IntentScopeChangeProposal[];
  constraints: string[];
  decisions: IntentDecision[];
  currentObjective: string;
  completedWork: string[];
  openQuestions: string[];
  blockers: Array<{
    id: string;
    summary: string;
    provenance: IntentProvenance;
    resolvedAt?: string;
  }>;
  risks: string[];
  affectedAreas: string[];
  changes: string[];
  artifacts: string[];
  outcomes: IntentOutcome[];
  contextReferences: string[];
  intelligenceReferences: string[];
  latestCopilotInteraction?: {
    summary?: string;
    contextPackageId?: string;
    structuredStatus: "complete" | "partial" | "absent";
    recordedAt: string;
    provenance: IntentProvenance;
  };
  /** Append-only provenance ledger for compact state values. */
  provenance: IntentProvenanceRecord[];
  lifecycle: IntentLifecycle;
  updatedAt: string;
}

export class IntentStateEngine {
  constructor(private state: IntentState) {}

  static create(
    id: string,
    goal: string,
    now = new Date().toISOString(),
    initial: { constraints?: string[]; affectedAreas?: string[] } = {}
  ): IntentStateEngine {
    const state: IntentState = {
      version: 1,
      id,
      goal,
      understanding: [],
      scope: { included: [], excluded: [], boundaries: [], followUps: [] },
      scopeChangeProposals: [],
      constraints: unique(initial.constraints ?? []),
      decisions: [],
      currentObjective: goal,
      completedWork: [],
      openQuestions: [],
      blockers: [],
      risks: [],
      affectedAreas: unique(initial.affectedAreas ?? []),
      changes: [],
      artifacts: [],
      outcomes: [],
      contextReferences: [],
      intelligenceReferences: [],
      provenance: [
        provenanceRecord("goal", goal, "user", now),
        provenanceRecord("currentObjective", goal, "user", now),
        ...unique(initial.constraints ?? []).map((value) =>
          provenanceRecord("constraints", value, "derived-keystone-state", now)
        ),
        ...unique(initial.affectedAreas ?? []).map((value) =>
          provenanceRecord("affectedAreas", value, "derived-keystone-state", now)
        )
      ],
      lifecycle: "DRAFT",
      updatedAt: now
    };
    return new IntentStateEngine(state);
  }

  static from(state: IntentState): IntentStateEngine {
    return new IntentStateEngine(normalizeState(state));
  }

  snapshot(): IntentState {
    return structuredClone(this.state);
  }

  transition(next: IntentLifecycle, provenance: IntentProvenance = "user"): IntentState {
    if (next === "BLOCKED")
      throw new Error("Use the explicit blocker operation to move an Intent to BLOCKED.");
    return this.transitionLifecycle(next, provenance);
  }

  private transitionLifecycle(
    next: IntentLifecycle,
    provenance: IntentProvenance = "user"
  ): IntentState {
    if (!allowedTransitions[this.state.lifecycle].includes(next)) {
      throw new Error(`Intent cannot transition from ${this.state.lifecycle} to ${next}.`);
    }
    return this.commit({
      lifecycle: next,
      provenance: appendProvenance(this.state, "lifecycle", next, provenance)
    });
  }

  availableTransitions(): IntentLifecycle[] {
    return [...allowedTransitions[this.state.lifecycle]];
  }

  startUnderstanding(provenance: IntentProvenance = "user"): IntentState {
    return this.transition("UNDERSTANDING", provenance);
  }
  markReady(provenance: IntentProvenance = "user"): IntentState {
    return this.transition("READY", provenance);
  }
  beginWork(provenance: IntentProvenance = "user"): IntentState {
    return this.transition("IN_PROGRESS", provenance);
  }
  submitForReview(provenance: IntentProvenance = "workspace-observation"): IntentState {
    return this.transition("REVIEW", provenance);
  }
  acceptCompletion(provenance: IntentProvenance = "user"): IntentState {
    return this.transition("COMPLETE", provenance);
  }
  reopenForWork(provenance: IntentProvenance = "user"): IntentState {
    return this.transition("IN_PROGRESS", provenance);
  }
  setCurrentObjective(objective: string): IntentState {
    const value = objective.trim() || this.state.goal;
    return this.commit({
      currentObjective: value,
      provenance: appendProvenance(this.state, "currentObjective", value, "user")
    });
  }
  updateScope(scope: Partial<IntentScope>, provenance: IntentProvenance = "user"): IntentState {
    const next = {
      ...this.state.scope,
      ...scope,
      included: unique([...(scope.included ?? this.state.scope.included)]),
      excluded: unique([...(scope.excluded ?? this.state.scope.excluded)]),
      boundaries: unique([...(scope.boundaries ?? this.state.scope.boundaries)]),
      followUps: unique([...(scope.followUps ?? this.state.scope.followUps)])
    };
    return this.commit({
      scope: next,
      understanding: unique([...this.state.understanding, `Scope updated (${provenance}).`]),
      provenance: [
        ...this.state.provenance,
        ...scopeValues(scope).map((value) => provenanceRecord("scope", value, provenance))
      ]
    });
  }

  resolveScopeChange(
    proposalId: string,
    action: "EXPAND_SCOPE" | "KEEP_CURRENT_SCOPE" | "CREATE_FOLLOW_UP" | "DISCUSS",
    reason?: string
  ): IntentState {
    const proposal = this.state.scopeChangeProposals.find((item) => item.id === proposalId);
    if (!proposal) throw new Error(`Intent scope change ${proposalId} was not found.`);
    const now = new Date().toISOString();
    const status =
      action === "EXPAND_SCOPE"
        ? "EXPANDED"
        : action === "KEEP_CURRENT_SCOPE"
          ? "KEPT"
          : action === "CREATE_FOLLOW_UP"
            ? "FOLLOW_UP_CANDIDATE"
            : "DISCUSSION";
    const scope =
      action === "EXPAND_SCOPE"
        ? {
            ...this.state.scope,
            included: unique([...this.state.scope.included, ...proposal.affectedAreas])
          }
        : action === "CREATE_FOLLOW_UP"
          ? {
              ...this.state.scope,
              followUps: unique([...this.state.scope.followUps, ...proposal.affectedAreas]),
              excluded: unique([...this.state.scope.excluded, ...proposal.affectedAreas])
            }
          : action === "KEEP_CURRENT_SCOPE"
            ? {
                ...this.state.scope,
                boundaries: unique([
                  ...this.state.scope.boundaries,
                  reason?.trim() || `Keep current scope; defer: ${proposal.summary}`
                ]),
                excluded: unique([...this.state.scope.excluded, ...proposal.affectedAreas])
              }
            : this.state.scope;
    const proposals = this.state.scopeChangeProposals.map((item) =>
      item.id === proposalId
        ? {
            ...item,
            status,
            resolvedAt: action === "DISCUSS" ? undefined : now
          }
        : item
    );
    return this.commit({
      scope,
      scopeChangeProposals: proposals,
      provenance: appendProvenanceMany(
        this.state,
        [
          ...((action === "EXPAND_SCOPE" ? proposal.affectedAreas : []) as string[]).map((value) => ({
            field: "scope.included",
            value,
            provenance: "user-accepted-copilot-recommendation" as const
          })),
          ...(action === "KEEP_CURRENT_SCOPE" || action === "CREATE_FOLLOW_UP"
            ? [{
                field: action === "KEEP_CURRENT_SCOPE" ? "scope.excluded" : "scope.followUps",
                value: proposal.summary,
                provenance: "user" as const
              }]
            : [])
        ],
        now
      )
    });
  }

  updateConstraints(
    constraints: readonly string[],
    provenance: IntentProvenance = "user"
  ): IntentState {
    const values = unique(constraints);
    return this.commit({
      constraints: unique([...this.state.constraints, ...values]),
      provenance: [
        ...this.state.provenance,
        ...values.map((value) => provenanceRecord("constraints", value, provenance))
      ]
    });
  }
  applyCopilotResult(
    result: CopilotResponseEnvelope,
    contextPackageId?: string,
    now = new Date().toISOString()
  ): IntentState {
    const proposed = result.decisionsProposed ?? [];
    const decisions = [...this.state.decisions];
    const outcomes = [...this.state.outcomes];
    const nextLifecycle =
      result.blockers?.length &&
      ["UNDERSTANDING", "READY", "IN_PROGRESS", "REVIEW"].includes(this.state.lifecycle)
        ? "BLOCKED"
        : this.state.lifecycle;
    for (const proposal of proposed) {
      const existing = decisions.filter(
        (item) => item.title === proposal.title && item.recommendation === proposal.recommendation
      );
      const active = existing.some(
        (item) => item.status === "PROPOSED" || item.status === "ACCEPTED"
      );
      const rejectedWithoutNewEvidence = existing.some(
        (item) => item.status === "REJECTED" && !hasMateriallyNewEvidence(item, proposal.evidence)
      );
      if (!active && !rejectedWithoutNewEvidence) {
        decisions.unshift({
          id: randomUUID(),
          title: proposal.title,
          recommendation: proposal.recommendation,
          reason: proposal.reason,
          status: "PROPOSED",
          provenance: "copilot-recommendation",
          evidence: proposal.evidence,
          createdAt: now
        });
      }
    }
    const addOutcome = (
      category: IntentOutcome["category"],
      text: string | undefined,
      provenance: IntentProvenance,
      evidence?: ContextEvidenceReference[]
    ): void => {
      if (!text?.trim()) return;
      if (
        outcomes.some(
          (item) =>
            item.category === category &&
            item.text === text.trim() &&
            item.provenance === provenance
        )
      )
        return;
      outcomes.unshift({
        id: randomUUID(),
        category,
        text: text.trim(),
        provenance,
        evidence,
        createdAt: now
      });
    };
    const details = result.details;
    const detailRecord = details as Record<string, unknown> | undefined;
    const detailUnderstanding = optionalString(detailRecord?.understanding);
    const detailConstraints = stringArray(detailRecord?.constraintsDetected);
    const detailScope = stringArray(detailRecord?.likelyScope);
    const detailChangedAreas = stringArray(detailRecord?.changedAreas);
    const detailWorkPerformed = stringArray(detailRecord?.workPerformed);
    const proposedScopeAreas = result.scopeChange?.affectedAreas ?? [];
    const observedAreas = unique([
      ...(result.affectedAreas ?? []),
      ...detailChangedAreas,
      ...stringArray(detailRecord?.affectedAreas),
      ...(result.scopeChange?.affectedAreas ?? [])
    ]);
    const drift = detectScopeDrift(this.state, observedAreas);
    const incomingScopeChange = result.scopeChange;
    if (drift) {
      const proposal = this.createScopeChangeProposal(
        incomingScopeChange ?? {
          summary: `Work may affect ${drift?.affectedAreas.join(", ")}.`,
          affectedAreas: drift?.affectedAreas ?? [],
          reason: "Deterministic scope comparison found work outside the accepted boundary.",
          signals: drift?.signals,
          options: ["EXPAND_SCOPE", "KEEP_CURRENT_SCOPE", "CREATE_FOLLOW_UP", "DISCUSS"]
        },
        now
      );
      if (proposal) {
        const decision = decisions.find((item) => item.id === proposal.decisionId);
        if (decision) proposal.decisionId = decision.id;
      }
    }
    for (const decision of this.state.decisions)
      if (!decisions.some((item) => item.id === decision.id)) decisions.unshift(decision);
    addOutcome(
      "understanding",
      result.summary ?? result.userVisibleResponse,
      "derived-interpretation"
    );
    addOutcome("understanding", detailUnderstanding, "copilot-recommendation");
    for (const finding of result.findings ?? [])
      addOutcome("finding", finding.summary, "copilot-recommendation", finding.evidence);
    addOutcome("recommendation", result.recommendation, "copilot-recommendation");
    addOutcome("recommendation", result.scopeChange?.summary, "copilot-recommendation");
    for (const risk of result.risks ?? []) addOutcome("risk", risk, "copilot-recommendation");
    for (const blocker of result.blockers ?? [])
      addOutcome("blocker", blocker, "copilot-recommendation");
    for (const action of result.proposedActions ?? [])
      addOutcome("action", action, "copilot-recommendation");
    for (const work of detailWorkPerformed) addOutcome("action", work, "copilot-recommendation");
    for (const reference of [
      ...(result.evidenceReferences ?? []),
      ...(result.findings ?? []).flatMap((finding) => finding.evidence ?? []),
      ...(result.decisionsProposed ?? []).flatMap((decision) => decision.evidence ?? [])
    ]) {
      if (reference.verifiedAgainstContext)
        addOutcome("evidence", reference.label, "source-fact", [reference]);
    }
    const completedWork = unique([...this.state.completedWork, ...detailWorkPerformed]);
    return this.commit({
      decisions,
      scopeChangeProposals: this.state.scopeChangeProposals,
      outcomes: outcomes.slice(0, 200),
      understanding: unique([
        ...this.state.understanding,
        ...((result.summary ?? result.userVisibleResponse)
          ? [compact(result.summary ?? result.userVisibleResponse)]
          : []),
        ...(detailUnderstanding ? [compact(detailUnderstanding)] : [])
      ]),
      constraints: unique([...this.state.constraints, ...detailConstraints]),
      risks: unique([...this.state.risks, ...(result.risks ?? [])]),
      blockers: uniqueBlockers(
        this.state.blockers,
        result.blockers ?? [],
        "copilot-recommendation"
      ),
      affectedAreas: unique([
        ...this.state.affectedAreas,
        ...(result.affectedAreas ?? []),
        ...detailScope,
        ...detailChangedAreas,
        ...proposedScopeAreas
      ]),
      artifacts: unique([...this.state.artifacts, ...(result.artifacts ?? [])]),
      openQuestions: unique([...this.state.openQuestions, ...(result.questions ?? [])]),
      completedWork,
      latestCopilotInteraction: {
        summary: compact(result.summary ?? result.userVisibleResponse),
        contextPackageId,
        structuredStatus: result.structuredStatus,
        recordedAt: now,
        provenance: "copilot-recommendation"
      },
      contextReferences: unique([
        ...this.state.contextReferences,
        ...(contextPackageId ? [contextPackageId] : [])
      ]),
      intelligenceReferences: unique([
        ...this.state.intelligenceReferences,
        ...(result.evidenceReferences ?? [])
          .filter((reference) => reference.verifiedAgainstContext)
          .map((reference) => reference.id ?? reference.evidenceId ?? reference.label)
      ]),
      provenance: appendProvenanceMany(
        this.state,
        [
          ...(nextLifecycle !== this.state.lifecycle
            ? [
                {
                  field: "lifecycle",
                  value: nextLifecycle,
                  provenance: "copilot-recommendation" as const
                }
              ]
            : []),
          ...((result.summary ?? result.userVisibleResponse)
            ? [
                {
                  field: "understanding",
                  value: result.summary ?? result.userVisibleResponse,
                  provenance: "derived-interpretation" as const
                }
              ]
            : []),
          ...detailConstraints.map((value) => ({
            field: "constraints",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(result.risks ?? []).map((value) => ({
            field: "risks",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(result.blockers ?? []).map((value) => ({
            field: "blockers",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(result.affectedAreas ?? []).map((value) => ({
            field: "affectedAreas",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...detailScope.map((value) => ({
            field: "scope",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...detailChangedAreas.map((value) => ({
            field: "affectedAreas",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...proposedScopeAreas.map((value) => ({
            field: "affectedAreas",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(result.questions ?? []).map((value) => ({
            field: "openQuestions",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...detailWorkPerformed.map((value) => ({
            field: "completedWork",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(result.artifacts ?? []).map((value) => ({
            field: "artifacts",
            value,
            provenance: "copilot-recommendation" as const
          })),
          ...(contextPackageId
            ? [
                {
                  field: "contextReferences",
                  value: contextPackageId,
                  provenance: "derived-keystone-state" as const
                }
              ]
            : [])
        ],
        now
      ),
      lifecycle: nextLifecycle
    });
  }

  recordCopilotInteraction(
    summary: string | undefined,
    contextPackageId: string | undefined,
    structuredStatus: "complete" | "partial" | "absent",
    now = new Date().toISOString()
  ): IntentState {
    return this.commit({
      latestCopilotInteraction: {
        summary: summary ? compact(summary) : undefined,
        contextPackageId,
        structuredStatus,
        recordedAt: now,
        provenance: "copilot-recommendation"
      },
      contextReferences: unique([
        ...this.state.contextReferences,
        ...(contextPackageId ? [contextPackageId] : [])
      ]),
      provenance: appendProvenanceMany(
        this.state,
        contextPackageId
          ? [
              {
                field: "contextReferences",
                value: contextPackageId,
                provenance: "derived-keystone-state"
              }
            ]
          : [],
        now
      )
    });
  }
  acceptDecision(id: string): IntentState {
    return this.resolveDecision(id, "ACCEPTED", "user-accepted-copilot-recommendation");
  }

  supersedeDecision(id: string): IntentState {
    return this.resolveDecision(id, "SUPERSEDED", "derived-keystone-state");
  }
  rejectDecision(id: string, reason?: string): IntentState {
    const state = this.resolveDecision(id, "REJECTED", "user");
    const decision = state.decisions.find((item) => item.id === id);
    const rejectionReason = reason?.trim();
    if (decision && rejectionReason) decision.resolutionReason = rejectionReason;
    if (rejectionReason)
      state.understanding = unique([...state.understanding, `Rejected: ${rejectionReason}`]);
    return this.commit({
      ...state,
      provenance: rejectionReason
        ? appendProvenance(state, "understanding", `Rejected: ${rejectionReason}`, "user")
        : state.provenance
    });
  }
  addBlocker(summary: string, provenance: IntentProvenance = "user"): IntentState {
    if (!summary.trim()) return this.snapshot();
    if (this.state.lifecycle !== "BLOCKED") this.transitionLifecycle("BLOCKED", provenance);
    return this.commit({
      blockers: uniqueBlockers(this.state.blockers, [summary], provenance),
      provenance: appendProvenance(this.state, "blockers", summary, provenance)
    });
  }
  resolveBlocker(id: string): IntentState {
    if (!this.state.blockers.some((item) => item.id === id))
      throw new Error(`Intent blocker ${id} was not found.`);
    const blockers = this.state.blockers.map((item) =>
      item.id === id ? { ...item, resolvedAt: new Date().toISOString() } : item
    );
    let lifecycle = this.state.lifecycle;
    if (this.state.lifecycle === "BLOCKED" && blockers.every((item) => item.resolvedAt))
      lifecycle = this.transition("IN_PROGRESS").lifecycle;
    return this.commit({
      blockers,
      lifecycle,
      provenance: appendProvenance(this.state, `blockers.${id}`, "resolved", "user")
    });
  }
  recordCompletedWork(work: string): IntentState {
    return this.recordCompletedWorkFrom(work, "user");
  }

  recordCompletedWorkFrom(work: string, provenance: IntentProvenance = "user"): IntentState {
    const value = work.trim();
    if (!value) return this.snapshot();
    return this.commit({
      completedWork: unique([...this.state.completedWork, value]),
      provenance: appendProvenance(this.state, "completedWork", value, provenance)
    });
  }

  recordChange(
    change: string,
    provenance: IntentProvenance = "workspace-observation"
  ): IntentState {
    const value = change.trim();
    if (!value) return this.snapshot();
    return this.commit({
      changes: unique([...this.state.changes, value]),
      provenance: appendProvenance(this.state, "changes", value, provenance)
    });
  }

  recordArtifact(
    artifact: string,
    provenance: IntentProvenance = "derived-keystone-state"
  ): IntentState {
    const value = artifact.trim();
    if (!value) return this.snapshot();
    return this.commit({
      artifacts: unique([...this.state.artifacts, value]),
      provenance: appendProvenance(this.state, "artifacts", value, provenance)
    });
  }

  private resolveDecision(
    id: string,
    status: IntentDecision["status"],
    provenance: IntentProvenance
  ): IntentState {
    const decision = this.state.decisions.find((item) => item.id === id);
    if (!decision) throw new Error(`Intent decision ${id} was not found.`);
    if (decision.status !== "PROPOSED")
      throw new Error(`Intent decision ${id} is already ${decision.status}.`);
    const decisions = this.state.decisions.map((item) =>
      item.id === id ? { ...item, status, provenance, resolvedAt: new Date().toISOString() } : item
    );
    const lifecycle: IntentLifecycle =
      this.state.lifecycle === "UNDERSTANDING" &&
      decisions.every((item) => item.status !== "PROPOSED") &&
      this.state.openQuestions.length === 0
        ? "READY"
        : this.state.lifecycle;
    const decisionProvenance = appendProvenance(
      this.state,
      `decisions.${status}`,
      decision.recommendation,
      provenance
    );
    return this.commit({
      decisions,
      lifecycle,
      provenance:
        lifecycle !== this.state.lifecycle
          ? [...decisionProvenance, provenanceRecord("lifecycle", lifecycle, provenance)]
          : decisionProvenance
    });
  }
  private commit(patch: Partial<IntentState>): IntentState {
    this.state = {
      ...this.state,
      ...patch,
      provenance: patch.provenance ?? this.state.provenance,
      updatedAt: new Date().toISOString()
    };
    return this.snapshot();
  }

  private createScopeChangeProposal(
    proposal: CopilotScopeChangeProposal,
    now: string
  ): IntentScopeChangeProposal | undefined {
    const areas = unique(proposal.affectedAreas);
    if (!areas.length) return undefined;
    const existing = this.state.scopeChangeProposals.find(
      (item) => item.status === "PROPOSED" && sameAreas(item.affectedAreas, areas)
    );
    if (existing) return existing;
    const id = proposal.id ?? randomUUID();
    const decision: IntentDecision = {
      id: randomUUID(),
      title: "Scope change recommended",
      recommendation: proposal.summary,
      reason: proposal.reason,
      status: "PROPOSED",
      provenance: "copilot-recommendation",
      createdAt: now
    };
    this.state.decisions.unshift(decision);
    const next: IntentScopeChangeProposal = {
      ...proposal,
      id,
      affectedAreas: areas,
      originalScope: structuredClone(this.state.scope),
      status: "PROPOSED",
      provenance: "copilot-recommendation",
      createdAt: now,
      decisionId: decision.id,
      options: proposal.options.length
        ? proposal.options
        : ["EXPAND_SCOPE", "KEEP_CURRENT_SCOPE", "CREATE_FOLLOW_UP", "DISCUSS"]
    };
    this.state.scopeChangeProposals = [next, ...this.state.scopeChangeProposals].slice(0, 50);
    return next;
  }
}

/** Existing JSON storage is the single persistence boundary for Intent state. */
export class IntentStateStore {
  constructor(
    private readonly workspaceRoot: string,
    private readonly intentId: string
  ) {}

  async read(): Promise<IntentState | undefined> {
    return new JsonStorage<IntentState | undefined>(
      this.workspaceRoot,
      `.keystone/tasks/${this.intentId}/intent-state.json`,
      undefined
    ).read();
  }

  async write(state: IntentState): Promise<void> {
    await new JsonStorage<IntentState>(
      this.workspaceRoot,
      `.keystone/tasks/${this.intentId}/intent-state.json`,
      state
    ).write(state);
  }
}

const allowedTransitions: Record<IntentLifecycle, IntentLifecycle[]> = {
  DRAFT: ["UNDERSTANDING"],
  UNDERSTANDING: ["READY", "DRAFT", "BLOCKED"],
  READY: ["IN_PROGRESS", "UNDERSTANDING", "BLOCKED"],
  IN_PROGRESS: ["BLOCKED", "REVIEW", "READY"],
  BLOCKED: ["IN_PROGRESS", "READY"],
  REVIEW: ["COMPLETE", "IN_PROGRESS"],
  COMPLETE: ["REVIEW"]
};

function normalizeState(state: IntentState): IntentState {
  const legacy = state as unknown as {
    id?: unknown;
    goal?: unknown;
    summary?: unknown;
    contextPackageId?: unknown;
    lifecycle?: unknown;
    updatedAt?: unknown;
  };
  const goal =
    typeof legacy.goal === "string" && legacy.goal.trim()
      ? legacy.goal
      : typeof legacy.summary === "string" && legacy.summary.trim()
        ? legacy.summary
        : "Restored Keystone Intent work.";
  const scope = state.scope ?? { included: [], excluded: [], boundaries: [], followUps: [] };
  const lifecycle = isIntentLifecycle(legacy.lifecycle) ? legacy.lifecycle : "IN_PROGRESS";
  const updatedAt =
    typeof legacy.updatedAt === "string" && legacy.updatedAt.trim()
      ? legacy.updatedAt
      : new Date().toISOString();
  const latestCopilotInteraction = state.latestCopilotInteraction
    ? {
        ...state.latestCopilotInteraction,
        provenance: state.latestCopilotInteraction.provenance ?? "copilot-recommendation"
      }
    : undefined;
  return {
    ...state,
    version: 1,
    id:
      typeof legacy.id === "string" && legacy.id.trim()
        ? legacy.id
        : `restored-intent-${legacy.contextPackageId ?? "workspace"}`,
    goal,
    currentObjective: state.currentObjective ?? goal,
    lifecycle,
    updatedAt,
    scope: {
      included: scope.included ?? [],
      excluded: scope.excluded ?? [],
      boundaries: scope.boundaries ?? [],
      followUps: scope.followUps ?? []
    },
    scopeChangeProposals: state.scopeChangeProposals ?? [],
    decisions: state.decisions ?? [],
    blockers: state.blockers ?? [],
    understanding: state.understanding ?? [],
    constraints: state.constraints ?? [],
    completedWork: state.completedWork ?? [],
    openQuestions: state.openQuestions ?? [],
    risks: state.risks ?? [],
    affectedAreas: state.affectedAreas ?? [],
    changes: state.changes ?? [],
    artifacts: state.artifacts ?? [],
    outcomes: state.outcomes ?? [],
    contextReferences: state.contextReferences ?? [],
    intelligenceReferences: state.intelligenceReferences ?? [],
    latestCopilotInteraction,
    provenance: state.provenance ?? buildLegacyProvenance(state, updatedAt)
  };
}
function isIntentLifecycle(value: unknown): value is IntentLifecycle {
  return [
    "DRAFT",
    "UNDERSTANDING",
    "READY",
    "IN_PROGRESS",
    "BLOCKED",
    "REVIEW",
    "COMPLETE"
  ].includes(value as string);
}
function unique(items: readonly string[]): string[] {
  return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
}

function sameAreas(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left.map(normalizeArea));
  const b = new Set(right.map(normalizeArea));
  return a.size === b.size && [...a].every((value) => b.has(value));
}

function normalizeArea(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function areaWithin(area: string, accepted: string): boolean {
  const candidate = normalizeArea(area);
  const boundary = normalizeArea(accepted);
  return candidate === boundary || candidate.startsWith(`${boundary}/`) || boundary.includes(candidate);
}

function detectScopeDrift(
  state: IntentState,
  observedAreas: readonly string[]
): { affectedAreas: string[]; signals: CopilotScopeChangeProposal["signals"] } | undefined {
  const accepted = [...state.scope.included, ...state.affectedAreas];
  if (!accepted.length) return undefined;
  const outside = unique(
    observedAreas.filter(
      (area) =>
        !state.scope.excluded.some((excluded) => areaWithin(area, excluded)) &&
        !accepted.some((included) => areaWithin(area, included))
    )
  );
  if (!outside.length) return undefined;
  return {
    affectedAreas: outside,
    signals: ["affected-component-outside-scope", "new-dependency"]
  };
}

function scopeValues(scope: Partial<IntentScope>): string[] {
  return unique([
    ...(scope.included ?? []),
    ...(scope.excluded ?? []),
    ...(scope.boundaries ?? []),
    ...(scope.followUps ?? [])
  ]);
}
function uniqueBlockers(
  existing: IntentState["blockers"],
  additions: string[],
  provenance: IntentProvenance
): IntentState["blockers"] {
  const result = [...existing];
  for (const summary of unique(additions))
    if (!result.some((item) => item.summary === summary && !item.resolvedAt))
      result.push({ id: randomUUID(), summary, provenance });
  return result;
}

function hasMateriallyNewEvidence(
  previous: IntentDecision,
  incoming: readonly ContextEvidenceReference[] | undefined
): boolean {
  if (!incoming?.length) return false;
  const known = new Set(
    (previous.evidence ?? []).map((item) =>
      [
        item.id ?? item.evidenceId ?? "",
        item.kind,
        item.label,
        item.path ?? "",
        item.startLine ?? ""
      ].join("|")
    )
  );
  return incoming.some(
    (item) =>
      !known.has(
        [
          item.id ?? item.evidenceId ?? "",
          item.kind,
          item.label,
          item.path ?? "",
          item.startLine ?? ""
        ].join("|")
      )
  );
}

function provenanceRecord(
  field: string,
  value: string,
  provenance: IntentProvenance,
  recordedAt = new Date().toISOString(),
  sourceId?: string
): IntentProvenanceRecord {
  return {
    field,
    value: compact(value),
    provenance,
    recordedAt,
    ...(sourceId ? { sourceId } : {})
  };
}

function appendProvenance(
  state: IntentState,
  field: string,
  value: string,
  provenance: IntentProvenance,
  now = new Date().toISOString()
): IntentProvenanceRecord[] {
  return appendProvenanceMany(state, [{ field, value, provenance }], now);
}

function appendProvenanceMany(
  state: IntentState,
  values: readonly {
    field: string;
    value: string;
    provenance: IntentProvenance;
    sourceId?: string;
  }[],
  now = new Date().toISOString()
): IntentProvenanceRecord[] {
  const result = [...state.provenance];
  for (const item of values) {
    const value = compact(item.value);
    if (!value) continue;
    const previous = [...result]
      .reverse()
      .find(
        (record: IntentProvenanceRecord) => record.field === item.field && record.value === value
      );
    if (previous && previous.provenance === item.provenance) continue;
    result.push(provenanceRecord(item.field, value, item.provenance, now, item.sourceId));
  }
  return result.slice(-500);
}

function buildLegacyProvenance(state: IntentState, now: string): IntentProvenanceRecord[] {
  const values: Array<[string, string]> = [
    ["goal", state.goal],
    ["lifecycle", state.lifecycle],
    ["currentObjective", state.currentObjective],
    ...state.understanding.map((value) => ["understanding", value] as [string, string]),
    ...state.constraints.map((value) => ["constraints", value] as [string, string]),
    ...state.completedWork.map((value) => ["completedWork", value] as [string, string]),
    ...state.openQuestions.map((value) => ["openQuestions", value] as [string, string]),
    ...state.risks.map((value) => ["risks", value] as [string, string]),
    ...state.affectedAreas.map((value) => ["affectedAreas", value] as [string, string]),
    ...state.changes.map((value) => ["changes", value] as [string, string]),
    ...state.artifacts.map((value) => ["artifacts", value] as [string, string]),
    ...state.contextReferences.map((value) => ["contextReferences", value] as [string, string]),
    ...state.intelligenceReferences.map(
      (value) => ["intelligenceReferences", value] as [string, string]
    )
  ];
  return values.map(([field, value]) =>
    provenanceRecord(field, value, "derived-keystone-state", now)
  );
}

function compact(value: string, limit = 2_000): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1).trim()}…` : normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? unique(value.filter((item): item is string => typeof item === "string"))
    : [];
}
