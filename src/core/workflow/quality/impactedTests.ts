import path from "node:path";

import type { OkfGraphProjection } from "../../intelligence/okf/projections";

export type ImpactedTestSuggestion = {
  testPath: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

/**
 * Test-impact suggestions derived from the promoted OKF graph projection.
 *
 * This consumes the projection read-only through its published shape; it does
 * not build, mutate, or re-derive OKF or CPG state. When no projection is
 * available the result is an empty list -- absence of evidence is never
 * reported as an impacted test.
 */
export function suggestImpactedTests(
  graph: OkfGraphProjection | undefined,
  changedPaths: readonly string[]
): ImpactedTestSuggestion[] {
  if (!graph || changedPaths.length === 0) return [];

  const suggestions = new Map<string, ImpactedTestSuggestion>();
  const pathById = new Map<string, string>();
  const testPathById = new Map<string, string>();

  for (const node of graph.nodes) {
    if (node.lifecycle !== "active") continue;
    const nodePath = unitPath(node.properties);
    if (!nodePath) continue;
    pathById.set(node.id, nodePath);
    if (node.kind === "test") testPathById.set(node.id, nodePath);
  }

  const changed = new Set(changedPaths);
  const changedIds = new Set(
    [...pathById.entries()].filter(([, value]) => changed.has(value)).map(([key]) => key)
  );

  for (const edge of graph.edges) {
    if (edge.lifecycle !== "active") continue;

    // A test that directly covers or targets a changed file.
    if (edge.kind === "tests" || edge.kind === "covers") {
      const testPath = testPathById.get(edge.sourceId);
      const targetPath = pathById.get(edge.targetId);
      if (testPath && targetPath && changed.has(targetPath)) {
        setSuggestion(suggestions, {
          testPath,
          reason: `OKF ${edge.kind} evidence links ${testPath} to ${targetPath}.`,
          confidence: "high"
        });
      }
      continue;
    }

    // A test that imports a changed file, or is imported by one.
    if (edge.kind === "imports" || edge.kind === "depends-on") {
      const sourceIsTest = testPathById.get(edge.sourceId);
      const targetIsTest = testPathById.get(edge.targetId);
      if (sourceIsTest && changedIds.has(edge.targetId)) {
        setSuggestion(suggestions, {
          testPath: sourceIsTest,
          reason: `Test imports ${pathById.get(edge.targetId) ?? "a changed file"}.`,
          confidence: "high"
        });
      } else if (targetIsTest && changedIds.has(edge.sourceId)) {
        setSuggestion(suggestions, {
          testPath: targetIsTest,
          reason: `Test is imported by ${pathById.get(edge.sourceId) ?? "a changed file"}.`,
          confidence: "high"
        });
      }
    }
  }

  // Path affinity is a weaker, structural signal used only where the graph
  // carries no recorded relationship for the changed file.
  for (const changedPath of changedPaths) {
    for (const testPath of testPathById.values()) {
      if (suggestions.has(testPath)) continue;
      if (hasPathAffinity(changedPath, testPath))
        setSuggestion(suggestions, {
          testPath,
          reason: `Test path is near ${changedPath}.`,
          confidence: "medium"
        });
    }
  }

  return [...suggestions.values()].sort((left, right) => {
    const confidenceOrder = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    return confidenceOrder || left.testPath.localeCompare(right.testPath);
  });
}

function unitPath(properties: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof properties.path === "string") return properties.path;
  if (typeof properties.filePath === "string") return properties.filePath;
  return undefined;
}

function setSuggestion(
  suggestions: Map<string, ImpactedTestSuggestion>,
  suggestion: ImpactedTestSuggestion
): void {
  const existing = suggestions.get(suggestion.testPath);
  if (!existing || confidenceRank(suggestion.confidence) > confidenceRank(existing.confidence))
    suggestions.set(suggestion.testPath, suggestion);
}

function hasPathAffinity(changedPath: string, testPath: string): boolean {
  const changedDirectory = path.posix.dirname(changedPath);
  const testDirectory = path.posix.dirname(testPath);
  const changedStem = stripTestSuffix(
    path.posix.basename(changedPath, path.posix.extname(changedPath))
  );
  const testStem = stripTestSuffix(path.posix.basename(testPath, path.posix.extname(testPath)));

  return (
    changedDirectory === testDirectory ||
    changedStem === testStem ||
    testDirectory.startsWith(changedDirectory)
  );
}

function stripTestSuffix(value: string): string {
  return value.replace(/\.(test|spec)$/i, "");
}

function confidenceRank(confidence: ImpactedTestSuggestion["confidence"]): number {
  if (confidence === "high") {
    return 3;
  }

  if (confidence === "medium") {
    return 2;
  }

  return 1;
}
