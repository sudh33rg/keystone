import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { EvidenceMetadata, RepoIntelligence } from "../../domain/types";
import { createOkfId, canonicalRelationshipKey } from "./identity";
import { KEYSTONE_OKF_PROFILE, KEYSTONE_OKF_PROFILE_DIGEST } from "./profile";
import {
  KEYSTONE_OKF_PROFILE_ID,
  KEYSTONE_OKF_PROFILE_VERSION,
  type KeystoneKnowledgeKind,
  type KeystoneKnowledgeObservation,
  type KeystoneKnowledgeRelationship,
  type KeystoneKnowledgeUnit,
  type KeystoneOkfSnapshot,
  type OkfConfidence,
  type OkfEvidence,
  type OkfProvenance
} from "./types";

export interface RepoIntelligenceOkfOptions {
  readonly workspaceId?: string;
  readonly extractionRunId?: string;
  readonly repositoryRevision?: string;
  readonly observedAt?: string;
  readonly previousSnapshot?: KeystoneOkfSnapshot;
  readonly onWarning?: (message: string) => void;
}
export function workspaceIdForRoot(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex").slice(0, 24);
}
const digest = (value: unknown): string =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");

export function repoIntelligenceToOkf(
  intelligence: RepoIntelligence,
  options: RepoIntelligenceOkfOptions = {}
): KeystoneOkfSnapshot {
  const workspaceId = options.workspaceId ?? workspaceIdForRoot(intelligence.workspaceRoot);
  const extractionRunId = options.extractionRunId ?? randomUUID();
  const observedAt = options.observedAt ?? intelligence.indexedAt;
  const previous = options.previousSnapshot;
  const warn = (message: string): void => {
    try {
      options.onWarning?.(message);
    } catch (error) {
      console.warn(
        `[Keystone OKF] Warning reporter failed: ${error instanceof Error ? error.message : String(error)}. Original warning: ${message}`
      );
    }
    if (!options.onWarning) console.warn(`[Keystone OKF] ${message}`);
  };
  const fileByPath = new Map(intelligence.files.map((file) => [file.path, file]));
  const previousUnits = new Map((previous?.units ?? []).map((record) => [record.id, record]));
  const previousRelationships = new Map(
    (previous?.relationships ?? []).map((record) => [record.id, record])
  );
  const evidence: OkfEvidence[] = [];
  const units: KeystoneKnowledgeUnit[] = [];
  const relationships: KeystoneKnowledgeRelationship[] = [];
  const observations: KeystoneKnowledgeObservation[] = [];
  const evidenceByKey = new Map<string, string>();
  const unitByKey = new Map<string, string>();
  const unitById = new Map<string, KeystoneKnowledgeUnit>();
  const relationshipIds = new Set<string>();
  const observationIds = new Set<string>();

  const addEvidence = (
    source: EvidenceMetadata | undefined,
    fallbackPath: string,
    method: string,
    ruleId?: string
  ): string => {
    const sourcePath = normalizePath(source?.evidencePath ?? fallbackPath);
    const key = `${sourcePath}:${source?.evidenceLine ?? ""}:${source?.source ?? method}:${ruleId ?? ""}`;
    const existing = evidenceByKey.get(key);
    if (existing) return existing;
    const id = createOkfId(workspaceId, "evidence", key);
    evidence.push({
      id,
      extractor: source?.source ?? "repo-intelligence",
      extractorVersion: source?.extractorVersion ?? "repo-intelligence-okf:v2",
      extractionRunId,
      method,
      ruleId,
      source: {
        workspaceRelativePath: sourcePath,
        startLine: source?.evidenceLine,
        endLine: source?.evidenceLine
      },
      sourceDigest: sourcePath === "." ? undefined : fileByPath.get(sourcePath)?.contentHash,
      repositoryRevision: options.repositoryRevision,
      observedAt,
      freshness: source?.stale ? "stale" : "current"
    });
    evidenceByKey.set(key, id);
    return id;
  };
  const provenance = (
    ids: readonly string[],
    extractor = "repo-intelligence-okf",
    extractorVersion = "2.0.0"
  ): OkfProvenance => ({
    extractionRunId,
    extractor,
    extractorVersion,
    workspaceId,
    repositoryRevision: options.repositoryRevision,
    observedAt,
    evidenceIds: ids
  });
  const confidence = (source?: EvidenceMetadata, fallback = 0.8): OkfConfidence => ({
    score: Math.max(0, Math.min(1, source?.confidence ?? fallback)),
    level: [
      "filesystem",
      "typescript-ast",
      "typescript-checker",
      "coverage",
      "git",
      "runtime"
    ].includes(source?.source ?? "")
      ? "observed"
      : "derived",
    rationale: source?.warnings?.join(" ")
  });
  const addUnit = (
    kind: KeystoneKnowledgeKind,
    canonicalKey: string,
    name: string,
    properties: Record<string, unknown>,
    source?: EvidenceMetadata,
    fallbackPath = canonicalKey,
    description?: string
  ): string => {
    const composite = `${kind}:${canonicalKey}`;
    const existing = unitByKey.get(composite);
    if (existing) return existing;
    const id = createOkfId(workspaceId, "unit", composite);
    const prior = previousUnits.get(id);
    const evidenceId = addEvidence(
      source,
      fallbackPath,
      "deterministic-extraction",
      `unit:${kind}`
    );
    units.push({
      id,
      profile: KEYSTONE_OKF_PROFILE_ID,
      profileVersion: KEYSTONE_OKF_PROFILE_VERSION,
      kind,
      name,
      description,
      canonicalKey,
      properties,
      confidence: confidence(source),
      provenance: provenance([evidenceId]),
      lifecycle: "active",
      firstSeenAt: prior?.firstSeenAt ?? prior?.createdAt ?? observedAt,
      lastSeenAt: observedAt,
      createdAt: prior?.createdAt ?? observedAt,
      updatedAt: observedAt
    });
    unitById.set(id, units[units.length - 1]);
    unitByKey.set(composite, id);
    return id;
  };
  const addRelationship = (
    kind: KeystoneKnowledgeRelationship["kind"],
    sourceId: string,
    targetId: string,
    source?: EvidenceMetadata,
    properties: Record<string, unknown> = {}
  ): string | undefined => {
    const sourceKind = unitById.get(sourceId)?.kind;
    const targetKind = unitById.get(targetId)?.kind;
    let relationshipKind = kind;
    let constraint = KEYSTONE_OKF_PROFILE.relationshipConstraints[relationshipKind];
    if (!sourceKind || !targetKind)
      return (
        warn(`Skipped ${kind}: unknown OKF unit ${!sourceKind ? sourceId : targetId}.`),
        undefined
      );
    if (
      constraint &&
      (!constraint.sources.includes(sourceKind) || !constraint.targets.includes(targetKind))
    ) {
      // Dependency extraction can see documentation and other text artifacts
      // mentioning modules/packages. Those are dependencies, but they are not
      // source-level imports under the OKF profile. Preserve the edge while
      // normalizing it to the profile-compatible relationship kind.
      if (kind === "imports") {
        relationshipKind = "depends-on";
        constraint = KEYSTONE_OKF_PROFILE.relationshipConstraints[relationshipKind];
      } else {
        warn(`Skipped invalid OKF relationship ${kind}: ${sourceKind} -> ${targetKind}.`);
        return undefined;
      }
    }
    const key = canonicalRelationshipKey(relationshipKind, sourceId, targetId);
    const id = createOkfId(workspaceId, "relationship", key);
    if (relationshipIds.has(id)) return id;
    const prior = previousRelationships.get(id);
    const evidenceId = addEvidence(
      source,
      evidencePathForUnit(sourceId) ?? evidencePathForUnit(targetId) ?? ".",
      "deterministic-relationship",
      `relationship:${kind}`
    );
    relationships.push({
      id,
      profile: KEYSTONE_OKF_PROFILE_ID,
      profileVersion: KEYSTONE_OKF_PROFILE_VERSION,
      kind: relationshipKind,
      sourceId,
      targetId,
      properties,
      confidence: confidence(source),
      provenance: provenance([evidenceId]),
      lifecycle: "active",
      firstSeenAt: prior?.firstSeenAt ?? prior?.createdAt ?? observedAt,
      lastSeenAt: observedAt,
      createdAt: prior?.createdAt ?? observedAt,
      updatedAt: observedAt
    });
    relationshipIds.add(id);
    return id;
  };
  const addObservation = (
    subjectId: string,
    predicate: string,
    value: unknown,
    source?: EvidenceMetadata
  ): void => {
    const key = `${subjectId}:${predicate}:${digest(value)}`;
    const id = createOkfId(workspaceId, "observation", key);
    if (observationIds.has(id)) return;
    const evidenceId = addEvidence(
      source,
      evidencePathForUnit(subjectId) ?? ".",
      "deterministic-observation",
      predicate
    );
    observations.push({
      id,
      profile: KEYSTONE_OKF_PROFILE_ID,
      profileVersion: KEYSTONE_OKF_PROFILE_VERSION,
      subjectId,
      predicate,
      value,
      valueType:
        value === null
          ? "null"
          : Array.isArray(value)
            ? "array"
            : typeof value === "object"
              ? "object"
              : (typeof value as "string" | "number" | "boolean"),
      confidence: confidence(source),
      provenance: provenance([evidenceId]),
      observedAt
    });
    observationIds.add(id);
  };
  function evidencePathForUnit(id: string): string | undefined {
    const unit = unitById.get(id);
    const p = unit?.properties.path ?? unit?.properties.filePath;
    return typeof p === "string" ? p : undefined;
  }

  const workspaceUnit = addUnit(
    "workspace",
    "workspace",
    path.basename(intelligence.workspaceRoot),
    { frameworkHints: intelligence.frameworkHints, ownershipHints: intelligence.ownershipHints },
    undefined,
    ".",
    "Active VS Code workspace"
  );
  const repositoryUnit = addUnit(
    "repository",
    "repository",
    path.basename(intelligence.workspaceRoot),
    { rootKind: "local-workspace", fileCount: intelligence.files.length },
    undefined,
    ".",
    "Repository indexed by Keystone"
  );
  addRelationship("contains", workspaceUnit, repositoryUnit);
  addObservation(repositoryUnit, "keystone:indexedAt", observedAt);
  addObservation(repositoryUnit, "keystone:fileCount", intelligence.files.length);

  for (const file of intelligence.files) {
    const kind: KeystoneKnowledgeKind =
      file.language === "markdown"
        ? "documentation"
        : file.isTest
          ? "test"
          : isConfiguration(file.path, file.language)
            ? "configuration"
            : "file";
    const id = addUnit(
      kind,
      file.path,
      path.basename(file.path),
      {
        path: file.path,
        language: file.language,
        sizeBytes: file.sizeBytes,
        lineCount: file.lineCount,
        summary: file.summary,
        contentHash: file.contentHash,
        structuralHash: file.structuralHash,
        generated: file.isGenerated
      },
      file.evidence,
      file.path
    );
    addRelationship("contains", repositoryUnit, id, file.evidence);
    addObservation(id, "keystone:language", file.language, file.evidence);
    addObservation(id, "keystone:contentHash", file.contentHash ?? null, file.evidence);
    addObservation(id, "keystone:lineCount", file.lineCount, file.evidence);
  }
  const fileId = (p: string): string | undefined =>
    unitByKey.get(`file:${p}`) ??
    unitByKey.get(`test:${p}`) ??
    unitByKey.get(`documentation:${p}`) ??
    unitByKey.get(`configuration:${p}`);
  const symbolByName = new Map<string, string[]>();
  const symbolByFileAndName = new Map<string, string>();
  for (const symbol of intelligence.symbols) {
    const id = addUnit(
      "symbol",
      `${symbol.filePath}#${symbol.name}:${symbol.line}`,
      symbol.name,
      {
        symbolKind: symbol.kind,
        filePath: symbol.filePath,
        line: symbol.line,
        exportStatus: symbol.exportStatus
      },
      symbol.evidence,
      symbol.filePath
    );
    const parent = fileId(symbol.filePath);
    if (parent) addRelationship("defines", parent, id, symbol.evidence);
    const arr = symbolByName.get(symbol.name) ?? [];
    arr.push(id);
    symbolByName.set(symbol.name, arr);
    symbolByFileAndName.set(`${symbol.filePath}#${symbol.name}`, id);
    addObservation(id, "keystone:exportStatus", symbol.exportStatus, symbol.evidence);
  }
  for (const relation of intelligence.typeRelationships ?? []) {
    const parent = fileId(relation.filePath);
    const source =
      symbolByFileAndName.get(`${relation.filePath}#${relation.source}`) ??
      addUnit(
        "symbol",
        `${relation.filePath}#${relation.source}:type`,
        relation.source,
        {
          symbolKind: "type",
          filePath: relation.filePath,
          line: relation.line,
          exportStatus: "unknown"
        },
        relation.evidence,
        relation.filePath
      );
    const target =
      symbolByFileAndName.get(`${relation.filePath}#${relation.target}`) ??
      symbolByName.get(relation.target)?.[0] ??
      addUnit(
        "symbol",
        `external-type:${relation.target}`,
        relation.target,
        { symbolKind: "type", external: true },
        relation.evidence,
        relation.filePath
      );
    if (parent) addRelationship("defines", parent, source, relation.evidence);
    addRelationship(relation.kind, source, target, relation.evidence);
  }
  for (const edge of intelligence.dependencies) {
    const from = fileId(edge.from);
    const to =
      fileId(edge.to) ??
      addUnit(
        edge.kind === "package" ? "package" : "module",
        edge.to,
        edge.to,
        { reference: edge.to, dependencyKind: edge.kind },
        edge.evidence,
        edge.from
      );
    if (from) {
      addRelationship(
        edge.kind === "import" || edge.kind === "require" || edge.kind === "local"
          ? "imports"
          : "depends-on",
        from,
        to,
        edge.evidence,
        { dependencyKind: edge.kind }
      );
      const flow = addUnit(
        "call-flow",
        `${edge.from}->${edge.to}`,
        `${path.basename(edge.from)} → ${path.basename(edge.to)}`,
        { sourcePath: edge.from, targetPath: edge.to, flowKind: "dependency" },
        edge.evidence,
        edge.from
      );
      addRelationship("defines", from, flow, edge.evidence);
      addRelationship("flows-to", flow, to, edge.evidence);
    }
  }
  for (const call of intelligence.calls ?? []) {
    const parent = fileId(call.filePath);
    if (!parent) continue;
    const callerCandidates = call.caller ? (symbolByName.get(call.caller) ?? []) : [];
    const calleeCandidates = symbolByName.get(call.callee.split(".").at(-1) ?? call.callee) ?? [];
    const flow = addUnit(
      "call-flow",
      `call:${call.filePath}:${call.line}:${call.caller ?? "<file>"}->${call.callee}`,
      `${call.caller ?? path.basename(call.filePath)} → ${call.callee}`,
      { filePath: call.filePath, line: call.line, caller: call.caller, callee: call.callee },
      call.evidence,
      call.filePath
    );
    addRelationship("defines", parent, flow, call.evidence);
    const source = callerCandidates[0] ?? flow;
    const target = calleeCandidates[0];
    if (target) addRelationship("calls", source, target, call.evidence);
    else addObservation(flow, "keystone:unresolvedCallee", call.callee, call.evidence);
  }
  for (const flowFact of intelligence.controlFlows ?? []) {
    const parent = fileId(flowFact.filePath);
    if (!parent) continue;
    const flow = addUnit(
      "call-flow",
      `control:${flowFact.filePath}:${flowFact.line}:${flowFact.kind}`,
      `${flowFact.kind} control flow`,
      {
        filePath: flowFact.filePath,
        line: flowFact.line,
        flowKind: "control",
        controlKind: flowFact.kind
      },
      flowFact.evidence,
      flowFact.filePath
    );
    addRelationship("defines", parent, flow, flowFact.evidence);
  }
  for (const flowFact of intelligence.dataFlows ?? []) {
    const parent = fileId(flowFact.filePath);
    if (!parent) continue;
    const flow = addUnit(
      "data-flow",
      `data:${flowFact.filePath}:${flowFact.line}:${flowFact.source}->${flowFact.target}`,
      `${flowFact.source} → ${flowFact.target}`,
      {
        filePath: flowFact.filePath,
        line: flowFact.line,
        source: flowFact.source,
        target: flowFact.target
      },
      flowFact.evidence,
      flowFact.filePath
    );
    const sourceEntity = addUnit(
      "data-entity",
      `variable:${flowFact.filePath}:${flowFact.source}`,
      flowFact.source,
      { entityKind: "variable", filePath: flowFact.filePath },
      flowFact.evidence,
      flowFact.filePath
    );
    const targetEntity = addUnit(
      "data-entity",
      `variable:${flowFact.filePath}:${flowFact.target}`,
      flowFact.target,
      { entityKind: "variable", filePath: flowFact.filePath },
      flowFact.evidence,
      flowFact.filePath
    );
    addRelationship("defines", parent, flow, flowFact.evidence);
    addRelationship("reads", flow, sourceEntity, flowFact.evidence);
    addRelationship("writes", flow, targetEntity, flowFact.evidence);
    addRelationship("flows-to", sourceEntity, targetEntity, flowFact.evidence);
  }
  for (const api of intelligence.apis) {
    const id = addUnit(
      "api",
      `${api.method}:${api.path}:${api.filePath}:${api.line}`,
      `${api.method.toUpperCase()} ${api.path}`,
      { method: api.method, route: api.path, filePath: api.filePath, line: api.line },
      api.evidence,
      api.filePath
    );
    const parent = fileId(api.filePath);
    if (parent) {
      const parentKind = unitById.get(parent)?.kind;
      addRelationship(
        parentKind === "file" || parentKind === "module" || parentKind === "service"
          ? "exposes"
          : "defines",
        parent,
        id,
        api.evidence
      );
    }
    addObservation(id, "keystone:httpMethod", api.method.toUpperCase(), api.evidence);
  }
  for (const service of intelligence.services) {
    const id = addUnit(
      "service",
      `${service.filePath}:${service.name}`,
      service.name,
      { filePath: service.filePath, hints: service.hints },
      service.evidence,
      service.filePath
    );
    const parent = fileId(service.filePath);
    if (parent) addRelationship("defines", parent, id, service.evidence);
    const boundary = addUnit(
      "architecture-boundary",
      `service:${service.name}`,
      `${service.name} boundary`,
      { boundaryType: "service", serviceId: id, filePath: service.filePath },
      service.evidence,
      service.filePath
    );
    addRelationship("contains", repositoryUnit, boundary, service.evidence);
    addRelationship("contains", boundary, id, service.evidence);
  }
  for (const test of intelligence.tests) {
    const tid = fileId(test.testFile);
    const target = test.targetFile ? fileId(test.targetFile) : undefined;
    const sourceKind = tid ? unitById.get(tid)?.kind : undefined;
    const targetKind = target ? unitById.get(target)?.kind : undefined;
    const validTestTarget = [
      "file",
      "symbol",
      "api",
      "service",
      "configuration",
      "data-entity",
      "module"
    ].includes(targetKind ?? "");
    if (tid && sourceKind === "test" && target && validTestTarget) {
      addRelationship("tests", tid, target, test.evidence, {
        reason: test.reason,
        mappingConfidence: test.confidence
      });
      addRelationship("covers", tid, target, test.evidence, { mappingConfidence: test.confidence });
    } else if (tid && sourceKind === "test" && test.targetFile && targetKind) {
      // Preserve the mapping as provenance without emitting an invalid
      // relationship when older structural intelligence points at documentation.
      warn(`Skipped invalid OKF relationship tests: ${sourceKind} -> ${targetKind}.`);
      addObservation(tid, "keystone:ignoredTestTarget", test.targetFile, test.evidence);
    }
  }
  for (const file of intelligence.files.filter(
    (item) => item.language === "sql" || /\.(?:sql|prisma)$/i.test(item.path)
  )) {
    const id = addUnit(
      "data-entity",
      `data:${file.path}`,
      path.basename(file.path),
      { filePath: file.path, entityKind: "schema-or-query" },
      file.evidence,
      file.path
    );
    const parent = fileId(file.path);
    if (parent) addRelationship("defines", parent, id, file.evidence);
  }
  for (const file of intelligence.files.filter((item) => item.language === "markdown")) {
    const doc = fileId(file.path);
    if (doc && unitById.get(doc)?.kind === "documentation")
      addRelationship("documented-by", repositoryUnit, doc, file.evidence);
  }
  for (const file of intelligence.files.filter((item) =>
    isConfiguration(item.path, item.language)
  )) {
    const cfg = fileId(file.path);
    if (cfg && unitById.get(cfg)?.kind === "configuration")
      addRelationship("configured-by", repositoryUnit, cfg, file.evidence);
  }
  const addRisk = (kind: "security" | "performance" | "modernization", value: string): void => {
    const parsed = parseSignal(value);
    const source = parsed.path ? fileByPath.get(parsed.path)?.evidence : undefined;
    const unitKind = kind === "modernization" ? "change-impact" : "risk-area";
    const id = addUnit(
      unitKind,
      `${kind}:${value}`,
      parsed.message,
      { category: kind, value, filePath: parsed.path },
      source,
      parsed.path ?? "."
    );
    addRelationship("contains", repositoryUnit, id, source);
    const target = parsed.path ? fileId(parsed.path) : undefined;
    if (target) addRelationship("may-impact", id, target, source);
    addObservation(id, "keystone:riskCategory", kind, source);
  };
  intelligence.securitySensitiveAreas.forEach((v) => addRisk("security", v));
  intelligence.performanceSensitivePaths.forEach((v) => addRisk("performance", v));
  intelligence.modernizationCandidates.forEach((v) => addRisk("modernization", v));
  for (const framework of intelligence.frameworkHints) {
    addObservation(repositoryUnit, "keystone:framework", framework);
    const boundary = addUnit(
      "architecture-boundary",
      `framework:${framework}`,
      `${framework} boundary`,
      { boundaryType: "framework", framework },
      undefined,
      "."
    );
    addRelationship("contains", repositoryUnit, boundary);
  }
  for (const owner of intelligence.ownershipHints)
    addObservation(repositoryUnit, "keystone:ownershipHint", owner);

  // Retain tombstones for records removed since the previous promoted snapshot.
  const currentUnitIds = new Set(units.map((item) => item.id));
  for (const old of previous?.units ?? []) {
    if (old.lifecycle !== "deleted" && !currentUnitIds.has(old.id))
      units.push({
        ...old,
        lifecycle: "deleted",
        lastSeenAt: observedAt,
        updatedAt: observedAt,
        provenance: provenance(old.provenance.evidenceIds)
      });
  }
  const currentRelationshipIds = new Set(relationships.map((item) => item.id));
  const previousUnitKinds = new Map((previous?.units ?? []).map((item) => [item.id, item.kind]));
  for (const old of previous?.relationships ?? []) {
    const sourceKind = unitById.get(old.sourceId)?.kind ?? previousUnitKinds.get(old.sourceId);
    const targetKind = unitById.get(old.targetId)?.kind ?? previousUnitKinds.get(old.targetId);
    const constraint = KEYSTONE_OKF_PROFILE.relationshipConstraints[old.kind];
    const validPreviousRelationship =
      Boolean(constraint) &&
      Boolean(sourceKind) &&
      Boolean(targetKind) &&
      constraint!.sources.includes(sourceKind!) &&
      constraint!.targets.includes(targetKind!);
    if (
      old.lifecycle !== "deleted" &&
      !currentRelationshipIds.has(old.id) &&
      validPreviousRelationship
    )
      relationships.push({
        ...old,
        lifecycle: "deleted",
        lastSeenAt: observedAt,
        updatedAt: observedAt,
        provenance: provenance(old.provenance.evidenceIds)
      });
  }

  const retainedEvidenceIds = new Set(
    [...units, ...relationships].flatMap((item) => item.provenance.evidenceIds)
  );
  const currentEvidenceIds = new Set(evidence.map((item) => item.id));
  for (const oldEvidence of previous?.evidence ?? [])
    if (retainedEvidenceIds.has(oldEvidence.id) && !currentEvidenceIds.has(oldEvidence.id)) {
      evidence.push({ ...oldEvidence, freshness: "stale" });
      currentEvidenceIds.add(oldEvidence.id);
    }
  const active = units.filter((item) => item.lifecycle === "active").length;
  const deleted = units.length - active;
  const digests = {
    units: digest(units),
    relationships: digest(relationships),
    observations: digest(observations),
    evidence: digest(evidence)
  };
  return {
    manifest: {
      format: "keystone-okf",
      formatVersion: 2,
      profile: KEYSTONE_OKF_PROFILE_ID,
      profileVersion: KEYSTONE_OKF_PROFILE_VERSION,
      profileDigest: KEYSTONE_OKF_PROFILE_DIGEST,
      workspaceId,
      generatedAt: observedAt,
      extractionRunId,
      parentExtractionRunId: previous?.manifest.extractionRunId,
      repositoryRevision: options.repositoryRevision,
      validation: { valid: true, validatorVersion: "2.0.0", validatedAt: observedAt },
      projections: { graphVersion: 1, cpgBindingVersion: 1, searchVersion: 1 },
      counts: {
        units: units.length,
        relationships: relationships.length,
        observations: observations.length,
        evidence: evidence.length,
        active,
        deleted
      },
      digests
    },
    units,
    relationships,
    observations,
    evidence
  };
}
function normalizePath(value: string): string {
  const normalized = value.split(path.sep).join("/");
  return normalized === "" ? "." : normalized;
}
function isConfiguration(filePath: string, language: string): boolean {
  return (
    ["json", "yaml", "toml", "xml"].includes(language) ||
    /(?:^|\/)(?:package\.json|tsconfig.*\.json|.*\.ya?ml|.*\.toml|.*\.properties|Dockerfile|Makefile)$/i.test(
      filePath
    )
  );
}
function parseSignal(value: string): { path?: string; message: string } {
  const match = value.match(/^([^:]+):\s*(.+)$/);
  return match ? { path: match[1], message: match[2] } : { message: value };
}
