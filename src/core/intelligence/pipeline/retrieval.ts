import type { EvidenceMetadata, RepoIntelligence } from "../../domain/types";
import type { RepositoryGraphAnalysis } from "./derivedGraph";
import type { IntelligenceFinding } from "./findings";

export interface IntelligenceRetrievalQuery {
  readonly text: string;
  readonly limit?: number;
  readonly graphDepth?: number;
  readonly semanticScores?: (
    query: string,
    paths: readonly string[]
  ) => Promise<Readonly<Record<string, number>>>;
}

export interface IntelligenceRetrievalResult {
  readonly mode: "lexical-graph" | "hybrid" | "canonical-okf";
  readonly results: ReadonlyArray<{
    path: string;
    score: number;
    reasons: readonly string[];
    evidenceMetadata: readonly EvidenceMetadata[];
  }>;
  readonly warnings: readonly string[];
}

/** Canonical bounded retrieval over repository text signals and graph structure. */
export async function retrieveRepositoryIntelligence(
  intelligence: RepoIntelligence,
  graph: RepositoryGraphAnalysis,
  findings: readonly IntelligenceFinding[],
  query: IntelligenceRetrievalQuery
): Promise<IntelligenceRetrievalResult> {
  const limit = Math.max(1, Math.min(query.limit ?? 20, 100));
  const terms = tokenize(query.text);
  const documents = intelligence.files.map((file) => {
    const symbols = intelligence.symbols
      .filter((symbol) => symbol.filePath === file.path)
      .map((symbol) => symbol.name);
    const endpoints = intelligence.apis
      .filter((api) => api.filePath === file.path)
      .map((api) => `${api.method} ${api.path}`);
    const evidence = findings
      .filter((finding) => finding.filePath === file.path)
      .flatMap((finding) => [finding.title, finding.description, ...finding.evidence]);
    return {
      path: file.path,
      text: [file.path, file.summary, ...symbols, ...endpoints, ...evidence].join(" ")
    };
  });
  const lexical = documents
    .map((document) => ({ path: document.path, score: lexicalScore(terms, document.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const reasons = new Map<string, Set<string>>();
  lexical.forEach((item) => addReason(reasons, item.path, "lexical match"));
  const graphScores = expandGraph(
    lexical.slice(0, Math.max(limit, 5)).map((item) => item.path),
    graph.localEdges,
    query.graphDepth ?? 2
  );
  graphScores.forEach((_score, path) => addReason(reasons, path, "graph neighbor"));
  const rankings: string[][] = [
    lexical.map((item) => item.path),
    [...graphScores.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path)
  ];
  const warnings: string[] = [];
  let mode: IntelligenceRetrievalResult["mode"] = "lexical-graph";
  if (query.semanticScores) {
    try {
      const semantic = await query.semanticScores(
        query.text,
        documents.map((document) => document.path)
      );
      rankings.push(
        Object.entries(semantic)
          .filter(([, score]) => Number.isFinite(score) && score > 0)
          .sort((a, b) => b[1] - a[1])
          .map(([path]) => path)
      );
      Object.keys(semantic).forEach((path) => addReason(reasons, path, "semantic match"));
      mode = "hybrid";
    } catch (error) {
      warnings.push(
        `Semantic retrieval unavailable: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const scores = reciprocalRankFusion(rankings);
  return {
    mode,
    results: [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([path, score]) => ({
        path,
        score,
        reasons: [...(reasons.get(path) ?? [])],
        evidenceMetadata: retrievalEvidence(intelligence, findings, path)
      })),
    warnings
  };
}

function retrievalEvidence(
  intelligence: RepoIntelligence,
  findings: readonly IntelligenceFinding[],
  path: string
): EvidenceMetadata[] {
  const evidence = [
    ...intelligence.files
      .filter((file) => file.path === path)
      .flatMap((file) => (file.evidence ? [file.evidence] : [])),
    ...intelligence.symbols
      .filter((symbol) => symbol.filePath === path)
      .flatMap((symbol) => (symbol.evidence ? [symbol.evidence] : [])),
    ...intelligence.apis
      .filter((api) => api.filePath === path)
      .flatMap((api) => (api.evidence ? [api.evidence] : [])),
    ...intelligence.dependencies
      .filter((edge) => edge.from === path || edge.to === path)
      .flatMap((edge) => (edge.evidence ? [edge.evidence] : [])),
    ...findings
      .filter((finding) => finding.filePath === path)
      .flatMap((finding) => finding.evidenceMetadata)
  ];
  const deduped = new Map<string, EvidenceMetadata>();
  for (const item of evidence) {
    const key = [
      item.source,
      item.evidencePath ?? "",
      item.evidenceLine ?? "",
      item.extractorVersion
    ].join("|");
    deduped.set(key, item);
  }
  return [...deduped.values()].sort(
    (a, b) =>
      (a.evidencePath ?? "").localeCompare(b.evidencePath ?? "") ||
      (a.evidenceLine ?? 0) - (b.evidenceLine ?? 0) ||
      a.source.localeCompare(b.source)
  );
}

function lexicalScore(terms: readonly string[], text: string): number {
  const tokens = tokenize(text);
  if (!terms.length || !tokens.length) return 0;
  const counts = new Map<string, number>();
  tokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  return (
    terms.reduce((score, term) => score + Math.log1p(counts.get(term) ?? 0), 0) /
    Math.sqrt(tokens.length)
  );
}

function expandGraph(
  seeds: readonly string[],
  edges: ReadonlyArray<{ from: string; to: string }>,
  maxDepth: number
): Map<string, number> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    const out = adjacency.get(edge.from) ?? new Set<string>();
    out.add(edge.to);
    adjacency.set(edge.from, out);
    const incoming = adjacency.get(edge.to) ?? new Set<string>();
    incoming.add(edge.from);
    adjacency.set(edge.to, incoming);
  }
  const scores = new Map<string, number>();
  const queue = seeds.map((path) => ({ path, depth: 0 }));
  const seen = new Set<string>();
  while (queue.length) {
    const current = queue.shift()!;
    if (seen.has(current.path) || current.depth > maxDepth) continue;
    seen.add(current.path);
    scores.set(current.path, 1 / (current.depth + 1));
    for (const neighbor of adjacency.get(current.path) ?? [])
      queue.push({ path: neighbor, depth: current.depth + 1 });
  }
  return scores;
}

function reciprocalRankFusion(rankings: readonly string[][], k = 60): Map<string, number> {
  const result = new Map<string, number>();
  for (const ranking of rankings)
    ranking.forEach((path, index) =>
      result.set(path, (result.get(path) ?? 0) + 1 / (k + index + 1))
    );
  return result;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}
function addReason(reasons: Map<string, Set<string>>, path: string, reason: string): void {
  const values = reasons.get(path) ?? new Set<string>();
  values.add(reason);
  reasons.set(path, values);
}
