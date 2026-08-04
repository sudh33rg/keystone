import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { CpgShardStore } from "../intelligence/cpg";
import {
  canonicalRetrievalResult,
  selectCanonicalContext,
  type CanonicalContextSelection
} from "../intelligence/okf/canonicalContext";
import type { OkfQueryResult } from "../intelligence/okf/queryEngine";
import type { KeystoneOkfSnapshot } from "../intelligence/okf/types";
import { analyzeRepositoryGraph } from "../intelligence/pipeline/derivedGraph";
import { buildIntelligenceFindings } from "../intelligence/pipeline/findings";
import {
  retrieveRepositoryIntelligence,
  type IntelligenceRetrievalResult
} from "../intelligence/pipeline/retrieval";
import type {
  ContextPack,
  ContextPacket,
  ContextPacketPayload,
  ContextPacketSegment,
  DeveloperIntent,
  RepoIntelligence,
  RepoSkill,
  RouteDecision
} from "../domain/types";
import { estimateTokens } from "./tokenEstimator";
import { compressIntelligence, compressSourceCode } from "./taskAwareCompression";

export type ContextBuildOptions = {
  compressionTier?: "off" | "standard" | "aggressive";
  codingStandards?: string;
  thingsToAvoid?: string;
  retrievalText?: string;
  semanticEvidence?: readonly string[];
  currentFile?: string;
  gitDiff?: string;
  preferredPaths?: readonly string[];
  excludedPaths?: readonly string[];
  okfSnapshot?: KeystoneOkfSnapshot;
  /** Applies only to the Copilot delegation packet; ingestion is never capped. */
  delegationTokenBudget?: number;
};

/** Builds an intent-specific context pack from persisted intelligence without re-indexing. */
export async function buildIntentContextPack(
  intent: DeveloperIntent,
  intelligence: RepoIntelligence,
  routeDecision: RouteDecision,
  skills: RepoSkill[],
  options: ContextBuildOptions = {}
): Promise<ContextPack> {
  const tier = options.compressionTier ?? "standard";
  const preferredPaths = [
    options.currentFile,
    ...diffPaths(options.gitDiff ?? ""),
    ...(options.preferredPaths ?? [])
  ].filter((value): value is string => Boolean(value));
  const canonicalSelection = options.okfSnapshot
    ? selectCanonicalContext(
        options.okfSnapshot,
        options.retrievalText ? `${intent.text} ${options.retrievalText}` : intent.text,
        { preferredPaths }
      )
    : undefined;
  const graph = canonicalSelection ? undefined : analyzeRepositoryGraph(intelligence);
  const findings = graph ? buildIntelligenceFindings(intelligence, graph) : [];
  const okfQuery = canonicalSelection?.query;
  const retrieval = canonicalSelection
    ? canonicalRetrievalResult(canonicalSelection)
    : await retrieveRepositoryIntelligence(intelligence, graph!, findings, {
        text: options.retrievalText ? `${intent.text}\n${options.retrievalText}` : intent.text,
        limit: 30,
        graphDepth: tier === "aggressive" ? 1 : 2
      });
  const fileByPath = new Map(intelligence.files.map((file) => [file.path, file]));
  const selected = retrieval.results.flatMap((result) => {
    const file = fileByPath.get(result.path);
    return file ? [{ file, result }] : [];
  });
  const okfByPath = new Map(
    (okfQuery?.items ?? []).filter((item) => item.path).map((item) => [item.path!, item])
  );
  const canonicalByPath = new Map(
    (canonicalSelection?.paths ?? []).map((pathValue) => [pathValue, pathValue])
  );
  const canonicalGraphByPath = new Map(
    (canonicalSelection?.graph.nodes ?? [])
      .filter((node) => node.path)
      .map((node) => [node.path!, node])
  );
  const canonicalCandidates = [...canonicalByPath.keys()].flatMap((pathValue) => {
    const file = fileByPath.get(pathValue);
    if (!file) return [];
    const okf = okfByPath.get(pathValue);
    return [
      {
        file,
        result: {
          path: file.path,
          score: (okf?.score ?? 0) + 2,
          reasons: [
            okf ? `canonical OKF evidence: ${okf.reason}` : "canonical OKF graph neighborhood"
          ] as readonly string[]
        }
      }
    ];
  });
  const priorityPaths = [
    ...preferredPaths,
    ...(okfQuery?.items.flatMap((item) => (item.path ? [item.path] : [])) ?? [])
  ];
  const priority = priorityPaths.flatMap((priorityPath) => {
    const file = fileByPath.get(priorityPath);
    const okf = okfByPath.get(priorityPath);
    const reason =
      priorityPath === options.currentFile
        ? "active editor"
        : diffPaths(options.gitDiff ?? "").includes(priorityPath)
          ? "current git diff"
          : okf
            ? `OKF ${okf.reason}`
            : "preferred evidence";
    return file
      ? [
          {
            file,
            result: {
              path: file.path,
              score: okf?.score ?? 1,
              reasons: [reason] as readonly string[]
            }
          }
        ]
      : [];
  });
  const protectedPaths = new Set(
    [options.currentFile, ...diffPaths(options.gitDiff ?? "")].filter(Boolean)
  );
  const excludedPaths = new Set(options.excludedPaths ?? []);
  const ranked = [...priority, ...canonicalCandidates, ...selected]
    .filter((item) => protectedPaths.has(item.file.path) || !excludedPaths.has(item.file.path))
    .filter(
      (item) =>
        protectedPaths.has(item.file.path) || implementationContextPath(item.file.path, intent.text)
    )
    .filter(
      (item, index, all) =>
        all.findIndex((candidate) => candidate.file.path === item.file.path) === index
    );
  const fallback = ranked.length
    ? ranked
    : canonicalSelection
      ? []
      : intelligence.files
          .filter((file) => !file.isGenerated && implementationContextPath(file.path, intent.text))
          .slice(0, 8)
          .map((file) => ({
            file,
            result: {
              path: file.path,
              score: 0,
              reasons: ["repository fallback"] as readonly string[]
            }
          }));
  const relevantFiles = fallback.map((item) => item.file);
  const selectedPaths = new Set(relevantFiles.map((file) => file.path));
  const relevantSymbols = intelligence.symbols
    .filter((symbol) => selectedPaths.has(symbol.filePath))
    .slice(0, 60);
  const relatedTests = intelligence.tests
    .filter((test) => selectedPaths.has(test.targetFile ?? "") || selectedPaths.has(test.testFile))
    .slice(0, 20);
  const relatedApis = intelligence.apis
    .filter((api) => selectedPaths.has(api.filePath))
    .slice(0, 20);
  const impactedServices = intelligence.services
    .filter((service) => selectedPaths.has(service.filePath))
    .slice(0, 12);
  const repoSkills = skills.slice(0, 5);
  const contextSections: NonNullable<ContextPack["contextSections"]> = [];
  const omittedContext: NonNullable<ContextPack["omittedContext"]> = [];
  const cpgStore = new CpgShardStore(intent.workspaceRoot);
  const delegationTokenBudget = Math.max(
    2_000,
    options.delegationTokenBudget ??
      (tier === "aggressive" ? 6_000 : tier === "off" ? 24_000 : 12_000)
  );
  // This builder creates the candidate reservoir. The ContextEngine performs
  // the final budget decision after all candidate families are known, so this
  // phase does not reserve fixed instruction/intelligence percentages.
  const contentBudget = delegationTokenBudget;
  let usedTokens = 0;
  let cpgFiles = 0;
  let cpgSymbols = 0;
  let cpgRelations = 0;
  let traceableEvidence = 0;

  for (const item of fallback) {
    const content = await readSafe(intent.workspaceRoot, item.file.path);
    const cpg = await cpgStore.get(item.file.path);
    const evidence = cpgEvidence(cpg, intent.text, options.semanticEvidence ?? [], item.file.path);
    if (cpg) cpgFiles += 1;
    cpgSymbols += evidence.symbols;
    cpgRelations += evidence.relations;
    const remaining = Math.max(0, contentBudget - usedTokens);
    const protectedFile = protectedPaths.has(item.file.path);
    const perFileBudget = Math.max(
      180,
      Math.min(
        2_400,
        protectedFile
          ? Math.max(remaining, 900)
          : Math.floor(
              remaining / Math.max(1, Math.min(6, fallback.length - contextSections.length))
            )
      )
    );
    const excerpt = semanticExcerpt(content, cpg, intent.text, tier, perFileBudget);
    const compressed = [evidence.text, excerpt.text].filter(Boolean).join("\n\n");
    const tokens = estimateTokens(compressed);
    if (!compressed) continue;
    if (!protectedFile && (remaining < 180 || usedTokens + tokens > contentBudget)) {
      omittedContext.push({
        path: item.file.path,
        reason: `Lower-ranked than selected evidence within the ${delegationTokenBudget}-token delegation packet.`,
        estimatedTokens: tokens
      });
      continue;
    }
    const accepted =
      protectedFile && usedTokens + tokens > contentBudget && !excerpt.compression
        ? compressed
        : protectedFile && usedTokens + tokens > contentBudget && excerpt.compression?.type !== "source-code"
        ? truncateToTokens(compressed, Math.max(180, contentBudget - usedTokens))
        : compressed;
    const acceptedTokens = estimateTokens(accepted);
    const okfItem = okfByPath.get(item.file.path);
    const canonicalNode = canonicalGraphByPath.get(item.file.path);
    const okfRefs = [
      ...(okfItem ? [{ okfId: okfItem.id, kind: okfItem.kind, label: okfItem.label }] : []),
      ...(canonicalNode
        ? [
            {
              okfId: canonicalNode.id,
              kind: canonicalNode.kind,
              label: canonicalNode.label,
              startLine: canonicalNode.line,
              endLine: canonicalNode.line
            }
          ]
        : [])
    ];
    const refs = dedupeRefs([...okfRefs, ...evidence.refs, ...excerpt.refs]);
    traceableEvidence += refs.length;
    contextSections.push({
      path: item.file.path,
      reason: item.result.reasons.join(", "),
      content: accepted,
      estimatedTokens: acceptedTokens,
      sourceHash: item.file.contentHash,
      score: item.result.score,
      evidence: refs,
      compression: excerpt.compression
    });
    usedTokens += acceptedTokens;
  }

  const boundedIntelligence = buildBoundedIntelligence({
    intent: intent.text,
    indexedAt: intelligence.indexedAt,
    selectedFiles: relevantFiles,
    selectedPaths,
    selectedSymbols: relevantSymbols,
    relatedTests,
    relatedApis,
    impactedServices,
    dependencies: intelligence.dependencies,
    calls: intelligence.calls,
    controlFlows: intelligence.controlFlows,
    dataFlows: intelligence.dataFlows,
    typeRelationships: intelligence.typeRelationships,
    findings,
    retrieval,
    okfQuery,
    canonicalSelection
  });
  const contextPackId = crypto.randomUUID();
  const packetBuild = buildContextPackets(
    contextPackId,
    intent.text,
    boundedIntelligence,
    contextSections,
    delegationTokenBudget
  );
  const contextPackets = packetBuild.packets;
  const contextPacketPayloads = packetBuild.payloads;
  const snapshotDigest = options.okfSnapshot
    ? (options.okfSnapshot.manifest.digests.snapshot ??
      options.okfSnapshot.manifest.extractionRunId)
    : undefined;

  const base: Omit<ContextPack, "copilotPrompt"> = {
    id: contextPackId,
    taskSummary: intent.text,
    routeDecision,
    relevantFiles,
    relevantSymbols,
    relatedTests,
    relatedApis,
    impactedServices,
    repoSkills,
    architectureConstraints: [
      "Preserve existing module boundaries unless the task requires a documented change.",
      "Use the supplied graph paths and symbols as evidence; inspect before editing."
    ],
    qaExpectations: [
      "Run the smallest relevant test set first.",
      "Add regression coverage for changed behavior."
    ],
    securityConstraints: [
      "Do not log PII or expose secrets.",
      "Preserve authorization and validation boundaries."
    ],
    performanceConstraints: ["Avoid new blocking work and unbounded traversals in hot paths."],
    modernizationConstraints: ["Keep modernization changes scoped to the stated intent."],
    thingsToAvoid: [
      "Broad repository dumps",
      "Unrelated refactors",
      ...(options.thingsToAvoid ? [options.thingsToAvoid] : [])
    ],
    acceptanceCriteria: [
      "Implement the stated intent only.",
      "Explain changed files and validation evidence.",
      ...(options.codingStandards ? [`Follow workspace standards: ${options.codingStandards}`] : [])
    ],
    estimatedRawTokens: estimateTokens(JSON.stringify(intelligence)),
    estimatedPackedTokens: 0,
    estimatedReductionPercent: 0,
    contextSections,
    boundedIntelligence,
    omittedContext,
    contextPackets,
    contextPacketPayloads,
    contextManifest: {
      delegationTokenBudget,
      usedTokens,
      selectedFiles: contextSections.length,
      omittedFiles: omittedContext.length,
      protectedFiles: [...protectedPaths].filter(Boolean).length,
      traceableEvidence,
      packetCount: contextPackets.length,
      packetIds: contextPackets.map((packet) => packet.id),
      snapshotDigest,
      generatedAt: new Date().toISOString()
    },
    selectedContextTokens: contextSections.reduce(
      (sum, section) => sum + section.estimatedTokens,
      0
    ),
    compressionTier: tier,
    retrievalMetrics: {
      mode: okfQuery ? `okf-${okfQuery.intent}+${retrieval.mode}` : retrieval.mode,
      candidates: retrieval.results.length,
      selectedFiles: relevantFiles.length,
      lexicalEvidenceRate: rate(retrieval.results, (result) =>
        result.reasons.includes("lexical match")
      ),
      graphEvidenceRate: Math.max(
        rate(retrieval.results, (result) => result.reasons.includes("graph neighbor")),
        okfQuery?.traversedRelationships ? 1 : 0
      ),
      intentTermCoverage: intentTermCoverage(
        intent.text,
        relevantFiles.map((file) => `${file.path} ${file.summary}`)
      ),
      meanRetrievalScore: retrieval.results.length
        ? retrieval.results.reduce((sum, result) => sum + result.score, 0) /
          retrieval.results.length
        : 0,
      mappedTestRate: relevantFiles.length
        ? relatedTests.filter((test) => Boolean(test.targetFile)).length / relevantFiles.length
        : 0,
      warnings: [...(okfQuery?.warnings ?? []), ...retrieval.warnings],
      cpgFiles,
      cpgSymbols,
      cpgRelations
    }
  };
  const copilotPrompt = compose(base);
  const estimatedPackedTokens = estimateTokens(copilotPrompt);
  const selectedContextTokens = contextSections.reduce(
    (sum, section) => sum + section.estimatedTokens,
    0
  );
  return {
    ...base,
    contextSections,
    selectedContextTokens,
    copilotPrompt,
    estimatedPackedTokens,
    estimatedReductionPercent: Math.max(
      0,
      Math.round((1 - estimatedPackedTokens / Math.max(base.estimatedRawTokens, 1)) * 100)
    )
  };
}

function cpgEvidence(
  graph: Awaited<ReturnType<CpgShardStore["get"]>>,
  query: string,
  semanticEvidence: readonly string[],
  sourcePath: string
): {
  text: string;
  symbols: number;
  relations: number;
  refs: Array<{
    okfId?: string;
    kind: string;
    label: string;
    startLine?: number;
    endLine?: number;
  }>;
} {
  if (!graph) return { text: "", symbols: 0, relations: 0, refs: [] };
  const terms = new Set(
    query
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?.filter((term) => term.length > 2) ?? []
  );
  const named = graph.nodes
    .filter(
      (node) => node.name && (node.kind === "declaration" || terms.has(node.name.toLowerCase()))
    )
    .sort((left, right) => {
      const leftMatch = terms.has(left.name!.toLowerCase()) ? 1 : 0;
      const rightMatch = terms.has(right.name!.toLowerCase()) ? 1 : 0;
      return rightMatch - leftMatch || left.location.startLine - right.location.startLine;
    })
    .slice(0, 8);
  if (!named.length) return { text: "", symbols: 0, relations: 0, refs: [] };
  const ids = new Set(named.map((node) => node.id));
  const behavioralKinds = new Set(["call", "dfg", "cfg", "cdg", "eog"]);
  const relations = graph.edges
    .filter(
      (edge) => behavioralKinds.has(edge.kind) && (ids.has(edge.sourceId) || ids.has(edge.targetId))
    )
    .slice(0, 12);
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const semanticCalls = semanticEvidence.filter((item) => item.includes(sourcePath)).slice(0, 8);
  const astChildren = new Map<string, string[]>();
  for (const edge of graph.edges.filter((edge) => edge.kind === "ast"))
    astChildren.set(edge.sourceId, [...(astChildren.get(edge.sourceId) ?? []), edge.targetId]);
  const syntaxCalls =
    semanticCalls.length || relations.some((edge) => edge.kind === "call")
      ? []
      : graph.nodes
          .filter((node) => node.syntaxKind === "CallExpression")
          .slice(0, 6)
          .map((node) => {
            const callee = (astChildren.get(node.id) ?? [])
              .map((id) => byId.get(id))
              .find((child) => child?.name);
            return `${callee?.name ?? "call"} @ line ${node.location.startLine}`;
          });
  const lines = [
    "CPG evidence:",
    ...named.map((node) => `- ${node.syntaxKind} ${node.name} @ line ${node.location.startLine}`),
    ...syntaxCalls.map((call) => `- call: ${call}`),
    ...relations.map((edge) => {
      const source = byId.get(edge.sourceId);
      const target = byId.get(edge.targetId);
      return `- ${edge.kind}: ${source?.name ?? source?.syntaxKind ?? edge.sourceId} → ${target?.name ?? target?.syntaxKind ?? edge.targetId}`;
    }),
    ...semanticCalls.map((call) => `- semantic: ${call}`)
  ];
  return {
    text: lines.join("\n"),
    symbols: named.length,
    relations: relations.length + syntaxCalls.length + semanticCalls.length,
    refs: named.map((node) => ({
      okfId: node.okfId,
      kind: node.syntaxKind,
      label: node.name ?? node.syntaxKind,
      startLine: node.location.startLine,
      endLine: node.location.endLine
    }))
  };
}

function rate<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.length ? items.filter(predicate).length / items.length : 0;
}

function intentTermCoverage(query: string, documents: readonly string[]): number {
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9_]+/g)
        ?.filter((term) => term.length > 2) ?? []
    )
  ];
  if (!terms.length) return 0;
  const corpus = documents.join(" ").toLowerCase();
  return terms.filter((term) => corpus.includes(term)).length / terms.length;
}

function diffPaths(diff: string): string[] {
  return [
    ...new Set(
      [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)]
        .map((match) => match[1])
        .filter((path) => path !== "/dev/null")
    )
  ].slice(0, 20);
}

async function readSafe(root: string, relative: string): Promise<string> {
  try {
    const target = path.resolve(root, relative);
    const safeRoot = `${path.resolve(root)}${path.sep}`;
    if (!target.startsWith(safeRoot)) return "";
    return await fs.readFile(target, "utf8");
  } catch {
    return "";
  }
}

function semanticExcerpt(
  content: string,
  graph: Awaited<ReturnType<CpgShardStore["get"]>>,
  query: string,
  tier: ContextBuildOptions["compressionTier"],
  tokenBudget: number
): {
  text: string;
  compression?: import("./contextEngine").ContextCompressionMetadata;
  refs: Array<{
    okfId?: string;
    kind: string;
    label: string;
    startLine?: number;
    endLine?: number;
  }>;
} {
  const normalized = content.replace(/\r\n/g, "\n");
  if (tier === "off") return { text: truncateToTokens(normalized, tokenBudget), refs: [] };
  const terms = new Set(
    query
      .toLowerCase()
      .match(/[a-z0-9_]+/g)
      ?.filter((term) => term.length > 2) ?? []
  );
  const nodes = (graph?.nodes ?? [])
    .filter((node) => node.location.startLine >= 1)
    .map((node) => {
      const label =
        `${node.name ?? ""} ${node.syntaxKind} ${String(node.metadata.text ?? "")}`.toLowerCase();
      const matches = [...terms].filter((term) => label.includes(term)).length;
      const declaration = node.name ? 2 : node.syntaxKind.includes("Declaration") ? 1.5 : 0;
      const flow = /Call|Control|Assignment|Function|Method|Class|Interface/.test(node.syntaxKind)
        ? 0.8
        : 0;
      return { node, score: matches * 3 + declaration + flow };
    })
    .sort((a, b) => b.score - a.score || a.node.location.startLine - b.node.location.startLine);
  const deterministic = compressSourceCode(normalized, {
    query,
    tokenBudget,
    aggressive: tier === "aggressive",
    relevantRanges: nodes.slice(0, tier === "aggressive" ? 10 : 24).map(({ node }) => ({
      startLine: node.location.startLine,
      endLine: node.location.endLine,
      label: node.name ?? node.syntaxKind,
      kind: node.syntaxKind
    }))
  });
  const refs = nodes.slice(0, tier === "aggressive" ? 10 : 24).map(({ node }) => ({
    okfId: node.okfId,
    kind: node.syntaxKind,
    label: node.name ?? node.syntaxKind,
    startLine: node.location.startLine,
    endLine: node.location.endLine
  }));
  return {
    text: deterministic.content,
    compression: deterministic.metadata,
    refs: dedupeRefs([
      ...refs,
      ...deterministic.metadata.evidence.map((item) => ({
        kind: "source-range",
        label: item.label,
        startLine: item.startLine,
        endLine: item.endLine
      }))
    ])
  };
}
function mergeRanges(
  values: readonly { start: number; end: number; score: number }[]
): Array<{ start: number; end: number }> {
  const sorted = [...values].sort((a, b) => a.start - b.start || b.score - a.score);
  const out: Array<{ start: number; end: number }> = [];
  for (const value of sorted) {
    const previous = out.at(-1);
    if (previous && value.start <= previous.end + 1)
      previous.end = Math.max(previous.end, value.end);
    else out.push({ start: value.start, end: value.end });
  }
  return out;
}
function truncateToTokens(value: string, tokens: number): string {
  if (tokens <= 0) return "";
  const maxChars = tokens * 4;
  if (value.length <= maxChars) return value.trim();
  const boundary = Math.max(value.lastIndexOf("\n", maxChars), value.lastIndexOf(" ", maxChars));
  return `${value.slice(0, boundary > maxChars * 0.7 ? boundary : maxChars).trim()}\n… context truncated at delegation boundary …`;
}
function dedupeRefs<T extends { okfId?: string; kind: string; label: string; startLine?: number }>(
  values: readonly T[]
): T[] {
  const seen = new Set<string>();
  return values.filter((item) => {
    const key = item.okfId ?? `${item.kind}:${item.label}:${item.startLine ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function implementationContextPath(value: string, intentText: string): boolean {
  const normalized = value.replace(/\\/g, "/").toLowerCase();
  if (/(?:^|\/)(?:node_modules|dist|build|coverage|vendor|generated)(?:\/|$)/.test(normalized))
    return false;
  if (
    /(?:^|\/)\.github\/(?:agents?|instructions?|skills?)(?:\/|$)/.test(normalized) ||
    /(?:^|\/)agents\.md$/.test(normalized)
  )
    return false;
  if (/(?:^|\/)(?:docs?|scripts?)(?:\/|$)/.test(normalized)) return false;
  if (
    /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig(?:\.[^/]+)?\.json|eslint|prettier|vite|webpack|rollup)/.test(
      normalized
    )
  )
    return /\b(?:dependency|dependencies|package|npm|build|compile|config|configuration|tooling|test framework)\b/i.test(
      intentText
    );
  return true;
}

function compose(pack: Omit<ContextPack, "copilotPrompt">): string {
  return [
    "You are GitHub Copilot, the only implementation agent delegated by Keystone after repository intelligence and intent R&D completed.",
    "Keystone has already indexed the repository and selected a bounded, evidence-backed packet for this intent.",
    "Use the packet as the authoritative working context. Do not search, crawl, enumerate, or retrieve the entire repository.",
    "You may open only the explicitly selected source paths below to verify current content. If the packet is insufficient, report the missing evidence instead of expanding to a repository-wide search.",
    `\n# Intent\n${pack.taskSummary}`,
    `\n# Ordered context packet manifest\n${pack.contextPackets?.map((packet) => `- Packet ${packet.sequence}/${packet.total} ${packet.id}: ${packet.segmentKinds.join(", ")}; ${packet.estimatedTokens} tokens; ${packet.paths.length} source path(s)${packet.continuationToken ? `; continuation ${packet.continuationToken.slice(0, 16)}…` : "; final packet"}`).join("\n") || "One bounded context packet."}`,
    `\n# Bounded Keystone intelligence\n${pack.boundedIntelligence || "No additional OKF/graph digest was available; use the selected excerpts and report any evidence gap."}`,
    `\n# Selected source excerpts\n${pack.contextSections?.map((section) => `## ${section.path}\nReason: ${section.reason}\n\`\`\`\n${section.content}\n\`\`\``).join("\n\n") || "No file excerpts were selected."}`,
    `\n# Relevant symbols\n${pack.relevantSymbols.map((symbol) => `- ${symbol.kind} ${symbol.name} — ${symbol.filePath}:${symbol.line}`).join("\n")}`,
    `\n# Related API contracts\n${pack.relatedApis.map((api) => `- ${api.method} ${api.path} — ${api.filePath}:${api.line}`).join("\n") || "None selected."}`,
    `\n# Impacted services\n${pack.impactedServices.map((service) => `- ${service.name} — ${service.filePath} (${service.hints.join(", ") || "no additional hints"})`).join("\n") || "None selected."}`,
    `\n# Tests\n${pack.relatedTests.map((test) => `- ${test.testFile}${test.targetFile ? ` → ${test.targetFile}` : ""}`).join("\n")}`,
    `\n# Constraints\n${[...pack.architectureConstraints, ...pack.securityConstraints, ...pack.performanceConstraints].map((item) => `- ${item}`).join("\n")}`,
    `\n# Scope exclusions\n${pack.thingsToAvoid.map((item) => `- ${item}`).join("\n")}`,
    `\n# Acceptance criteria\n${pack.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}`,
    "\nExecution boundary: implement only the stated intent, keep changes within the selected paths unless a missing dependency is explicitly reported, and return changed files plus validation results. Do not perform Git write or remote merge operations."
  ].join("\n");
}

function buildContextPackets(
  contextId: string,
  intentText: string,
  boundedIntelligence: string,
  sections: NonNullable<ContextPack["contextSections"]>,
  delegationTokenBudget: number
): {
  packets: NonNullable<ContextPack["contextPackets"]>;
  payloads: NonNullable<ContextPack["contextPacketPayloads"]>;
} {
  const summaryAndIntelligenceBudget = estimateTokens(
    `${intentText}\n${boundedIntelligence}`
  );
  const packetBudget = Math.max(
    1_600,
    Math.min(5_000, Math.max(summaryAndIntelligenceBudget, delegationTokenBudget - summaryAndIntelligenceBudget))
  );
  type Draft = {
    segmentKinds: ContextPacket["segmentKinds"];
    paths: string[];
    estimatedTokens: number;
    segments: ContextPacketSegment[];
  };
  const summaryContent = `Intent: ${intentText}\nThis packet is selected from Keystone's canonical repository intelligence; it is not a repository-wide search.`;
  const summaryTokens = estimateTokens(summaryContent);
  const intelligenceTokens = estimateTokens(boundedIntelligence);
  const drafts: Draft[] = [];
  let current: Draft = {
    segmentKinds: ["summary", "selected-intelligence"],
    paths: [],
    estimatedTokens: Math.min(packetBudget, summaryTokens + intelligenceTokens),
    segments: [
      { kind: "summary", content: summaryContent, estimatedTokens: summaryTokens },
      {
        kind: "selected-intelligence",
        content: boundedIntelligence,
        estimatedTokens: intelligenceTokens
      }
    ]
  };
  for (const section of sections) {
    const content = `## ${section.path}\nReason: ${section.reason}\n\n${section.content}`;
    const estimatedTokens = estimateTokens(content);
    if (current.paths.length && current.estimatedTokens + estimatedTokens > packetBudget) {
      drafts.push(current);
      current = {
        segmentKinds: ["source-excerpts"],
        paths: [],
        estimatedTokens: 0,
        segments: []
      };
    }
    current.paths.push(section.path);
    if (!current.segmentKinds.includes("source-excerpts"))
      current.segmentKinds.push("source-excerpts");
    current.estimatedTokens += estimatedTokens;
    current.segments.push({
      kind: "source-excerpts",
      path: section.path,
      content,
      estimatedTokens
    });
  }
  if (current.paths.length || !drafts.length) drafts.push(current);
  const packets = drafts.map((draft, index) => {
    const sequence = index + 1;
    const total = drafts.length;
    const next = drafts[index + 1];
    const continuationToken = next
      ? crypto
          .createHash("sha256")
          .update(`${contextId}:${sequence}:${next.paths.join("\n")}`)
          .digest("base64url")
      : undefined;
    return {
      id: `${contextId}:packet:${sequence}`,
      sequence,
      total,
      continuationToken,
      segmentKinds: [...draft.segmentKinds],
      paths: [...draft.paths],
      estimatedTokens: draft.estimatedTokens
    };
  });
  const payloads = drafts.map((draft, index) => ({
    ...packets[index],
    segments: draft.segments,
    content: draft.segments.map((segment) => segment.content).join("\n\n")
  }));
  return { packets, payloads };
}

function buildBoundedIntelligence(input: {
  intent: string;
  indexedAt: string;
  selectedFiles: RepoIntelligence["files"];
  selectedPaths: ReadonlySet<string>;
  selectedSymbols: RepoIntelligence["symbols"];
  relatedTests: RepoIntelligence["tests"];
  relatedApis: RepoIntelligence["apis"];
  impactedServices: RepoIntelligence["services"];
  dependencies: RepoIntelligence["dependencies"];
  calls: RepoIntelligence["calls"];
  controlFlows: RepoIntelligence["controlFlows"];
  dataFlows: RepoIntelligence["dataFlows"];
  typeRelationships: RepoIntelligence["typeRelationships"];
  findings: ReturnType<typeof buildIntelligenceFindings>;
  retrieval: IntelligenceRetrievalResult;
  okfQuery?: OkfQueryResult;
  canonicalSelection?: CanonicalContextSelection;
}): string {
  const projectedGraph = input.canonicalSelection?.graph;
  return compressIntelligence({
    task: input.intent,
    indexedAt: input.indexedAt,
    selectedFiles: input.selectedFiles as unknown as Record<string, unknown>[],
    okfItems: (input.okfQuery?.items ?? []).filter(
      (item) => !item.path || input.selectedPaths.has(item.path)
    ) as unknown as Record<string, unknown>[],
    graphNodes: (projectedGraph?.nodes ?? []) as unknown as Record<string, unknown>[],
    graphEdges: (projectedGraph?.edges ?? []) as unknown as Record<string, unknown>[],
    relationships: [
      ...input.dependencies,
      ...(input.calls ?? []),
      ...(input.controlFlows ?? []),
      ...(input.dataFlows ?? []),
      ...(input.typeRelationships ?? []),
      ...(input.okfQuery?.traversals ?? [])
    ] as unknown as Record<string, unknown>[],
    facts: [
      ...input.selectedSymbols,
      ...input.relatedApis,
      ...input.impactedServices,
      ...input.relatedTests
    ] as unknown as Record<string, unknown>[],
    findings: input.findings as unknown as Record<string, unknown>[],
    retrievalBasis: input.retrieval.results as unknown as Record<string, unknown>[],
    tokenBudget: 1_800
  }).content;

  /* The original field-by-field renderer remains below as a compatibility
   * reference for the projection inputs. The return above is authoritative. */
  const lines = [
    "Source: persisted Keystone repository intelligence (not a fresh repository search).",
    `Indexed at: ${input.indexedAt}`,
    `Intent retrieval: ${input.intent}`,
    `Selected source scope: ${input.selectedFiles.length} file(s).`
  ];

  lines.push("", "Selected files and structural summaries:");
  lines.push(
    ...input.selectedFiles.slice(0, 32).map((file) => {
      const details = [
        file.language,
        `${file.lineCount} lines`,
        file.isTest ? "test" : "source",
        file.contentHash ? `content ${file.contentHash.slice(0, 12)}` : "content hash unavailable"
      ];
      return `- ${file.path} [${details.join("; ")}]: ${file.summary || "No summary recorded."}`;
    })
  );

  const okfItems = (input.okfQuery?.items ?? [])
    .filter((item) => !item.path || input.selectedPaths.has(item.path))
    .slice(0, 24);
  lines.push("", `OKF evidence (${okfItems.length} selected item(s)):`);
  lines.push(
    ...okfItems.map(
      (item) =>
        `- ${item.kind} ${item.label}${item.path ? ` — ${item.path}${item.line ? `:${item.line}` : ""}` : ""}; ${item.reason}; confidence ${Math.round(item.confidence * 100)}%`
    )
  );

  const canonicalGraph = input.canonicalSelection?.graph;
  if (canonicalGraph) {
    lines.push(
      "",
      `Canonical OKF graph neighborhood (${canonicalGraph!.mode}; ${canonicalGraph!.nodes.length} nodes, ${canonicalGraph!.edges.length} edges):`
    );
    lines.push(
      ...canonicalGraph!.nodes.slice(0, 32).map((node) => {
        const location = node.path ? ` — ${node.path}${node.line ? `:${node.line}` : ""}` : "";
        return `- ${node.kind} ${node.label}${location}; confidence ${Math.round(node.confidence * 100)}%; evidence ${node.evidenceIds.length}`;
      })
    );
    lines.push(
      ...canonicalGraph!.edges
        .slice(0, 48)
        .map((edge) => `- ${edge.kind}: ${edge.sourceId} → ${edge.targetId}`)
    );
  }
  if (input.okfQuery?.answer) lines.push(`- Query answer: ${input.okfQuery?.answer}`);

  const selectedOkfIds = new Set(okfItems.map((item) => item.id));
  const traversalLines = (input.okfQuery?.traversals ?? [])
    .filter((item) => selectedOkfIds.has(item.sourceId) || selectedOkfIds.has(item.targetId))
    .slice(0, 24)
    .map((item) => `- ${item.sourceLabel} -[${item.relationship}]-> ${item.targetLabel}`);
  if (traversalLines.length) lines.push("", "OKF relationship paths:", ...traversalLines);

  const graphLines = (
    input.canonicalSelection
      ? []
      : [
          ...input.dependencies
            .filter(
              (edge) => input.selectedPaths.has(edge.from) || input.selectedPaths.has(edge.to)
            )
            .slice(0, 18)
            .map((edge) => `- ${edge.kind}: ${edge.from} -> ${edge.to}`),
          ...(input.calls ?? [])
            .filter((call) => input.selectedPaths.has(call.filePath))
            .slice(0, 18)
            .map(
              (call) =>
                `- call: ${call.caller ?? "?"} -> ${call.callee} (${call.filePath}:${call.line})`
            ),
          ...(input.controlFlows ?? [])
            .filter((flow) => input.selectedPaths.has(flow.filePath))
            .slice(0, 12)
            .map((flow) => `- control-flow: ${flow.kind} (${flow.filePath}:${flow.line})`),
          ...(input.dataFlows ?? [])
            .filter((flow) => input.selectedPaths.has(flow.filePath))
            .slice(0, 12)
            .map(
              (flow) =>
                `- data-flow: ${flow.source} -> ${flow.target} (${flow.filePath}:${flow.line})`
            ),
          ...(input.typeRelationships ?? [])
            .filter((relationship) => input.selectedPaths.has(relationship.filePath))
            .slice(0, 12)
            .map(
              (relationship) =>
                `- type: ${relationship.source} ${relationship.kind} ${relationship.target} (${relationship.filePath}:${relationship.line})`
            )
        ]
  ).slice(0, 56);
  if (graphLines.length) lines.push("", "Selected graph relationships:", ...graphLines);

  const findingLines = (input.canonicalSelection ? [] : input.findings)
    .filter((finding) => !finding.filePath || input.selectedPaths.has(finding.filePath))
    .slice(0, 16)
    .map(
      (finding) =>
        `- ${finding.severity} ${finding.category}: ${finding.title}${finding.filePath ? ` (${finding.filePath})` : ""} — ${finding.description}`
    );
  if (findingLines.length) lines.push("", "Selected intelligence findings:", ...findingLines);

  const retrievalLines = (input.canonicalSelection ? [] : input.retrieval.results)
    .filter((result) => input.selectedPaths.has(result.path))
    .slice(0, 24)
    .map((result) => `- ${result.path}: ${result.reasons.join(", ") || "ranked evidence"}`);
  if (retrievalLines.length) lines.push("", "Retrieval basis:", ...retrievalLines);

  lines.push(
    "",
    `Selected symbols: ${input.selectedSymbols.length}; APIs: ${input.relatedApis.length}; services: ${input.impactedServices.length}; mapped tests: ${input.relatedTests.length}.`
  );
  return truncateToTokens(lines.join("\n"), 1_800);
}
