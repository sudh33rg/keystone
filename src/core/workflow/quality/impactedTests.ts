import path from "node:path";

import { findFileEvidence } from "../../intelligence/graph/graphQuery";
import type { GraphNode } from "../../intelligence/graph/types";
import type { RepoIndex } from "../../platform/storage/types";

export type ImpactedTestSuggestion = {
  testPath: string;
  reason: string;
  confidence: "high" | "medium" | "low";
};

export function suggestImpactedTests(
  index: RepoIndex,
  changedPaths: string[]
): ImpactedTestSuggestion[] {
  const suggestions = new Map<string, ImpactedTestSuggestion>();
  const testFiles = summaryFiles(index).filter((file) => file.role === "test");

  for (const changedPath of changedPaths) {
    for (const coverageMapping of summaryCoverageMappings(index)) {
      if (coverageMapping.coveredPath === changedPath) {
        suggestions.set(coverageMapping.testPath, {
          testPath: coverageMapping.testPath,
          reason: `Coverage map says ${coverageMapping.testPath} covers ${changedPath}.`,
          confidence: "high"
        });
      }
    }

    for (const testFile of testFiles) {
      if (suggestions.has(testFile.path)) {
        continue;
      }

      if (isDirectImportRelated(index, changedPath, testFile.path)) {
        suggestions.set(testFile.path, {
          testPath: testFile.path,
          reason: `Test imports or is imported by ${changedPath}.`,
          confidence: "high"
        });
        continue;
      }

      if (hasPathAffinity(changedPath, testFile.path)) {
        suggestions.set(testFile.path, {
          testPath: testFile.path,
          reason: `Test path is near ${changedPath}.`,
          confidence: "medium"
        });
      }
    }

    for (const suggestion of suggestRuntimeSignalBackedTests(index, changedPath)) {
      setSuggestion(suggestions, suggestion);
    }
  }

  return [...suggestions.values()].sort((left, right) => {
    const confidenceOrder = confidenceRank(right.confidence) - confidenceRank(left.confidence);
    return confidenceOrder || left.testPath.localeCompare(right.testPath);
  });
}

function suggestRuntimeSignalBackedTests(
  index: RepoIndex,
  changedPath: string
): ImpactedTestSuggestion[] {
  const runtimeBehaviors = findRuntimeBehaviorsConnectedToPath(index, changedPath);
  if (runtimeBehaviors.length === 0) {
    return [];
  }

  const suggestions: ImpactedTestSuggestion[] = [];

  for (const runtimeBehavior of runtimeBehaviors) {
    for (const relatedPath of findPathsConnectedToRuntimeBehavior(index, runtimeBehavior)) {
      const relatedTests = findTestsForRelatedRuntimePath(index, relatedPath);

      for (const testPath of relatedTests) {
        suggestions.push({
          testPath,
          reason: `Runtime telemetry ${runtimeBehavior.name} connects ${changedPath} to ${relatedPath}.`,
          confidence: relatedPath === changedPath ? "medium" : "low"
        });
      }
    }
  }

  return suggestions;
}

function findRuntimeBehaviorsConnectedToPath(index: RepoIndex, filePath: string): GraphNode[] {
  const evidence = findFileEvidence(index.graph, filePath);
  const declaredNodeIds = [
    ...(evidence.file ? [evidence.file.id] : []),
    ...evidence.declaredRoutes.map((node) => node.id),
    ...evidence.configUsages.map((node) => node.id)
  ];
  const behaviorIds = index.graph.edges
    .filter(
      (edge) =>
        edge.kind === "observes" &&
        typeof edge.fromNodeId === "string" &&
        declaredNodeIds.includes(edge.fromNodeId)
    )
    .map((edge) => edge.toNodeId)
    .filter((nodeId): nodeId is string => typeof nodeId === "string");

  return index.graph.nodes
    .filter((node) => node.kind === "runtime_behavior" && behaviorIds.includes(node.id))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function findPathsConnectedToRuntimeBehavior(
  index: RepoIndex,
  runtimeBehavior: GraphNode
): string[] {
  const relatedBehaviorIds = index.graph.nodes
    .filter(
      (node) =>
        node.kind === "runtime_behavior" &&
        runtimeBehaviorKey(node) === runtimeBehaviorKey(runtimeBehavior)
    )
    .map((node) => node.id);
  const sourceNodeIds = index.graph.edges
    .filter(
      (edge) =>
        edge.kind === "observes" &&
        typeof edge.toNodeId === "string" &&
        relatedBehaviorIds.includes(edge.toNodeId)
    )
    .map((edge) => edge.fromNodeId)
    .filter((nodeId): nodeId is string => typeof nodeId === "string");

  return [
    ...new Set(
      index.graph.nodes
        .filter((node) => sourceNodeIds.includes(node.id) && typeof node.metadata.path === "string")
        .map((node) => node.metadata.path as string)
    )
  ].sort();
}

function runtimeBehaviorKey(runtimeBehavior: GraphNode): string {
  return [
    runtimeBehavior.metadata.behaviorType ?? "unknown",
    runtimeBehavior.metadata.signal ?? runtimeBehavior.name
  ]
    .join(":")
    .toLowerCase();
}

function findTestsForRelatedRuntimePath(index: RepoIndex, relatedPath: string): string[] {
  const testPaths = new Set<string>();

  for (const coverageMapping of summaryCoverageMappings(index)) {
    if (coverageMapping.coveredPath === relatedPath) {
      testPaths.add(coverageMapping.testPath);
    }
  }

  for (const file of summaryFiles(index)) {
    if (file.role === "test" && isDirectImportRelated(index, relatedPath, file.path)) {
      testPaths.add(file.path);
    }
  }

  return [...testPaths].sort();
}

function setSuggestion(
  suggestions: Map<string, ImpactedTestSuggestion>,
  suggestion: ImpactedTestSuggestion
): void {
  const existing = suggestions.get(suggestion.testPath);
  if (!existing || confidenceRank(suggestion.confidence) > confidenceRank(existing.confidence)) {
    suggestions.set(suggestion.testPath, suggestion);
  }
}

function isDirectImportRelated(index: RepoIndex, changedPath: string, testPath: string): boolean {
  return summaryImports(index).some(
    (importReference) =>
      (importReference.sourcePath === testPath && importReference.resolvedPath === changedPath) ||
      (importReference.sourcePath === changedPath && importReference.resolvedPath === testPath)
  );
}

type SummaryFile = { path: string; role: string };
type CoverageMapping = { testPath: string; coveredPath: string };
type ImportReference = { sourcePath: string; resolvedPath?: string };

function summaryFiles(index: RepoIndex): SummaryFile[] {
  const summary = index.summary as unknown as { files?: SummaryFile[] };
  return summary.files ?? [];
}

function summaryCoverageMappings(index: RepoIndex): CoverageMapping[] {
  const summary = index.summary as unknown as { coverageMappings?: CoverageMapping[] };
  return summary.coverageMappings ?? [];
}

function summaryImports(index: RepoIndex): ImportReference[] {
  const summary = index.summary as unknown as { imports?: ImportReference[] };
  return Array.isArray(summary.imports) ? summary.imports : [];
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
