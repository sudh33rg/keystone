import type { RepoIntelligence } from "../../domain/types";
import type { TypeScriptSemanticResult } from "../cpg";
import type { RepositoryGraphAnalysis } from "./derivedGraph";

export interface DeadCodeCandidate {
  readonly filePath: string;
  readonly line: number;
  readonly name: string;
  readonly kind: string;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

/** Conservative dead-code candidates; absence of evidence is never presented as certainty. */
export function analyzeDeadCode(
  intelligence: RepoIntelligence,
  graph: RepositoryGraphAnalysis,
  semantic: TypeScriptSemanticResult
): DeadCodeCandidate[] {
  const referenced = new Set([
    ...semantic.calls.map((call) => `${call.targetPath}:${call.targetLine}`),
    ...semantic.callbacks.map((callback) => `${callback.targetPath}:${callback.targetLine}`),
    ...semantic.relationships.map((item) => `${item.targetPath}:${item.targetLine}`)
  ]);
  const apiFiles = new Set(intelligence.apis.map((api) => api.filePath));
  return intelligence.symbols
    .filter(
      (symbol) =>
        ["function", "class"].includes(symbol.kind) &&
        /^(?:typescript|typescriptreact|javascript|javascriptreact)$/.test(
          intelligence.files.find((file) => file.path === symbol.filePath)?.language ?? ""
        ) &&
        symbol.exportStatus !== "exported" &&
        !intelligence.files.find((file) => file.path === symbol.filePath)?.isTest &&
        !graph.entryPoints.includes(symbol.filePath) &&
        !apiFiles.has(symbol.filePath) &&
        graph.orphanSourceFiles.includes(symbol.filePath) &&
        !referenced.has(`${symbol.filePath}:${symbol.line}`) &&
        !/^(main|constructor|render|setup|teardown|beforeEach|afterEach|if|for|while|switch|catch|return|throw|new)$/i.test(
          symbol.name
        )
    )
    .map((symbol) => ({
      filePath: symbol.filePath,
      line: symbol.line,
      name: symbol.name,
      kind: symbol.kind,
      confidence: 0.8,
      reasons: [
        "not exported",
        "no bound incoming call, callback, inheritance, API, test, or entry-point evidence"
      ]
    }))
    .sort(
      (a, b) =>
        b.confidence - a.confidence || a.filePath.localeCompare(b.filePath) || a.line - b.line
    );
}
