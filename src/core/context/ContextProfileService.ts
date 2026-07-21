/**
 * ContextProfileService
 *
 * Provides stage-specific context profiles. Each SDLC stage has a built-in
 * default profile defining required/preferred/excluded categories, relationship
 * traversal depth, default token budget, minimum completeness threshold,
 * compression strategies, required safety evidence, and required prior-stage
 * outputs. Profiles are editable through stage overrides.
 */

import {
  StageContextProfileSchema,
  type StageContextProfile,
} from "../../shared/contracts/contextPackage";

const BUILT_IN_PROFILES: StageContextProfile[] = [
  profile("understand", "Repository Understanding", {
    description:
      "Repository architecture, related modules, key symbols, relevant flows, current behaviour, documentation.",
    requiredCategories: ["repository-file", "symbol", "call-flow", "data-flow"],
    preferredCategories: ["specification", "validation-evidence", "dependency"],
    defaultTokenBudget: 8000,
    compressionStrategies: ["structural-summary", "contract-extraction", "flow-compression"],
    minimumCompletenessThreshold: 0.8,
  }),
  profile("plan", "Planning", {
    description:
      "Intent, specification, acceptance criteria, architecture constraints, dependencies, affected areas, risks, test landscape.",
    requiredCategories: ["workflow-intent", "specification", "acceptance-criterion"],
    preferredCategories: ["dependency", "call-flow", "data-flow", "test", "validation-evidence"],
    defaultTokenBudget: 10000,
    compressionStrategies: ["structural-summary", "contract-extraction"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("development", "Development", {
    description:
      "Exact target symbols, surrounding implementation, relevant interfaces, contracts, direct callers/callees, coding instructions, impacted tests, bounded examples.",
    requiredCategories: ["symbol", "specification", "acceptance-criterion", "instruction"],
    preferredCategories: ["repository-file", "call-flow", "data-flow", "test", "dependency"],
    defaultTokenBudget: 12000,
    compressionStrategies: [
      "full",
      "excerpt",
      "signature",
      "contract",
      "contract-extraction",
      "repetition-removal",
    ],
    minimumCompletenessThreshold: 0.9,
  }),
  profile("impact", "Impact Analysis", {
    description:
      "Changed symbols, dependencies, dependents, call/data flows, tests, configuration and contracts.",
    requiredCategories: ["symbol", "dependency", "call-flow", "data-flow"],
    preferredCategories: ["test", "repository-file", "validation-evidence"],
    defaultTokenBudget: 10000,
    compressionStrategies: ["flow-compression", "contract-extraction", "structural-summary"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("test-generation", "Test Generation", {
    description:
      "Acceptance criteria, impacted code paths, existing test patterns, fixtures, framework setup, coverage gaps, expected outputs.",
    requiredCategories: ["acceptance-criterion", "symbol", "test"],
    preferredCategories: ["repository-file", "call-flow", "validation-evidence", "dependency"],
    defaultTokenBudget: 10000,
    compressionStrategies: ["excerpt", "contract-extraction", "repetition-removal"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("failure-analysis", "Test Failure Analysis", {
    description:
      "Failing test, stack trace, changed code, previous successful behaviour, relevant fixtures, execution evidence, related tests.",
    requiredCategories: ["test", "symbol", "validation-evidence"],
    preferredCategories: ["repository-file", "call-flow", "data-flow"],
    defaultTokenBudget: 8000,
    compressionStrategies: ["excerpt", "contract-extraction", "historical-compression"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("test-healing", "Test Healing", {
    description:
      "Failure classification, failing test code, affected production code, test intent, expected behaviour, safe modification constraints.",
    requiredCategories: ["test", "symbol", "acceptance-criterion", "instruction"],
    preferredCategories: ["repository-file", "validation-evidence"],
    defaultTokenBudget: 8000,
    compressionStrategies: ["excerpt", "contract-extraction", "historical-compression"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("security-analysis", "Security Analysis", {
    description:
      "Entry points, auth boundaries, sensitive data, source-to-sink flows, changed code, validation and sanitization, security instructions.",
    requiredCategories: ["symbol", "security-finding", "call-flow", "data-flow", "instruction"],
    preferredCategories: ["repository-file", "dependency"],
    defaultTokenBudget: 10000,
    compressionStrategies: ["contract-extraction", "flow-compression", "signature"],
    minimumCompletenessThreshold: 0.9,
    requiredSafetyEvidence: ["security-finding"],
  }),
  profile("performance-analysis", "Performance Analysis", {
    description:
      "Hot paths, database and external calls, loops, fan-out, changed code, benchmark evidence, performance constraints.",
    requiredCategories: ["symbol", "performance-finding", "call-flow", "data-flow"],
    preferredCategories: ["repository-file", "dependency", "validation-evidence"],
    defaultTokenBudget: 10000,
    compressionStrategies: ["flow-compression", "contract-extraction", "signature"],
    minimumCompletenessThreshold: 0.85,
    requiredSafetyEvidence: ["performance-finding"],
  }),
  profile("pr-review", "PR Review", {
    description:
      "Approved specification, diff summary, changed symbols, affected flows, test evidence, security findings, performance findings, documentation impact.",
    requiredCategories: ["specification", "symbol", "acceptance-criterion", "validation-evidence"],
    preferredCategories: [
      "call-flow",
      "data-flow",
      "security-finding",
      "performance-finding",
      "test",
    ],
    defaultTokenBudget: 12000,
    compressionStrategies: ["structural-summary", "contract-extraction", "flow-compression"],
    minimumCompletenessThreshold: 0.85,
  }),
  profile("review", "General Review", {
    description:
      "Approved specification, changed symbols, affected flows, test evidence, findings, documentation impact.",
    requiredCategories: ["specification", "symbol", "validation-evidence"],
    preferredCategories: [
      "call-flow",
      "data-flow",
      "security-finding",
      "performance-finding",
      "test",
    ],
    defaultTokenBudget: 10000,
    compressionStrategies: ["structural-summary", "contract-extraction", "flow-compression"],
    minimumCompletenessThreshold: 0.85,
  }),
];

function profile(
  stageType: string,
  name: string,
  partial: Partial<StageContextProfile> & { description: string },
): StageContextProfile {
  return StageContextProfileSchema.parse({
    id: `builtin:${stageType}`,
    stageType,
    name,
    description: partial.description,
    requiredCategories: partial.requiredCategories ?? [],
    preferredCategories: partial.preferredCategories ?? [],
    excludedCategories: partial.excludedCategories ?? [],
    relationshipTraversalDepth: partial.relationshipTraversalDepth ?? 2,
    defaultTokenBudget: partial.defaultTokenBudget ?? 12000,
    minimumCompletenessThreshold: partial.minimumCompletenessThreshold ?? 0.8,
    compressionStrategies: partial.compressionStrategies ?? [
      "structural-summary",
      "contract-extraction",
    ],
    requiredSafetyEvidence: partial.requiredSafetyEvidence ?? [],
    requiredPriorStageOutputs: partial.requiredPriorStageOutputs ?? [],
    source: "built-in",
    version: 1,
  });
}

/** Keywords per stage used by the relevance scorer. */
export const STAGE_KEYWORDS: Record<string, string[]> = {
  development: ["implement", "function", "class", "interface", "refactor", "bug"],
  impact: ["depend", "affect", "caller", "callee", "side-effect"],
  "test-generation": ["test", "coverage", "fixture", "assert", "mock"],
  "failure-analysis": ["fail", "stack", "error", "exception", "timeout"],
  "test-healing": ["flaky", "heal", "stabilize", "retry"],
  "security-analysis": ["auth", "token", "secret", "sanitize", "injection", "permission"],
  "performance-analysis": ["latency", "throughput", "bottleneck", "cache", "query", "loop"],
  "pr-review": ["diff", "review", "regression", "change"],
  understand: ["architecture", "module", "boundary", "responsibility"],
  plan: ["requirement", "constraint", "risk", "design"],
  review: ["review", "regression", "change", "finding"],
};

export class ContextProfileService {
  private readonly overrides = new Map<string, Partial<StageContextProfile>>();

  listBuiltIn(): StageContextProfile[] {
    return BUILT_IN_PROFILES.map((p) => this.applyOverride(p));
  }

  getForStage(stageType: string): StageContextProfile {
    const base =
      BUILT_IN_PROFILES.find((p) => p.stageType === stageType) ??
      BUILT_IN_PROFILES.find((p) => p.stageType === "review")!;
    return this.applyOverride(base);
  }

  getById(id: string): StageContextProfile | undefined {
    const base = BUILT_IN_PROFILES.find((p) => p.id === id);
    return base ? this.applyOverride(base) : undefined;
  }

  /** Apply a stage override (editable profiles). */
  setOverride(stageType: string, override: Partial<StageContextProfile>): void {
    this.overrides.set(stageType, override);
  }

  clearOverride(stageType: string): void {
    this.overrides.delete(stageType);
  }

  private applyOverride(base: StageContextProfile): StageContextProfile {
    const override = this.overrides.get(base.stageType);
    if (!override) return base;
    return StageContextProfileSchema.parse({
      ...base,
      ...override,
      id: base.id,
      stageType: base.stageType,
      source: "user",
      version: base.version + 1,
    });
  }

  keywordsForStage(stageType: string): string[] {
    const fallback: string[] = STAGE_KEYWORDS.review ?? [];
    return STAGE_KEYWORDS[stageType] ?? fallback;
  }
}
