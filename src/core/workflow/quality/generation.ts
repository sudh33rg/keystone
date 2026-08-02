/**
 * Deterministic QA planning and failure classification.
 *
 * Keystone never edits tests autonomously. It derives complete proposal sets
 * from repository evidence and delegates approved implementation work to the
 * user-selected Copilot agent.
 */
export type TestLayer = "unit" | "api" | "component" | "e2e";
export interface TestScenario {
  id: string;
  name: string;
  description: string;
  category: string;
  priority: "high" | "medium" | "low";
  businessRules: string[];
  sources: Array<{
    type: "source-code" | "ui-selector" | "api-contract" | "business-rule";
    ref: string;
  }>;
}
export interface TestStrategy {
  layer: TestLayer;
  rationale: string;
  antiPatterns: string[];
  scenarios: string[];
}
export interface GeneratedTest {
  id: string;
  name: string;
  code: string;
  language: string;
  framework: string;
  layer: TestLayer;
  scenarioId: string;
  status: "draft" | "reviewed" | "approved" | "failed";
  dependencies: string[];
}
export interface TestGenerationResult {
  scenarios: TestScenario[];
  strategies: TestStrategy[];
  tests: GeneratedTest[];
  summary: {
    totalScenarios: number;
    totalTests: number;
    byLayer: Record<TestLayer, number>;
    byStatus: Record<string, number>;
  };
}

/**
 * Produce one test scenario for every distinct evidence item plus the four
 * mandatory behavior classes. There is no arbitrary scenario/test ceiling.
 */
export async function generateTests(options: {
  feature: string;
  sourceCode: string;
  uiSelectors?: string[];
  apiContracts?: string[];
  businessRules?: string[];
}): Promise<TestGenerationResult> {
  const { feature, sourceCode, uiSelectors = [], apiContracts = [], businessRules = [] } = options;
  if (!sourceCode.trim()) return emptyGeneration();
  const sources: TestScenario["sources"] = dedupeSources([
    ...businessRules.map((ref) => ({ type: "business-rule" as const, ref })),
    ...apiContracts.map((ref) => ({ type: "api-contract" as const, ref })),
    ...uiSelectors.map((ref) => ({ type: "ui-selector" as const, ref })),
    { type: "source-code" as const, ref: sourceCode }
  ]);
  const mandatory = [
    { category: "happy-path", label: "primary flow", priority: "high" as const },
    { category: "validation", label: "validation", priority: "high" as const },
    { category: "error-handling", label: "failure handling", priority: "medium" as const },
    { category: "boundary", label: "boundary case", priority: "medium" as const }
  ];
  const scenarioSeeds = [
    ...mandatory.map((item, index) => ({ ...item, source: sources[index % sources.length] })),
    ...sources.map((source, index) => ({
      category: `evidence-${source.type}`,
      label: `evidence ${index + 1}`,
      priority: "medium" as const,
      source
    }))
  ];
  const seen = new Set<string>();
  const scenarios = scenarioSeeds
    .filter((seed) => {
      const key = `${seed.category}|${seed.source.type}|${seed.source.ref}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((seed, index): TestScenario => ({
      id: `scenario-${index + 1}`,
      name: `${feature}: ${seed.label}`,
      description: `Deterministic test scenario derived from ${seed.source.type} evidence for ${feature}.`,
      category: seed.category,
      priority: seed.priority,
      businessRules,
      sources: [seed.source]
    }));
  const layers: TestLayer[] = ["unit", "api", "component", "e2e"];
  const strategies = layers
    .map((layer) => ({
      layer,
      rationale: `Cover ${feature} at the ${layer} layer with repository-grounded evidence.`,
      antiPatterns: ["duplicated setup", "unrelated assertions", "silent behavior changes"],
      scenarios: scenarios
        .filter((_, index) => index % layers.length === layers.indexOf(layer))
        .map((item) => item.id)
    }))
    .filter((item) => item.scenarios.length > 0);
  const tests = scenarios.map((scenario, index): GeneratedTest => ({
    id: `test-plan-${index + 1}`,
    name: scenario.name,
    code: `// Copilot delegation proposal: implement ${layers[index % layers.length]} coverage for ${scenario.id}`,
    language: "project-detected",
    framework: "project-detected",
    layer: layers[index % layers.length],
    scenarioId: scenario.id,
    status: "draft",
    dependencies: []
  }));
  const byLayer: Record<TestLayer, number> = { unit: 0, api: 0, component: 0, e2e: 0 };
  const byStatus: Record<string, number> = {};
  for (const test of tests) {
    byLayer[test.layer] += 1;
    byStatus[test.status] = (byStatus[test.status] ?? 0) + 1;
  }
  return {
    scenarios,
    strategies,
    tests,
    summary: { totalScenarios: scenarios.length, totalTests: tests.length, byLayer, byStatus }
  };
}

export type FailureType = "BROKEN_LOCATOR" | "REAL_BUG" | "FLAKY" | "ENV_ISSUE";
export interface FailureClassification {
  type: FailureType;
  confidence: number;
  description: string;
  suggestedAction: string;
  evidence: string[];
}
export function classifyFailure(options: {
  failureMessage: string;
  failureStackTrace?: string;
  testFile?: string;
  testCode?: string;
}): FailureClassification {
  const text = `${options.failureMessage}\n${options.failureStackTrace ?? ""}\n${options.testCode ?? ""}`;
  if (/locator.*not found|element.*not found|unable to find|timeout.*locator/i.test(text))
    return result(
      "BROKEN_LOCATOR",
      0.9,
      "The test locator no longer resolves.",
      "Review the approved UI contract and prepare a user-approved selector update.",
      ["locator resolution evidence"]
    );
  if (/flaky|intermittent|race condition|timing|sometimes passes|retry/i.test(text))
    return result(
      "FLAKY",
      0.82,
      "The failure has nondeterministic timing or retry evidence.",
      "Reproduce repeatedly, isolate the race, and prepare a deterministic remediation proposal.",
      ["nondeterminism evidence"]
    );
  if (
    /ECONNREFUSED|ENOTFOUND|network|service unavailable|browser.*closed|out of memory|disk full/i.test(
      text
    )
  )
    return result(
      "ENV_ISSUE",
      0.86,
      "The failure points to environment or dependency availability.",
      "Restore the environment and rerun before changing product or test code.",
      ["environment evidence"]
    );
  return result(
    "REAL_BUG",
    0.68,
    "The assertion or runtime behavior indicates a probable product defect.",
    "Trace the implementation and impacted tests, then prepare the smallest behavior-preserving fix.",
    ["assertion/runtime evidence"]
  );
}

function result(
  type: FailureType,
  confidence: number,
  description: string,
  suggestedAction: string,
  evidence: string[]
): FailureClassification {
  return { type, confidence, description, suggestedAction, evidence };
}
function dedupeSources(values: TestScenario["sources"]): TestScenario["sources"] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = `${item.type}|${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function emptyGeneration(): TestGenerationResult {
  return {
    scenarios: [],
    strategies: [],
    tests: [],
    summary: {
      totalScenarios: 0,
      totalTests: 0,
      byLayer: { unit: 0, api: 0, component: 0, e2e: 0 },
      byStatus: {}
    }
  };
}
