import { createHash, randomUUID } from "node:crypto";

export type SDLCStoryType =
  | "research"
  | "specification"
  | "design"
  | "development"
  | "existing-test-analysis"
  | "new-test-creation"
  | "test-impact-analysis"
  | "failed-test-investigation"
  | "flaky-test-analysis"
  | "security-review"
  | "performance-review"
  | "modernization-review"
  | "code-review"
  | "pr-review"
  | "documentation"
  | "completion";

export type SDLCStoryStatus =
  | "draft"
  | "ready"
  | "in-progress"
  | "awaiting-delegation-approval"
  | "delegated"
  | "awaiting-validation"
  | "review-required"
  | "completed"
  | "blocked"
  | "paused"
  | "cancelled"
  | "superseded"
  | "handed-off";

export interface SDLCDelegation {
  id: string;
  status: "pending-approval" | "approved" | "delegated" | "completed" | "rejected";
  agent: string;
  skills: string[];
  instructions: string[];
  promptHash: string;
  approvedAt?: string;
  delegatedAt?: string;
  completedAt?: string;
}

export interface SDLCValidationRun {
  id: string;
  status: "passed" | "failed";
  commands: string[];
  evidence: string[];
  completedAt: string;
}

export interface SDLCFinding {
  id: string;
  kind: "qa" | "security" | "performance" | "review" | "architecture";
  severity: "info" | "low" | "medium" | "high" | "critical";
  summary: string;
  status: "open" | "accepted" | "resolved";
  evidence: string[];
  recordedAt: string;
  resolvedAt?: string;
}

export interface SDLCStoryUpdate {
  evidence?: readonly string[];
  satisfiedCriteria?: readonly string[];
  blockers?: readonly string[];
  decision?: string;
}

export interface SDLCStory {
  id: string;
  intentId: string;
  type: SDLCStoryType;
  title: string;
  objective: string;
  status: SDLCStoryStatus;
  dependencies: string[];
  acceptanceCriteria: string[];
  satisfiedCriteria: string[];
  evidence: string[];
  blockers: string[];
  decisions: string[];
  contextPackId?: string;
  delegation?: SDLCDelegation;
  validationRuns: SDLCValidationRun[];
  findings: SDLCFinding[];
  createdAt: string;
  updatedAt: string;
}

export interface SDLCResearchEvidence {
  id: string;
  kind: "file" | "symbol" | "api" | "service" | "data" | "test" | "risk" | "flow" | "architecture";
  label: string;
  summary: string;
  path?: string;
  okfId?: string;
  confidence?: number;
}

export interface SDLCResearchDocument {
  id: string;
  title: string;
  problemStatement: string;
  repositoryEvidence: string[];
  evidenceMatrix: SDLCResearchEvidence[];
  affectedArchitecture: string[];
  affectedFlows: string[];
  affectedTests: string[];
  risks: string[];
  constraints: string[];
  unknowns: string[];
  recommendedApproach: string[];
  testingStrategy: string[];
  markdown: string;
  generatedAt: string;
}

export interface SDLCSpecificationDocument {
  id: string;
  title: string;
  summary: string;
  functionalRequirements: string[];
  nonFunctionalRequirements: string[];
  architectureDecisions: string[];
  affectedInterfaces: string[];
  dataChanges: string[];
  constraints: string[];
  validationPlan: string[];
  acceptanceCriteria: string[];
  unknowns: string[];
  markdown: string;
  generatedAt: string;
}

export interface SDLCBacklogStory {
  id: string;
  kind: "user-story" | "quality-story";
  title: string;
  description: string;
  acceptanceCriteria: string[];
  linkedSdlcStoryTypes: SDLCStoryType[];
  evidence: string[];
  dependencies: string[];
  scope: { files: string[]; symbols: string[]; interfaces: string[] };
  status: "draft" | "approved" | "published";
  externalId?: string;
}

export interface SDLCPlanningContext {
  intentId?: string;
  researchDocument?: SDLCResearchDocument;
  researchApproved?: boolean;
  relevantFiles?: readonly string[];
  relevantSymbols?: readonly string[];
  relevantApis?: readonly string[];
  relevantServices?: readonly string[];
  dataEntities?: readonly string[];
  affectedFlows?: readonly string[];
  relatedTests?: readonly string[];
  missingTests?: readonly string[];
  qaChecklist?: readonly string[];
  securityRisk?: string;
  performanceRisk?: string;
  modernizationNotes?: readonly string[];
  architecture?: string;
  evidence?: readonly SDLCResearchEvidence[];
  functionalRequirements?: readonly string[];
  nonFunctionalRequirements?: readonly string[];
  constraints?: readonly string[];
  source?: {
    kind: "local" | "valueedge";
    featureId?: string;
    featureName?: string;
    featureUrl?: string;
  };
}

export interface SDLCPlan {
  id: string;
  intentId: string;
  intent: string;
  specificationStatus: "draft" | "approved" | "rejected";
  source: {
    kind: "local" | "valueedge";
    featureId?: string;
    featureName?: string;
    featureUrl?: string;
  };
  researchDocument: SDLCResearchDocument;
  specificationDocument: SDLCSpecificationDocument;
  backlogStories: SDLCBacklogStory[];
  stories: SDLCStory[];
  createdAt: string;
  updatedAt: string;
}

const transitions: Record<SDLCStoryStatus, readonly SDLCStoryStatus[]> = {
  draft: ["ready", "cancelled", "superseded"],
  ready: ["in-progress", "blocked", "cancelled", "superseded"],
  "in-progress": [
    "awaiting-delegation-approval",
    "awaiting-validation",
    "review-required",
    "paused",
    "blocked",
    "cancelled",
    "handed-off"
  ],
  "awaiting-delegation-approval": ["delegated", "in-progress", "cancelled", "handed-off"],
  delegated: ["awaiting-validation", "review-required", "blocked", "handed-off"],
  "awaiting-validation": ["completed", "review-required", "blocked", "in-progress"],
  "review-required": ["in-progress", "completed", "blocked", "handed-off"],
  completed: [],
  blocked: ["ready", "in-progress", "cancelled", "handed-off"],
  paused: ["in-progress", "cancelled", "handed-off"],
  cancelled: [],
  superseded: [],
  "handed-off": ["in-progress"]
};

const criteria: Record<SDLCStoryType, readonly string[]> = {
  research: [
    "Relevant OKF evidence is linked",
    "Affected architecture, flows, tests, risks, and constraints are identified"
  ],
  specification: [
    "Functional and non-functional behavior is documented",
    "Acceptance criteria are explicit and user-approved"
  ],
  design: [
    "Implementation boundaries and dependencies are documented",
    "The design respects repository conventions and read-only Git policy"
  ],
  development: [
    "Implementation addresses the approved specification",
    "Changed files and symbols are recorded"
  ],
  "existing-test-analysis": [
    "Relevant existing tests are identified",
    "Coverage relationships and gaps are recorded"
  ],
  "test-impact-analysis": [
    "Impacted tests are selected from change and graph evidence",
    "Regression risk is documented"
  ],
  "new-test-creation": [
    "Missing tests are implemented or explicitly deferred with reason",
    "New tests map to acceptance criteria"
  ],
  "failed-test-investigation": [
    "Every observed failure is classified",
    "Real defects, environment failures, and test defects are distinguished"
  ],
  "flaky-test-analysis": [
    "Flakiness evidence is recorded",
    "Quarantine or stabilization guidance is documented without silent mutation"
  ],
  "security-review": [
    "Security-sensitive paths and trust boundaries are reviewed",
    "Findings are resolved, accepted, or blocked with evidence"
  ],
  "performance-review": [
    "Performance-sensitive paths are reviewed",
    "Findings are resolved, accepted, or blocked with evidence"
  ],
  "modernization-review": [
    "Modernization impact is assessed",
    "Any recommendation preserves behavior and remains user-approved"
  ],
  "code-review": [
    "Implementation is checked against specification and architecture",
    "QA, security, and performance evidence is reviewed"
  ],
  "pr-review": [
    "Read-only diff review content is prepared",
    "No remote pull/merge-request mutation was performed"
  ],
  documentation: [
    "User-facing and engineering documentation impact is resolved",
    "Documentation matches implemented behavior"
  ],
  completion: [
    "All dependent stories are completed",
    "No unresolved blocker remains and the exact outcome is recorded"
  ]
};

type Definition = readonly [SDLCStoryType, string, readonly SDLCStoryType[]];
const definitions: readonly Definition[] = [
  ["research", "Research repository intelligence", []],
  ["specification", "Review and approve specification", ["research"]],
  ["design", "Design implementation", ["specification"]],
  ["development", "Implement change", ["design"]],
  ["existing-test-analysis", "Analyze existing tests", ["design"]],
  ["test-impact-analysis", "Analyze impacted tests", ["development", "existing-test-analysis"]],
  ["new-test-creation", "Create missing tests", ["test-impact-analysis"]],
  ["failed-test-investigation", "Investigate failed tests", ["new-test-creation"]],
  [
    "flaky-test-analysis",
    "Analyze flaky tests",
    ["existing-test-analysis", "test-impact-analysis"]
  ],
  ["security-review", "Review security", ["development"]],
  ["performance-review", "Review performance", ["development"]],
  ["modernization-review", "Review modernization impact", ["development"]],
  [
    "code-review",
    "Review implementation",
    [
      "new-test-creation",
      "failed-test-investigation",
      "flaky-test-analysis",
      "security-review",
      "performance-review",
      "modernization-review"
    ]
  ],
  ["pr-review", "Prepare read-only PR review", ["code-review"]],
  ["documentation", "Update documentation", ["code-review"]],
  ["completion", "Complete intent", ["pr-review", "documentation"]]
];

export class SDLCEngine {
  createPlan(intent: string, context: SDLCPlanningContext = {}): SDLCPlan {
    const normalized = intent.trim();
    if (!normalized) throw new Error("An intent is required.");
    const intentId = context.intentId ?? randomUUID();
    const now = new Date().toISOString();
    const ids = new Map<SDLCStoryType, string>();
    for (const [type] of definitions) ids.set(type, randomUUID());
    const stories = definitions.map(([type, title, dependencies]): SDLCStory => ({
      id: ids.get(type)!,
      intentId,
      type,
      title,
      objective: title,
      status: type === "research" ? "ready" : "draft",
      dependencies: dependencies.map((dependency) => ids.get(dependency)!),
      acceptanceCriteria: [...criteria[type]],
      satisfiedCriteria: [],
      evidence: [],
      blockers: [],
      decisions: [],
      validationRuns: [],
      findings: [],
      createdAt: now,
      updatedAt: now
    }));
    const researchDocument =
      context.researchDocument ?? buildResearchDocument(intentId, normalized, context, now);
    const specificationDocument = buildSpecificationDocument(
      intentId,
      normalized,
      context,
      researchDocument,
      now
    );
    const backlogStories = buildBacklogStories(intentId, normalized, context);
    let plan: SDLCPlan = {
      id: randomUUID(),
      intentId,
      intent: normalized,
      specificationStatus: "draft",
      source: context.source ?? { kind: "local" },
      researchDocument,
      specificationDocument,
      backlogStories,
      stories,
      createdAt: now,
      updatedAt: now
    };
    if (context.researchApproved) {
      const research = this.story(plan, "research");
      plan = this.updateStory(plan, research.id, {
        ...research,
        status: "completed",
        satisfiedCriteria: [...research.acceptanceCriteria],
        evidence: unique([
          ...research.evidence,
          "Repository R&D was explicitly reviewed and approved before SDLC plan creation."
        ]),
        decisions: unique([...research.decisions, "Pre-plan repository research approved by user"]),
        updatedAt: now
      });
      plan = this.unlock(plan);
    }
    return plan;
  }

  approveSpecification(plan: SDLCPlan): SDLCPlan {
    const story = this.story(plan, "specification");
    if (story.status !== "ready" && story.status !== "in-progress")
      throw new Error("Research must be completed before specification approval.");
    const now = new Date().toISOString();
    const updated = this.updateStory(plan, story.id, {
      ...story,
      status: "completed",
      satisfiedCriteria: [...story.acceptanceCriteria],
      evidence: unique([...story.evidence, "User approved the specification in Keystone."]),
      decisions: unique([...story.decisions, "Specification approved by user"]),
      updatedAt: now
    });
    return this.unlock({
      ...updated,
      specificationStatus: "approved",
      backlogStories: updated.backlogStories.map((story) =>
        story.status === "draft" ? { ...story, status: "approved" as const } : story
      ),
      updatedAt: now
    });
  }

  rejectSpecification(plan: SDLCPlan, reason = "Specification rejected by user."): SDLCPlan {
    const story = this.story(plan, "specification");
    const now = new Date().toISOString();
    return {
      ...this.updateStory(plan, story.id, {
        ...story,
        status: "review-required",
        decisions: unique([...story.decisions, reason]),
        updatedAt: now
      }),
      specificationStatus: "rejected",
      updatedAt: now
    };
  }

  transition(
    plan: SDLCPlan,
    storyId: string,
    next: SDLCStoryStatus,
    update: SDLCStoryUpdate = {}
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    if (story.type === "specification" && next === "completed")
      throw new Error("Use the explicit specification approval action.");
    if (!transitions[story.status].includes(next))
      throw new Error(`Invalid SDLC transition ${story.status} → ${next}`);
    if (next === "in-progress") this.assertDependencies(plan, story);
    const merged: SDLCStory = {
      ...story,
      evidence: unique([...story.evidence, ...(update.evidence ?? [])]),
      satisfiedCriteria: unique([...story.satisfiedCriteria, ...(update.satisfiedCriteria ?? [])]),
      blockers: update.blockers ? [...update.blockers] : story.blockers,
      decisions: update.decision ? unique([...story.decisions, update.decision]) : story.decisions,
      status: next,
      updatedAt: new Date().toISOString()
    };
    if (next === "completed") this.assertCompletable(merged);
    const changed = this.updateStory(plan, storyId, merged);
    return next === "completed" ? this.unlock(changed) : changed;
  }

  recordEvidence(
    plan: SDLCPlan,
    storyId: string,
    evidence: readonly string[],
    satisfiedCriteria: readonly string[] = []
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    return this.updateStory(plan, storyId, {
      ...story,
      evidence: unique([...story.evidence, ...evidence]),
      satisfiedCriteria: unique([...story.satisfiedCriteria, ...satisfiedCriteria]),
      updatedAt: new Date().toISOString()
    });
  }

  prepareDelegation(
    plan: SDLCPlan,
    storyId: string,
    input: {
      agent: string;
      skills?: readonly string[];
      instructions?: readonly string[];
      prompt: string;
      contextPackId?: string;
    }
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    if (story.status !== "in-progress")
      throw new Error("Delegation can only be prepared for an in-progress story.");
    const now = new Date().toISOString();
    const delegation: SDLCDelegation = {
      id: randomUUID(),
      status: "pending-approval",
      agent: input.agent.trim() || "GitHub Copilot",
      skills: unique(input.skills ?? []),
      instructions: unique(input.instructions ?? []),
      promptHash: createHash("sha256").update(input.prompt).digest("hex")
    };
    return this.updateStory(plan, storyId, {
      ...story,
      status: "awaiting-delegation-approval",
      contextPackId: input.contextPackId,
      delegation,
      updatedAt: now
    });
  }

  approveDelegation(plan: SDLCPlan, storyId: string): SDLCPlan {
    const story = this.storyById(plan, storyId);
    if (story.status !== "awaiting-delegation-approval" || !story.delegation)
      throw new Error("There is no delegation awaiting approval.");
    const now = new Date().toISOString();
    return this.updateStory(plan, storyId, {
      ...story,
      status: "delegated",
      delegation: { ...story.delegation, status: "delegated", approvedAt: now, delegatedAt: now },
      decisions: unique([...story.decisions, "Delegation approved by user"]),
      updatedAt: now
    });
  }

  completeDelegation(plan: SDLCPlan, storyId: string, evidence: readonly string[] = []): SDLCPlan {
    const story = this.storyById(plan, storyId);
    if (story.status !== "delegated" || !story.delegation)
      throw new Error("The story is not delegated.");
    const now = new Date().toISOString();
    return this.updateStory(plan, storyId, {
      ...story,
      status: "awaiting-validation",
      delegation: { ...story.delegation, status: "completed", completedAt: now },
      evidence: unique([...story.evidence, ...evidence]),
      updatedAt: now
    });
  }

  recordValidation(
    plan: SDLCPlan,
    storyId: string,
    input: { status: "passed" | "failed"; commands: readonly string[]; evidence: readonly string[] }
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    const now = new Date().toISOString();
    const run: SDLCValidationRun = {
      id: randomUUID(),
      status: input.status,
      commands: unique(input.commands),
      evidence: unique(input.evidence),
      completedAt: now
    };
    const status: SDLCStoryStatus = input.status === "failed" ? "review-required" : story.status;
    return this.updateStory(plan, storyId, {
      ...story,
      status,
      validationRuns: [...story.validationRuns, run],
      evidence: unique([...story.evidence, ...run.evidence]),
      updatedAt: now
    });
  }

  recordFinding(
    plan: SDLCPlan,
    storyId: string,
    input: Omit<SDLCFinding, "id" | "recordedAt">
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    const finding: SDLCFinding = {
      ...input,
      id: randomUUID(),
      evidence: unique(input.evidence),
      recordedAt: new Date().toISOString()
    };
    return this.updateStory(plan, storyId, {
      ...story,
      findings: [...story.findings, finding],
      updatedAt: finding.recordedAt
    });
  }

  resolveFinding(
    plan: SDLCPlan,
    storyId: string,
    findingId: string,
    status: "accepted" | "resolved"
  ): SDLCPlan {
    const story = this.storyById(plan, storyId);
    if (!story.findings.some((finding) => finding.id === findingId))
      throw new Error(`Unknown SDLC finding: ${findingId}`);
    const now = new Date().toISOString();
    return this.updateStory(plan, storyId, {
      ...story,
      findings: story.findings.map((finding) =>
        finding.id === findingId ? { ...finding, status, resolvedAt: now } : finding
      ),
      updatedAt: now
    });
  }

  isComplete(plan: SDLCPlan): boolean {
    return plan.stories.every((story) => story.status === "completed");
  }

  private assertDependencies(plan: SDLCPlan, story: SDLCStory): void {
    const incomplete = story.dependencies.filter(
      (id) => this.storyById(plan, id).status !== "completed"
    );
    if (incomplete.length) throw new Error("Story dependencies are not complete.");
  }

  private assertCompletable(story: SDLCStory): void {
    const missing = story.acceptanceCriteria.filter(
      (item) => !story.satisfiedCriteria.includes(item)
    );
    if (missing.length)
      throw new Error(`Acceptance criteria are not satisfied: ${missing.join("; ")}`);
    if (!story.evidence.length)
      throw new Error("Completion requires at least one evidence record.");
    if (story.blockers.length)
      throw new Error("A story with unresolved blockers cannot be completed.");
    const unresolved = story.findings.filter(
      (finding) =>
        finding.status === "open" &&
        (finding.severity === "high" || finding.severity === "critical")
    );
    if (unresolved.length)
      throw new Error(
        "High or critical findings must be resolved or explicitly accepted before completion."
      );
    if (
      requiresValidation(story.type) &&
      !story.validationRuns.some((run) => run.status === "passed")
    )
      throw new Error("This SDLC story requires a passing validation run before completion.");
  }

  private unlock(plan: SDLCPlan): SDLCPlan {
    const now = new Date().toISOString();
    return {
      ...plan,
      stories: plan.stories.map((story) =>
        story.status === "draft" &&
        story.dependencies.every((id) => this.storyById(plan, id).status === "completed")
          ? { ...story, status: "ready" as const, updatedAt: now }
          : story
      ),
      updatedAt: now
    };
  }

  private story(plan: SDLCPlan, type: SDLCStoryType): SDLCStory {
    const value = plan.stories.find((item) => item.type === type);
    if (!value) throw new Error(`SDLC story is missing: ${type}`);
    return value;
  }

  private storyById(plan: SDLCPlan, id: string): SDLCStory {
    const value = plan.stories.find((item) => item.id === id);
    if (!value) throw new Error(`Unknown SDLC story: ${id}`);
    return value;
  }

  private updateStory(plan: SDLCPlan, id: string, story: SDLCStory): SDLCPlan {
    return {
      ...plan,
      stories: plan.stories.map((item) => (item.id === id ? story : item)),
      updatedAt: story.updatedAt
    };
  }
}

function requiresValidation(type: SDLCStoryType): boolean {
  return new Set<SDLCStoryType>([
    "development",
    "existing-test-analysis",
    "test-impact-analysis",
    "new-test-creation",
    "failed-test-investigation",
    "flaky-test-analysis",
    "security-review",
    "performance-review",
    "modernization-review",
    "code-review",
    "pr-review"
  ]).has(type);
}

export function createResearchDocument(
  intentId: string,
  intent: string,
  context: SDLCPlanningContext,
  generatedAt = new Date().toISOString()
): SDLCResearchDocument {
  return buildResearchDocument(intentId, intent.trim(), context, generatedAt);
}

function buildResearchDocument(
  intentId: string,
  intent: string,
  context: SDLCPlanningContext,
  generatedAt: string
): SDLCResearchDocument {
  const explicitEvidence = [...(context.evidence ?? [])];
  const evidenceMatrix: SDLCResearchEvidence[] = dedupeEvidence([
    ...explicitEvidence,
    ...(context.relevantFiles ?? []).map((file, index) => ({
      id: `file-${index}-${stableFragment(file)}`,
      kind: "file" as const,
      label: file,
      summary: "Repository file selected by intent and graph retrieval.",
      path: file
    })),
    ...(context.relevantSymbols ?? []).map((symbol, index) => ({
      id: `symbol-${index}-${stableFragment(symbol)}`,
      kind: "symbol" as const,
      label: symbol,
      summary: "Symbol selected by semantic or structural intelligence."
    })),
    ...(context.relevantApis ?? []).map((api, index) => ({
      id: `api-${index}-${stableFragment(api)}`,
      kind: "api" as const,
      label: api,
      summary: "API contract affected by the intent."
    })),
    ...(context.relevantServices ?? []).map((service, index) => ({
      id: `service-${index}-${stableFragment(service)}`,
      kind: "service" as const,
      label: service,
      summary: "Service boundary affected by the intent."
    })),
    ...(context.dataEntities ?? []).map((entity, index) => ({
      id: `data-${index}-${stableFragment(entity)}`,
      kind: "data" as const,
      label: entity,
      summary: "Data entity or persistence contract affected by the intent."
    })),
    ...(context.affectedFlows ?? []).map((flow, index) => ({
      id: `flow-${index}-${stableFragment(flow)}`,
      kind: "flow" as const,
      label: flow,
      summary: "Call or data flow selected from graph/CPG evidence."
    })),
    ...(context.relatedTests ?? []).map((test, index) => ({
      id: `test-${index}-${stableFragment(test)}`,
      kind: "test" as const,
      label: test,
      summary: "Existing test related to the affected implementation.",
      path: test
    }))
  ])
    .filter(researchEvidencePresentable)
    .sort(
      (a, b) =>
        researchEvidenceRank(a) - researchEvidenceRank(b) ||
        (b.confidence ?? 0) - (a.confidence ?? 0) ||
        a.label.localeCompare(b.label)
    )
    .slice(0, 28);
  const repositoryEvidence = evidenceMatrix.map(
    (item) =>
      `${humanize(item.kind)}: ${item.label}${item.path && item.path !== item.label ? ` (${item.path})` : ""} — ${item.summary}`
  );
  const affectedArchitecture = unique([
    context.architecture ? `Detected architecture: ${context.architecture}` : "",
    ...(context.relevantServices ?? []).map((service) => `Service boundary: ${service}`),
    ...(context.relevantApis ?? []).map((api) => `Interface contract: ${api}`),
    ...(context.dataEntities ?? []).map((entity) => `Data boundary: ${entity}`),
    ...(context.modernizationNotes ?? [])
  ]);
  const affectedFlows = unique([
    ...(context.affectedFlows ?? []),
    ...(context.relevantSymbols ?? []).map(
      (symbol) => `Trace callers, references, state changes, and side effects around ${symbol}.`
    )
  ]);
  const affectedTests = unique([
    ...(context.relatedTests ?? []),
    ...(context.missingTests ?? []).map((test) => `Missing coverage: ${test}`)
  ]);
  const risks = unique([
    context.securityRisk ? `Security risk: ${context.securityRisk}` : "",
    context.performanceRisk ? `Performance risk: ${context.performanceRisk}` : "",
    ...(context.modernizationNotes ?? []).map((item) => `Modernization consideration: ${item}`)
  ]);
  const constraints = unique([
    "Keystone Git and merge-request access is read-only.",
    "Copilot delegation requires explicit user approval.",
    "Every implementation story must close its evidence and validation gates.",
    ...(context.constraints ?? [])
  ]);
  const unknowns = unique([
    ...(evidenceMatrix.length
      ? []
      : [
          "No repository evidence has been selected; intelligence must be refreshed before approval."
        ]),
    ...(context.relatedTests?.length
      ? []
      : ["No existing tests were mapped to the affected code."]),
    ...(context.relevantApis?.length ||
    context.relevantServices?.length ||
    context.relevantSymbols?.length
      ? []
      : ["The primary implementation boundary is not yet proven."]),
    ...(context.functionalRequirements?.length
      ? []
      : ["Functional edge cases and failure behavior require explicit confirmation."])
  ]);
  const implementationTargets = unique([
    ...(context.relevantApis ?? []),
    ...(context.relevantServices ?? []),
    ...(context.relevantSymbols ?? []),
    ...(context.dataEntities ?? [])
  ]);
  const recommendedApproach = unique([
    ...implementationTargets
      .slice(0, 8)
      .map((target) => `Implement and validate the smallest behavior slice around ${target}.`),
    "Preserve discovered contracts and architecture boundaries unless the approved specification explicitly changes them.",
    "Use graph/CPG relationships to inspect callers, data movement, affected tests, security-sensitive paths, and performance-sensitive paths before editing.",
    "Prepare read-only review content; the user creates and manages the branch and remote merge request."
  ]);
  const testingStrategy = unique([
    ...(context.qaChecklist ?? []),
    ...(context.relatedTests ?? []).map((test) => `Run mapped test: ${test}`),
    ...(context.missingTests ?? []).map(
      (test) => `Add or explicitly defer missing coverage: ${test}`
    ),
    "Map every approved acceptance criterion to executed validation evidence or an explicit approved deferral.",
    "Record failed and flaky-test analysis without silently mutating or quarantining tests."
  ]);
  const title = `Intent R&D: ${intent}`;
  const section = (
    name: string,
    items: readonly string[],
    empty = "No evidence was available yet; refresh repository intelligence before approval."
  ): string =>
    `## ${name}\n\n${items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${empty}`}`;
  const matrix = evidenceMatrix.length
    ? evidenceMatrix
        .map(
          (item) =>
            `| ${item.kind} | ${item.label.replaceAll("|", "\\|")} | ${item.summary.replaceAll("|", "\\|")} | ${item.okfId ? `\`${item.okfId}\`` : "—"} |`
        )
        .join("\n")
    : "| — | No evidence | Refresh intelligence | — |";
  const markdown = [
    `# ${title}`,
    "",
    `**Intent ID:** ${intentId}`,
    `**Generated:** ${generatedAt}`,
    "",
    "## Problem Statement",
    "",
    intent,
    "",
    section(
      "Functional Requirements",
      context.functionalRequirements ?? [],
      "Functional requirements must be confirmed during specification review."
    ),
    "",
    section(
      "Non-Functional Requirements",
      context.nonFunctionalRequirements ?? [],
      "No additional non-functional requirement was supplied."
    ),
    "",
    "## Evidence Matrix",
    "",
    "| Kind | Evidence | Meaning | OKF ID |",
    "|---|---|---|---|",
    matrix,
    "",
    section("Repository Evidence", repositoryEvidence),
    "",
    section("Architecture and Boundaries", affectedArchitecture),
    "",
    section("Flows and Symbols", affectedFlows),
    "",
    section("Test Landscape", affectedTests),
    "",
    section(
      "Risks",
      risks,
      "No explicit risk signal was detected; reviewers must still validate the changed paths."
    ),
    "",
    section("Constraints", constraints),
    "",
    section(
      "Unknowns Requiring Approval",
      unknowns,
      "No unresolved research unknown was identified."
    ),
    "",
    section("Recommended Approach", recommendedApproach),
    "",
    section("Testing Strategy", testingStrategy)
  ].join("\n");
  return {
    id: randomUUID(),
    title,
    problemStatement: intent,
    repositoryEvidence,
    evidenceMatrix,
    affectedArchitecture,
    affectedFlows,
    affectedTests,
    risks,
    constraints,
    unknowns,
    recommendedApproach,
    testingStrategy,
    markdown,
    generatedAt
  };
}

function researchEvidencePresentable(item: SDLCResearchEvidence): boolean {
  const value = (item.path ?? item.label).toLowerCase();
  if (/(?:^|\/)(?:node_modules|dist|build|coverage|vendor)(?:\/|$)/.test(value)) return false;
  if (
    item.kind === "file" &&
    /(?:^|\/)(?:\.github|docs?|scripts?)(?:\/|$)|(?:package(?:-lock)?\.json|tsconfig)/.test(value)
  )
    return false;
  return true;
}
function researchEvidenceRank(item: SDLCResearchEvidence): number {
  return (
    (
      {
        test: 0,
        api: 1,
        service: 2,
        flow: 3,
        symbol: 4,
        data: 5,
        risk: 6,
        architecture: 7,
        file: 8
      } as Record<string, number>
    )[item.kind] ?? 20
  );
}

export function restoreSpecificationDocument(
  intentId: string,
  intent: string,
  research: SDLCResearchDocument,
  generatedAt = new Date().toISOString()
): SDLCSpecificationDocument {
  const evidence = research.evidenceMatrix ?? [];
  const context: SDLCPlanningContext = {
    relevantFiles: unique(
      evidence.map((item) => item.path).filter((value): value is string => Boolean(value))
    ),
    relevantSymbols: unique(
      evidence.filter((item) => item.kind === "symbol").map((item) => item.label)
    ),
    relevantApis: unique(evidence.filter((item) => item.kind === "api").map((item) => item.label)),
    relevantServices: unique(
      evidence.filter((item) => item.kind === "service").map((item) => item.label)
    ),
    dataEntities: unique(evidence.filter((item) => item.kind === "data").map((item) => item.label)),
    affectedFlows: research.affectedFlows,
    relatedTests: research.affectedTests.filter((item) => !item.startsWith("Missing coverage: ")),
    missingTests: research.affectedTests
      .filter((item) => item.startsWith("Missing coverage: "))
      .map((item) => item.slice("Missing coverage: ".length)),
    architecture: research.affectedArchitecture.join(" · "),
    constraints: research.constraints,
    evidence
  };
  return buildSpecificationDocument(intentId, intent, context, research, generatedAt);
}

function buildSpecificationDocument(
  intentId: string,
  intent: string,
  context: SDLCPlanningContext,
  research: SDLCResearchDocument,
  generatedAt: string
): SDLCSpecificationDocument {
  // Specification is a user-reviewable contract, not a dump of every symbol or
  // every QA checklist entry discovered during research. Derive a small set of
  // behavior slices from the same intent-focused ranking used by backlog
  // generation; keep the detailed QA/security/performance work in the
  // validation plan and quality stories.
  const behaviorTargets = deriveBehaviorTargets(intent, context);
  const functionalRequirements = unique([
    ...(context.functionalRequirements ?? []),
    ...behaviorTargets.map(
      (target) =>
        `Implement the approved behavior around ${target.label}${target.files.length ? ` in ${target.files.join(", ")}` : ""}.`
    ),
    ...(context.affectedFlows ?? [])
      .slice(0, 4)
      .map((value) => `Preserve the intended behavior across ${value}.`)
  ]).slice(0, 10);
  const nonFunctionalRequirements = unique([
    ...(context.nonFunctionalRequirements ?? []),
    `Security risk: ${context.securityRisk ?? "unknown"}`,
    `Performance risk: ${context.performanceRisk ?? "unknown"}`,
    "Preserve deterministic evidence and repository conventions for every changed boundary."
  ]);
  const architectureDecisions = unique([
    ...(context.relevantServices ?? [])
      .filter((value) => !/(?:test|spec)\b/i.test(value))
      .slice(0, 6)
      .map((value) => `Preserve or explicitly approve changes to service boundary: ${value}.`),
    ...(context.affectedFlows ?? [])
      .slice(0, 6)
      .map((value) => `Maintain evidence-backed behavior across flow: ${value}.`),
    ...(research.affectedArchitecture ?? []).slice(0, 6)
  ]);
  const affectedInterfaces = unique([
    ...(context.relevantApis ?? []),
    ...(context.relevantServices ?? []).filter((value) => !/(?:test|spec)\b/i.test(value))
  ]);
  const dataChanges = unique([
    ...(context.dataEntities ?? [])
      .slice(0, 6)
      .map((value) => `Validate data contract and migration impact for ${value}.`)
  ]);
  const constraints = unique(research.constraints);
  const validationPlan = unique(research.testingStrategy).slice(0, 16);
  const acceptanceCriteria = unique([
    ...functionalRequirements.slice(0, 8),
    "Mapped existing and new tests provide evidence for the approved behavior or an explicit user-approved deferral.",
    "All material QA, security, performance, and review findings are resolved or explicitly accepted with evidence.",
    "Keystone performs no Git write or remote merge-request mutation."
  ]).slice(0, 12);
  const unknowns = unique(research.unknowns);
  const section = (name: string, values: readonly string[], empty: string): string =>
    `## ${name}\n\n${values.length ? values.map((value) => `- ${value}`).join("\n") : `- ${empty}`}`;
  const title = `Implementation Specification: ${intent}`;
  const markdown = [
    `# ${title}`,
    "",
    `**Intent ID:** ${intentId}`,
    `**Generated:** ${generatedAt}`,
    "",
    "## Summary",
    "",
    intent,
    "",
    section(
      "Functional Requirements",
      functionalRequirements,
      "Functional behavior must be confirmed before approval."
    ),
    "",
    section(
      "Non-Functional Requirements",
      nonFunctionalRequirements,
      "No additional non-functional requirement was discovered."
    ),
    "",
    section(
      "Architecture Decisions and Boundaries",
      architectureDecisions,
      "No architecture boundary change is currently proposed."
    ),
    "",
    section("Affected Interfaces", affectedInterfaces, "No external interface was mapped."),
    "",
    section("Data Contract / Migration Impact", dataChanges, "No data contract change was mapped."),
    "",
    section("Constraints", constraints, "No additional constraint was identified."),
    "",
    section(
      "Validation Plan",
      validationPlan,
      "Validation must be determined before implementation completion."
    ),
    "",
    section(
      "Acceptance Criteria",
      acceptanceCriteria,
      "Acceptance criteria must be confirmed before approval."
    ),
    "",
    section("Open Questions", unknowns, "No unresolved question remains from repository research.")
  ].join("\n");
  return {
    id: randomUUID(),
    title,
    summary: intent,
    functionalRequirements,
    nonFunctionalRequirements,
    architectureDecisions,
    affectedInterfaces,
    dataChanges,
    constraints,
    validationPlan,
    acceptanceCriteria,
    unknowns,
    markdown,
    generatedAt
  };
}

function buildBacklogStories(
  intentId: string,
  intent: string,
  context: SDLCPlanningContext
): SDLCBacklogStory[] {
  type Draft = Omit<SDLCBacklogStory, "id" | "status">;
  const drafts: Draft[] = [];
  const allFiles = unique(context.relevantFiles ?? []);
  const allSymbols = unique(context.relevantSymbols ?? []);
  const interfaces = unique([
    ...(context.relevantApis ?? []),
    ...(context.relevantServices ?? []),
    ...(context.dataEntities ?? [])
  ]);
  const baseAcceptance = unique(context.functionalRequirements ?? []);
  const targets = deriveBehaviorTargets(intent, context);
  for (const [index, target] of targets.entries()) {
    const targetFiles = target.files.length ? target.files : allFiles.slice(index, index + 1);
    const targetSymbols = target.symbols.length
      ? target.symbols
      : allSymbols
          .filter(
            (symbol) =>
              target.label.toLowerCase().includes(symbol.toLowerCase()) ||
              symbol.toLowerCase().includes(target.label.toLowerCase())
          )
          .slice(0, 6);
    drafts.push({
      kind: "user-story",
      title: target.title,
      description: target.description,
      acceptanceCriteria: unique([
        ...(index === 0 && baseAcceptance.length ? baseAcceptance : []),
        `The behavior around ${target.label} satisfies the approved specification.`,
        "Changed contracts, files, symbols, and side effects are recorded with evidence.",
        "Relevant validation passes without Keystone performing Git write operations."
      ]),
      linkedSdlcStoryTypes: ["design", "development"],
      evidence: unique(target.evidence),
      dependencies: [],
      scope: { files: targetFiles, symbols: targetSymbols, interfaces: target.interfaces }
    });
  }
  if (targets.length > 1 || interfaces.length > 1) {
    drafts.push({
      kind: "user-story",
      title: "Integrate repository boundaries and preserve contracts",
      description: `Connect the ${targets.length} independently verifiable behavior slices through the discovered interfaces, data paths, and architecture boundaries.`,
      acceptanceCriteria: [
        "Affected API, service, data, configuration, and UI contracts remain compatible or have an approved migration.",
        "Cross-boundary call and data flows are validated with repository evidence.",
        "Failure and rollback behavior is documented."
      ],
      linkedSdlcStoryTypes: ["design", "development", "security-review", "performance-review"],
      evidence: unique([...(context.affectedFlows ?? []), ...interfaces]),
      dependencies: drafts.filter((item) => item.kind === "user-story").map((item) => item.title),
      scope: { files: implementationFiles(allFiles), symbols: allSymbols, interfaces }
    });
  }
  drafts.push({
    kind: "quality-story",
    title: "Prove existing coverage and change impact",
    description:
      "Use dependency, graph, CPG, and test mappings to select the exact regression scope.",
    acceptanceCriteria: [
      "Impacted tests are selected from evidence rather than naming alone.",
      "Existing coverage, unmapped behavior, and regression risk are recorded."
    ],
    linkedSdlcStoryTypes: ["existing-test-analysis", "test-impact-analysis"],
    evidence: unique(context.relatedTests ?? []),
    dependencies: [],
    scope: {
      files: unique([...(context.relatedTests ?? []), ...implementationFiles(allFiles)]),
      symbols: allSymbols,
      interfaces
    }
  });
  if ((context.missingTests?.length ?? 0) > 0 || baseAcceptance.length > 0)
    drafts.push({
      kind: "quality-story",
      title: "Add acceptance-linked regression coverage",
      description:
        "Create or explicitly defer the missing tests required by the approved behavior slices.",
      acceptanceCriteria: [
        "Every relevant acceptance criterion maps to a test or an approved evidence-backed deferral.",
        "New tests follow repository conventions and run in the smallest relevant suite."
      ],
      linkedSdlcStoryTypes: [
        "new-test-creation",
        "failed-test-investigation",
        "flaky-test-analysis"
      ],
      evidence: unique(context.missingTests ?? []),
      dependencies: drafts.filter((item) => item.kind === "user-story").map((item) => item.title),
      scope: {
        files: unique([...(context.relatedTests ?? []), ...implementationFiles(allFiles)]),
        symbols: allSymbols,
        interfaces
      }
    });
  if (riskPresent(context.securityRisk))
    drafts.push({
      kind: "quality-story",
      title: "Validate security-sensitive trust boundaries",
      description:
        "Review input, authorization, secrets, data exposure, and sensitive sinks on the affected paths.",
      acceptanceCriteria: [
        "Security-sensitive paths and trust boundaries are evidence-backed.",
        "Every high or critical finding is resolved, explicitly accepted, or blocks completion."
      ],
      linkedSdlcStoryTypes: ["security-review"],
      evidence: unique([context.securityRisk ?? "", ...(context.affectedFlows ?? [])]),
      dependencies: drafts.filter((item) => item.kind === "user-story").map((item) => item.title),
      scope: { files: implementationFiles(allFiles), symbols: allSymbols, interfaces }
    });
  if (riskPresent(context.performanceRisk))
    drafts.push({
      kind: "quality-story",
      title: "Validate performance-sensitive execution paths",
      description:
        "Review blocking work, repeated I/O, expensive queries, allocation, and hot-path impact.",
      acceptanceCriteria: [
        "Performance-sensitive paths are measured or reasoned from concrete evidence.",
        "Every material regression is resolved, explicitly accepted, or blocks completion."
      ],
      linkedSdlcStoryTypes: ["performance-review"],
      evidence: unique([context.performanceRisk ?? "", ...(context.affectedFlows ?? [])]),
      dependencies: drafts.filter((item) => item.kind === "user-story").map((item) => item.title),
      scope: { files: implementationFiles(allFiles), symbols: allSymbols, interfaces }
    });
  if ((context.modernizationNotes?.length ?? 0) > 0)
    drafts.push({
      kind: "quality-story",
      title: "Assess modernization and compatibility impact",
      description:
        "Separate necessary feature work from optional modernization and preserve behavior.",
      acceptanceCriteria: [
        "Modernization recommendations are scoped and user-approved.",
        "Compatibility and migration consequences are explicit."
      ],
      linkedSdlcStoryTypes: ["modernization-review"],
      evidence: unique(context.modernizationNotes ?? []),
      dependencies: [],
      scope: { files: allFiles, symbols: allSymbols, interfaces }
    });
  drafts.push({
    kind: "quality-story",
    title: "Complete engineering and read-only PR review",
    description:
      "Review specification coverage, architecture, QA, security, performance, documentation, and remaining risk.",
    acceptanceCriteria: [
      "Review evidence covers every approved user and quality story.",
      "Reviewer-ready PR title, description, risks, validation, and unresolved questions are prepared without remote mutation."
    ],
    linkedSdlcStoryTypes: ["code-review", "pr-review", "documentation", "completion"],
    evidence: unique([...(context.evidence ?? []).map((item) => item.okfId ?? item.label)]),
    dependencies: drafts.map((item) => item.title),
    scope: { files: allFiles, symbols: allSymbols, interfaces }
  });
  const ids = new Map<string, string>();
  for (const draft of drafts)
    ids.set(
      draft.title,
      `${draft.kind}-${createHash("sha256").update(`${intentId}\0${draft.title}`).digest("hex").slice(0, 16)}`
    );
  return drafts.map((draft) => ({
    ...draft,
    evidence: draft.evidence.length ? draft.evidence : [`Intent evidence: ${intent}`],
    id: ids.get(draft.title)!,
    dependencies: draft.dependencies.map((value) => ids.get(value) ?? value),
    status: "draft"
  }));
}

interface BehaviorTarget {
  label: string;
  title: string;
  description: string;
  files: string[];
  symbols: string[];
  interfaces: string[];
  evidence: string[];
}
function deriveBehaviorTargets(intent: string, context: SDLCPlanningContext): BehaviorTarget[] {
  const targets: BehaviorTarget[] = [];
  const relevantFiles = implementationFiles(context.relevantFiles ?? []);
  const add = (
    label: string,
    category: string,
    evidence: readonly string[],
    files: readonly string[] = [],
    symbols: readonly string[] = [],
    interfaces: readonly string[] = []
  ): void => {
    const clean = label.trim();
    if (!clean || targets.some((item) => item.label.toLowerCase() === clean.toLowerCase())) return;
    targets.push({
      label: clean,
      title: `${category}: ${clean}`,
      description: `Deliver the smallest independently verifiable behavior slice for ${clean}, using the approved repository R&D and specification.`,
      files: unique(files),
      symbols: unique(symbols),
      interfaces: unique(interfaces),
      evidence: unique(evidence)
    });
  };
  const intentTerms = new Set(
    (intent.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter(
      (term) =>
        term.length > 2 &&
        ![
          "add",
          "make",
          "when",
          "whenever",
          "with",
          "from",
          "into",
          "that",
          "this",
          "change",
          "changes"
        ].includes(term)
    )
  );
  const fileRank = new Map(relevantFiles.map((file, index) => [file, index]));
  const flowText = (context.affectedFlows ?? []).join(" ").toLowerCase();
  const scored = (context.relevantSymbols ?? [])
    .map((value) => {
      const parsed = parseSymbolReference(value);
      if (!parsed || parsed.testLike) return undefined;
      const lower = parsed.name.toLowerCase();
      let score = 0;
      for (const term of intentTerms) {
        if (lower.includes(term) || term.includes(lower)) score += 4;
      }
      if (flowText.includes(lower)) score += 5;
      if (
        /^(?:update|record|save|create|write|publish|emit|handle|process|validate|authorize|calculate|load|fetch)/i.test(
          parsed.name
        )
      )
        score += 2.5;
      if (/^(?:find|get|list|read)/i.test(parsed.name)) score += 0.5;
      if (/^[A-Z]/.test(parsed.name)) score -= 2; // types/interfaces are context, not usually implementation stories
      if (parsed.file) {
        const rank = fileRank.get(parsed.file);
        if (rank !== undefined) score += Math.max(0, 4 - rank * 0.75);
      }
      return { value, parsed, score };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (fileRank.get(a.parsed.file ?? "") ?? 99) - (fileRank.get(b.parsed.file ?? "") ?? 99) ||
        a.parsed.name.localeCompare(b.parsed.name)
    );
  const perFile = new Map<string, number>();
  for (const item of scored) {
    if (targets.length >= 3) break;
    const file = item.parsed.file ?? "";
    const count = perFile.get(file) ?? 0;
    if (file && count >= 2) continue;
    add(item.parsed.name, "Implement behavior", [item.value], file ? [file] : [], [item.value], []);
    if (file) perFile.set(file, count + 1);
  }
  const coveredFiles = new Set(targets.flatMap((target) => target.files));
  // APIs/services/entities add contract-level slices only when they introduce a boundary
  // not already represented by the intent-ranked behavior slices.
  for (const api of context.relevantApis ?? []) {
    if (targets.length >= 4) break;
    add(api, "Implement API behavior", [api], [], [], [api]);
  }
  for (const service of context.relevantServices ?? []) {
    if (targets.length >= 2) break;
    if (/(?:test|spec)\b/i.test(service)) continue;
    const files = serviceFile(service);
    if (files.some((file) => coveredFiles.has(file))) continue;
    add(service, "Implement service behavior", [service], files, [], [service]);
    files.forEach((file) => coveredFiles.add(file));
  }
  for (const entity of context.dataEntities ?? []) {
    if (targets.length >= 2) break;
    add(entity, "Implement data behavior", [entity], [], [], [entity]);
  }
  if (!targets.length) {
    const byArea = new Map<string, string[]>();
    for (const file of relevantFiles) {
      const area = file.split("/").filter(Boolean).slice(0, 2).join("/") || file;
      byArea.set(area, [...(byArea.get(area) ?? []), file]);
    }
    for (const [area, files] of [...byArea].slice(0, 3))
      add(area, "Implement repository slice", files, files, [], []);
  }
  if (!targets.length)
    add(
      "approved intent",
      "Implement behavior",
      ["Intent supplied by user"],
      relevantFiles,
      context.relevantSymbols ?? [],
      []
    );
  return targets.slice(0, 4);
}
function parseSymbolReference(
  value: string
): { name: string; file?: string; testLike: boolean } | undefined {
  const match = value.match(/^(.+?)\s+—\s+(.+?)(?::\d+)?$/);
  const name = (match?.[1] ?? value).trim();
  const file = match?.[2]?.replace(/:\d+$/, "").trim();
  if (!name || name.length > 120) return undefined;
  return {
    name,
    file,
    testLike: Boolean(
      file && /(?:^|\/)(?:tests?|__tests__|spec)(?:\/|$)|\.(?:test|spec)\./i.test(file)
    )
  };
}
function serviceFile(value: string): string[] {
  const match = value.match(/—\s+(.+)$/);
  return match ? [match[1].trim()] : [];
}
function implementationFiles(values: readonly string[]): string[] {
  return unique(
    values.filter(
      (value) =>
        !/(?:^|\/)(?:tests?|__tests__|spec|docs?|scripts?|\.github)(?:\/|$)|\.(?:test|spec)\./i.test(
          value
        ) &&
        !/^(?:package(?:-lock)?\.json|tsconfig|eslint|prettier|vite|webpack|rollup)/i.test(value)
    )
  );
}
function riskPresent(value: string | undefined): boolean {
  return Boolean(value && !/^(?:none|low|unknown)$/i.test(value.trim()));
}
function dedupeEvidence(values: readonly SDLCResearchEvidence[]): SDLCResearchEvidence[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item.okfId ?? `${item.kind}:${item.path ?? ""}:${item.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function stableFragment(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}
function humanize(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
