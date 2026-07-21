import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type {
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
} from "../../shared/contracts/intelligence";
import {
  TestImpactSelectionSchema,
  ValidationEvidenceSchema,
  ValidationFindingSchema,
  type TaskExecutionSession,
  type TestImpactSelection,
  type ValidationEvidence,
  type ValidationFinding,
  type ValidationStep,
  type ValidationStepType,
} from "../../shared/contracts/execution";
import type { DevelopmentSpecification } from "../../shared/contracts/delegation";
import type { CpgNode, CpgScopeArtifact } from "../../shared/contracts/cpg";
import { intelligenceDiagnosticFingerprint } from "../execution/ExecutionAnalysisServices";

const TEST_RELATIONSHIPS = new Set([
  "keystone.core.TESTS",
  "keystone.core.COVERS",
  "keystone.core.CALLS",
  "keystone.core.REFERENCES",
  "keystone.core.IMPORTS",
]);

export class TestImpactService {
  constructor(private readonly snapshots: IntelligenceSnapshotReader) {}

  select(
    session: TaskExecutionSession,
    excludedEntityIds: readonly string[] = [],
  ): TestImpactSelection[] {
    const snapshot = this.snapshots.getSnapshot();
    if (!snapshot) return [];
    const changed = new Set([
      ...session.expectedEntityIds,
      ...session.changedEntities.map((item) => item.entityId),
    ]);
    const excluded = new Set(excludedEntityIds);
    const candidates = new Map<string, TestImpactSelection>();
    for (const relation of snapshot.relationships) {
      if (!TEST_RELATIONSHIPS.has(relation.type)) continue;
      const source = snapshot.symbols.find((item) => item.id === relation.sourceId);
      const target = snapshot.symbols.find((item) => item.id === relation.targetId);
      const test = isTest(source) ? source : isTest(target) ? target : undefined;
      const production = test === source ? target : source;
      if (!test || !production || !changed.has(production.id)) continue;
      const file = snapshot.files.find((item) => item.id === test.fileId);
      if (!file) continue;
      const tier = mappingTier(relation);
      const value = TestImpactSelectionSchema.parse({
        testEntityId: test.id,
        relativePath: file.relativePath,
        qualifiedName: test.qualifiedName,
        confidence: relation.confidence,
        tier,
        reasons: [
          `${relation.type.replace("keystone.core.", "")} maps this test to ${production.qualifiedName}.`,
          `Resolution: ${relation.resolution ?? relation.derivation}; confidence ${relation.confidence.toFixed(2)}.`,
        ],
        evidenceIds: relation.evidenceIds,
        selected: !excluded.has(test.id) && tier !== "naming-candidate",
      });
      const existing = candidates.get(test.id);
      if (!existing || rank(value.tier) > rank(existing.tier)) candidates.set(test.id, value);
    }
    return [...candidates.values()]
      .sort(
        (left, right) =>
          rank(right.tier) - rank(left.tier) ||
          right.confidence - left.confidence ||
          left.qualifiedName.localeCompare(right.qualifiedName),
      )
      .slice(0, 500);
  }
}

export abstract class RepositoryCommandValidationProvider {
  abstract readonly type: ValidationStepType;
  abstract readonly scriptNames: readonly string[];
  abstract readonly requiredByDefault: boolean;
  readonly timeoutMs = 5 * 60_000;
  describe(scriptName: string): string {
    return `Run repository script ${scriptName}.`;
  }
}

export class BuildValidationProvider extends RepositoryCommandValidationProvider {
  readonly type = "build" as const;
  readonly scriptNames = ["build"];
  readonly requiredByDefault = true;
}

export class TypeCheckValidationProvider extends RepositoryCommandValidationProvider {
  readonly type = "type-check" as const;
  readonly scriptNames = ["typecheck", "type-check"];
  readonly requiredByDefault = true;
}

export class LintValidationProvider extends RepositoryCommandValidationProvider {
  readonly type = "lint" as const;
  readonly scriptNames = ["lint"];
  readonly requiredByDefault = true;
}

export class TestValidationProvider extends RepositoryCommandValidationProvider {
  readonly type = "unit-test" as const;
  readonly scriptNames = ["test"];
  readonly requiredByDefault = true;
  override readonly timeoutMs = 10 * 60_000;
}

export class ValidationEvidenceService {
  create(input: Omit<ValidationEvidence, "id" | "createdAt">): ValidationEvidence {
    return ValidationEvidenceSchema.parse({
      ...input,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    });
  }
}

export class ValidationFindingService {
  create(input: Omit<ValidationFinding, "id">): ValidationFinding {
    return ValidationFindingSchema.parse({ ...input, id: crypto.randomUUID() });
  }
}

export interface ProviderResult {
  status: "passed" | "failed" | "skipped";
  output: string;
  evidence: ValidationEvidence[];
  findings: ValidationFinding[];
}

export class SpecificationConformanceService {
  constructor(
    private readonly evidence = new ValidationEvidenceService(),
    private readonly findings = new ValidationFindingService(),
  ) {}

  validate(
    session: TaskExecutionSession,
    specification: DevelopmentSpecification,
    step: ValidationStep,
  ): ProviderResult {
    const unexpected = session.observedChanges.filter(
      (item) =>
        ["unexpected", "ambiguous", "excluded"].includes(item.classification) && !item.userOverride,
    );
    const missingExpected = session.expectedFiles.filter(
      (path) =>
        !session.observedChanges.some(
          (item) => item.relativePath === path && item.kind !== "deleted",
        ),
    );
    const evidence = this.evidence.create({
      kind: "git-diff",
      source: `validation-step:${step.id}:${step.acceptanceCriterionIds.join(",")}`,
      reliability: "exact",
      summary: `${unexpected.length} unresolved out-of-scope changes; ${missingExpected.length} expected paths without an observed change. Scope exclusions were compared against specification revision ${specification.revision}.`,
    });
    const findings: ValidationFinding[] = [];
    for (const change of unexpected) {
      findings.push(
        this.findings.create({
          title: "Out-of-scope repository change",
          description: `${change.relativePath} is ${change.classification} and has not been explicitly accepted.`,
          severity: "blocking",
          category: "scope",
          relatedEntityIds: change.relatedEntityIds,
          acceptanceCriterionIds: step.acceptanceCriterionIds,
          evidenceIds: [evidence.id],
          suggestedAction:
            "Revert, attribute, or explicitly accept the change with a recorded reason.",
          retryRelevant: true,
        }),
      );
    }
    return {
      status: unexpected.length ? "failed" : "passed",
      output: evidence.summary,
      evidence: [evidence],
      findings,
    };
  }
}

export class StaticValidationProvider {
  constructor(
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly evidence = new ValidationEvidenceService(),
    private readonly findings = new ValidationFindingService(),
  ) {}

  validate(session: TaskExecutionSession, step: ValidationStep): ProviderResult {
    const snapshot = this.snapshots.getSnapshot();
    const paths = new Set(session.observedChanges.map((item) => item.relativePath));
    const diagnostics = (snapshot?.diagnostics ?? []).filter(
      (item) => !item.relativePath || paths.has(item.relativePath),
    );
    const baseline = new Set(session.repositoryBaseline.diagnosticFingerprints);
    const introduced = diagnostics.filter(
      (item) => !baseline.has(intelligenceDiagnosticFingerprint(item)),
    );
    const evidence = introduced.slice(0, 100).map((item) =>
      this.evidence.create({
        kind: "diagnostic",
        source: item.entityId ?? item.relativePath ?? item.code,
        reliability: "observed",
        summary: `${item.severity} ${item.code}: ${item.message}`,
        ...(item.relativePath ? { reference: item.relativePath } : {}),
      }),
    );
    const errors = introduced.filter((item) => item.severity === "error");
    const findings = errors.map((item, index) =>
      this.findings.create({
        title: `Introduced static diagnostic: ${item.code}`,
        description: item.message,
        severity: "blocking",
        category: staticCategory(item.code),
        relatedEntityIds: item.entityId ? [item.entityId] : [],
        acceptanceCriterionIds: step.acceptanceCriterionIds,
        evidenceIds: evidence[index] ? [evidence[index].id] : [],
        suggestedAction: "Resolve the diagnostic and rerun validation.",
        retryRelevant: true,
      }),
    );
    return {
      status: errors.length ? "failed" : "passed",
      output:
        introduced
          .slice(0, 100)
          .map((item) => `${item.severity}: ${item.message}`)
          .join("\n") || "No new changed-scope diagnostics.",
      evidence,
      findings,
    };
  }
}

export class SecurityValidationProvider {
  constructor(
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly evidence = new ValidationEvidenceService(),
    private readonly findings = new ValidationFindingService(),
  ) {}

  async validate(session: TaskExecutionSession, step: ValidationStep): Promise<ProviderResult> {
    const manifest = this.snapshots.getCpgManifest?.();
    if (!manifest || !this.snapshots.readCpgScope) return unsupportedSecurity();
    const changed = new Set(session.changedEntities.map((item) => item.entityId));
    const scopes = manifest.scopes
      .filter((item) => changed.has(item.semanticSymbolId))
      .slice(0, 100);
    const evidence: ValidationEvidence[] = [];
    const findings: ValidationFinding[] = [];
    for (const descriptor of scopes) {
      const artifact = await this.snapshots.readCpgScope(descriptor.id);
      if (!artifact) continue;
      for (const path of securityPaths(artifact).slice(0, 20)) {
        const source = artifact.nodes.find((item) => item.id === path[0]);
        const sink = artifact.nodes.find((item) => item.id === path.at(-1));
        if (!source || !sink) continue;
        const item = this.evidence.create({
          kind: "cpg-path",
          source: `${descriptor.semanticSymbolId}#${source.id}`,
          reliability: "inferred",
          summary: `Local CPG data flow connects ${source.code ?? source.kind} to ${sink.code ?? sink.kind}.`,
          reference: `${descriptor.semanticSymbolId}#${sink.id}`,
        });
        evidence.push(item);
        findings.push(
          this.findings.create({
            title: "Changed-scope untrusted-input flow candidate",
            description: `A bounded local CPG path connects a recognized untrusted-input source to a dangerous sink in ${descriptor.name}.`,
            severity: "error",
            category: "security",
            relatedEntityIds: [descriptor.semanticSymbolId],
            acceptanceCriterionIds: step.acceptanceCriterionIds,
            evidenceIds: [item.id],
            suggestedAction:
              "Verify validation/authorization or parameterization on this exact path.",
            retryRelevant: true,
            details: {
              rule: "keystone.security.local-untrusted-input-to-dangerous-sink",
              source: source.code ?? source.kind,
              sink: sink.code ?? sink.kind,
              path,
              confidence: pathConfidence(artifact, path),
              limitations: [
                "This is bounded intraprocedural CPG evidence, not repository-wide taint assurance.",
                "Framework sanitizers are not inferred unless represented on the selected path.",
              ],
            },
          }),
        );
      }
    }
    if (!scopes.length) return unsupportedSecurity();
    return {
      status: findings.length ? "failed" : "passed",
      output: findings.length
        ? `${findings.length} deterministic local CPG security candidate(s).`
        : `Checked ${scopes.length} changed CPG scope(s); no supported local source-to-sink path was found. This is not full security assurance.`,
      evidence,
      findings,
    };
  }
}

export class PerformanceValidationProvider {
  constructor(
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly evidence = new ValidationEvidenceService(),
    private readonly findings = new ValidationFindingService(),
  ) {}

  validate(session: TaskExecutionSession, step: ValidationStep): ProviderResult {
    const snapshot = this.snapshots.getSnapshot();
    const changed = new Set(session.changedEntities.map((item) => item.entityId));
    const candidates = (snapshot?.symbols ?? []).filter(
      (item) => changed.has(item.id) && (item.codeAnalysis?.branches ?? 0) >= 20,
    );
    const evidence = candidates.map((item) =>
      this.evidence.create({
        kind: "changed-symbol",
        source: item.id,
        reliability: "inferred",
        summary: `${item.qualifiedName} has ${item.codeAnalysis?.branches} CPG branches after the change.`,
      }),
    );
    const findings = candidates.map((item, index) =>
      this.findings.create({
        title: "Changed high-branch-count symbol",
        description: `${item.qualifiedName} has ${item.codeAnalysis?.branches} CPG branches. This is a structural complexity candidate, not a measured runtime regression.`,
        severity: "warning",
        category: "performance",
        relatedEntityIds: [item.id],
        acceptanceCriterionIds: step.acceptanceCriterionIds,
        evidenceIds: evidence[index] ? [evidence[index].id] : [],
        suggestedAction:
          "Review complexity and run configured performance measurements for hot paths.",
        retryRelevant: false,
        details: {
          rule: "keystone.performance.changed-high-branch-count",
          confidence: item.codeAnalysis?.confidence ?? item.confidence,
          limitations: ["No runtime performance claim is made without measurement."],
        },
      }),
    );
    return {
      status: "passed",
      output:
        findings.map((item) => item.description).join("\n") ||
        "No supported changed-scope performance candidate was detected.",
      evidence,
      findings,
    };
  }
}

function unsupportedSecurity(): ProviderResult {
  return {
    status: "skipped",
    output:
      "No precise changed-scope CPG artifact was available; security validation is unsupported for this scope and no assurance is claimed.",
    evidence: [],
    findings: [],
  };
}

function securityPaths(artifact: CpgScopeArtifact): string[][] {
  const sources = artifact.nodes.filter(isUntrustedSource);
  const sinks = new Set(artifact.nodes.filter(isDangerousSink).map((item) => item.id));
  const adjacency = new Map<string, string[]>();
  for (const edge of artifact.edges) {
    if (
      ![
        "FLOWS_TO",
        "REACHING_DEFINITION",
        "ARGUMENT_TO_PARAMETER",
        "RETURN_TO_CALL",
        "RECEIVER_TO_CALL",
      ].includes(edge.type)
    )
      continue;
    adjacency.set(edge.sourceId, [...(adjacency.get(edge.sourceId) ?? []), edge.targetId]);
  }
  const paths: string[][] = [];
  for (const source of sources) {
    const queue: string[][] = [[source.id]];
    const visited = new Set([source.id]);
    while (queue.length && paths.length < 20) {
      const path = queue.shift()!;
      const id = path.at(-1)!;
      if (path.length > 1 && sinks.has(id)) {
        paths.push(path);
        continue;
      }
      if (path.length >= 12) continue;
      for (const next of adjacency.get(id) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push([...path, next]);
      }
    }
  }
  return paths;
}

function isUntrustedSource(node: CpgNode): boolean {
  return /\b(?:req|request)\.(?:body|query|params|headers)\b|\bprocess\.argv\b/.test(
    node.code ?? "",
  );
}

function isDangerousSink(node: CpgNode): boolean {
  return /\b(?:eval|exec|execSync|query|raw|writeFile|readFile|deserialize)\s*\(/.test(
    node.code ?? "",
  );
}

function pathConfidence(artifact: CpgScopeArtifact, path: string[]): number {
  const edges = path.slice(1).flatMap((target, index) => {
    const value = artifact.edges.find(
      (item) => item.sourceId === path[index] && item.targetId === target,
    );
    return value ? [value] : [];
  });
  return edges.length ? Math.min(...edges.map((item) => item.confidence)) : 0;
}

function mappingTier(relationship: IntelligenceRelationshipRecord): TestImpactSelection["tier"] {
  if (relationship.type === "keystone.core.COVERS") return "coverage-confirmed";
  if (
    relationship.type === "keystone.core.CALLS" &&
    ["exact", "compiler"].includes(relationship.resolution ?? "")
  )
    return "exact-resolved-call";
  if (["exact", "compiler", "syntactic"].includes(relationship.resolution ?? ""))
    return "exact-reference-import";
  if (relationship.resolution === "framework") return "framework-binding";
  return "naming-candidate";
}

function rank(value: TestImpactSelection["tier"]): number {
  return {
    "coverage-confirmed": 5,
    "exact-resolved-call": 4,
    "exact-reference-import": 3,
    "framework-binding": 2,
    "naming-candidate": 1,
  }[value];
}

function isTest(value?: IntelligenceSymbolRecord): boolean {
  return Boolean(value && /Test|Fixture|Mock/.test(value.type));
}

function staticCategory(code: string): ValidationFinding["category"] {
  if (/architecture|layer|cycle/.test(code)) return "architecture";
  if (/contract|route|api/.test(code)) return "API";
  if (/schema|orm|database/.test(code)) return "data";
  if (/dependency|import/.test(code)) return "dependency";
  return "unresolved";
}
