import { createHash } from "node:crypto";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import {
  ChangedEntitySchema,
  RetryPlanSchema,
  type ChangedEntity,
  type RetryPlan,
  type TaskExecutionSession,
  type ValidationPlan,
  type ValidationRunV2,
} from "../../shared/contracts/execution";
import {
  RepositoryBaselineSchema,
  type RepositoryBaseline,
} from "../../shared/contracts/delegation";
import type {
  IntelligenceFileRecord,
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
} from "../../shared/contracts/intelligence";

export class RepositoryBaselineService {
  constructor(
    private readonly git: GitAdapter,
    private readonly workspace: WorkspaceAdapter,
    private readonly snapshots: IntelligenceSnapshotReader,
  ) {}

  async capture(
    expectedFiles: string[],
    entityFingerprints: Record<string, string>,
    knownValidationOutcomes: RepositoryBaseline["knownValidationOutcomes"] = [],
  ): Promise<RepositoryBaseline> {
    const root = this.workspace.getRoots()[0];
    const snapshot = this.snapshots.getSnapshot();
    if (!root) {
      return RepositoryBaselineSchema.parse({
        repositoryId: snapshot?.repository.id ?? "unknown",
        intelligenceGeneration: snapshot?.manifest.generation ?? 0,
        branch: snapshot?.repository.branch ?? "unknown",
        headCommit: snapshot?.repository.headCommit ?? "unknown",
        dirtyFiles: [],
        stagedFiles: [],
        untrackedFiles: [],
        expectedFiles,
        fileHashes: hashesFor(snapshot, expectedFiles),
        entityFingerprints,
        diagnosticFingerprints: diagnosticFingerprints(snapshot),
        knownValidationOutcomes,
        capturedAt: new Date().toISOString(),
      });
    }
    const metadata = await this.git.getMetadata(root.uri);
    const [dirty, staged, untracked] = await Promise.all([
      this.git.getChangedFiles(root.uri),
      this.git.getStagedFiles(root.uri),
      this.git.getUntrackedFiles(root.uri),
    ]);
    const relative = (value: string): string =>
      this.workspace.resolveFile(value)?.relativePath ??
      normalize(value, root.uri);
    const dirtyFiles = unique(dirty.map(relative));
    const stagedFiles = unique(staged.map(relative));
    const untrackedFiles = unique(untracked.map(relative));
    const relevant = unique([
      ...expectedFiles,
      ...dirtyFiles,
      ...stagedFiles,
      ...untrackedFiles,
    ]).slice(0, 5000);
    return RepositoryBaselineSchema.parse({
      repositoryId: snapshot?.repository.id ?? "unknown",
      intelligenceGeneration: snapshot?.manifest.generation ?? 0,
      branch: metadata.branch ?? snapshot?.repository.branch ?? "unknown",
      headCommit:
        metadata.headCommit ?? snapshot?.repository.headCommit ?? "unknown",
      dirtyFiles,
      stagedFiles,
      untrackedFiles,
      expectedFiles,
      fileHashes: hashesFor(snapshot, relevant),
      entityFingerprints,
      diagnosticFingerprints: diagnosticFingerprints(snapshot),
      knownValidationOutcomes: knownValidationOutcomes.slice(-200),
      capturedAt: new Date().toISOString(),
    });
  }
}

export class ChangedEntityResolver {
  constructor(private readonly snapshots: IntelligenceSnapshotReader) {}

  async resolve(session: TaskExecutionSession): Promise<ChangedEntity[]> {
    const current = this.snapshots.getSnapshot();
    if (!current) return [];
    const retained = (await this.snapshots.getRetainedSnapshots?.()) ?? [];
    const previous = retained.find(
      (item) =>
        item.manifest.generation ===
        session.repositoryBaseline.intelligenceGeneration,
    );
    const results: ChangedEntity[] = [];
    for (const change of session.observedChanges.slice(0, 5000)) {
      const currentFile = current.files.find(
        (item) => item.relativePath === change.relativePath,
      );
      const previousFile = previous?.files.find(
        (item) =>
          item.relativePath === (change.originalPath ?? change.relativePath),
      );
      results.push(fileChange(change.kind, currentFile, previousFile, change));
      const currentSymbols = symbolsFor(current, currentFile?.id);
      const previousSymbols = symbolsFor(previous, previousFile?.id);
      const currentByKey = new Map(
        currentSymbols.map((item) => [symbolKey(item), item]),
      );
      const previousByKey = new Map(
        previousSymbols.map((item) => [symbolKey(item), item]),
      );
      for (const key of new Set([
        ...currentByKey.keys(),
        ...previousByKey.keys(),
      ])) {
        const after = currentByKey.get(key);
        const before = previousByKey.get(key);
        if (
          before &&
          after &&
          symbolFingerprint(before) === symbolFingerprint(after)
        )
          continue;
        results.push(symbolChange(after, before, change.relativePath));
      }
      if (!previous && !currentSymbols.length && change.kind !== "deleted") {
        results.push(
          ChangedEntitySchema.parse({
            entityId: currentFile?.id ?? `unresolved:${change.relativePath}`,
            entityType: "keystone.core.File",
            qualifiedName: change.relativePath,
            relativePath: change.relativePath,
            changeKind: "unresolved-mapping",
            confidence: 0.25,
            evidenceIds: change.evidenceIds,
            limitations: [
              "No retained baseline generation or supported symbol mapping was available; semantic continuity is not claimed.",
            ],
          }),
        );
      }
    }
    return deduplicate(results).slice(0, 5000);
  }
}

export class RepairContextService {
  build(
    session: TaskExecutionSession,
    run: ValidationRunV2,
    plan?: ValidationPlan,
  ): RetryPlan["repairContext"] {
    const failedSteps = run.stepResults.filter(
      (item) => item.status !== "passed",
    );
    const commands = failedSteps.flatMap((result) => {
      const step = plan?.steps.find((item) => item.id === result.stepId);
      return step?.command
        ? [
            `${step.command.executable} ${step.command.args.join(" ")}\n${result.errorTail || result.outputTail}`,
          ]
        : [];
    });
    return [
      {
        title: "Failed acceptance criteria",
        content:
          run.acceptanceCriteriaResults
            .filter((item) => item.status !== "passed")
            .map((item) => `${item.criterionId}: ${item.explanation}`)
            .join("\n") || "No criterion failure detail.",
        reason: "Only incomplete criteria are included.",
      },
      {
        title: "Validation findings and evidence",
        content:
          run.findings
            .filter((item) => item.retryRelevant)
            .map(
              (item) =>
                `${item.severity} ${item.title}: ${item.description} [evidence ${item.evidenceIds.join(", ")}]`,
            )
            .join("\n") || "No retry-relevant finding.",
        reason: "Successful unrelated findings are excluded.",
      },
      {
        title: "Exact failed commands",
        content: commands.join("\n\n") || "No failed command descriptor.",
        reason: "Only commands from failed or incomplete steps are included.",
      },
      {
        title: "Changed files and entities",
        content: [
          ...session.observedChanges.map(
            (item) => `${item.classification}: ${item.relativePath}`,
          ),
          ...session.changedEntities.map(
            (item) => `${item.changeKind}: ${item.qualifiedName}`,
          ),
        ].join("\n"),
        reason: "Repository changes from this attempt.",
      },
    ].map((item) => ({ ...item, content: item.content.slice(0, 20_000) }));
  }
}

export class RetryPlanningService {
  constructor(private readonly repair = new RepairContextService()) {}

  create(
    session: TaskExecutionSession,
    run: ValidationRunV2,
    mode: RetryPlan["mode"],
    reason: string,
    selectedAgentId?: string,
    plan?: ValidationPlan,
  ): RetryPlan {
    return RetryPlanSchema.parse({
      id: crypto.randomUUID(),
      executionSessionId: session.id,
      attempt: session.retryAttempt + 1,
      mode,
      ...(selectedAgentId ? { selectedAgentId } : {}),
      reason,
      failedCriterionIds: run.acceptanceCriteriaResults
        .filter(
          (item) => item.status !== "passed" && item.status !== "overridden",
        )
        .map((item) => item.criterionId),
      findingIds: run.findings
        .filter((item) => item.retryRelevant)
        .map((item) => item.id),
      repairContext: this.repair.build(session, run, plan),
      createdAt: new Date().toISOString(),
      status: "planned",
    });
  }
}

export class ExecutionDiagnosticsService {
  interrupted(
    status: TaskExecutionSession["status"],
  ): TaskExecutionSession["diagnostics"][number] {
    return {
      code: "interrupted-execution-recovered",
      severity: "warning",
      message: `VS Code restarted while execution was ${status}. Keystone did not fabricate continued execution; explicit review or retry is required.`,
    };
  }
}

export function commandFingerprint(value: {
  executable: string;
  args: string[];
  workingDirectory: string;
}): string {
  return stableHash(
    JSON.stringify([value.executable, value.args, value.workingDirectory]),
  );
}

export function failureFingerprint(output: string, error: string): string {
  return stableHash(`${output.slice(-4000)}\u001f${error.slice(-4000)}`);
}

function hashesFor(
  snapshot: IntelligenceSnapshot | undefined,
  paths: string[],
): Record<string, string> {
  const wanted = new Set(paths);
  return Object.fromEntries(
    (snapshot?.files ?? [])
      .filter((item) => wanted.has(item.relativePath))
      .slice(0, 5000)
      .flatMap((item) => {
        const hash = item.contentHash ?? item.structuralHash;
        return hash ? [[item.relativePath, hash]] : [];
      }),
  );
}

function diagnosticFingerprints(snapshot?: IntelligenceSnapshot): string[] {
  return (snapshot?.diagnostics ?? [])
    .slice(0, 1000)
    .map(intelligenceDiagnosticFingerprint);
}

export function intelligenceDiagnosticFingerprint(value: {
  code: string;
  severity: string;
  relativePath?: string;
  entityId?: string;
  message: string;
}): string {
  return stableHash(
    JSON.stringify([
      value.code,
      value.severity,
      value.relativePath,
      value.entityId,
      value.message,
    ]),
  );
}

function fileChange(
  kind: TaskExecutionSession["observedChanges"][number]["kind"],
  current: IntelligenceFileRecord | undefined,
  previous: IntelligenceFileRecord | undefined,
  evidence: TaskExecutionSession["observedChanges"][number],
): ChangedEntity {
  const file = current ?? previous;
  return ChangedEntitySchema.parse({
    entityId: file?.id ?? `file:${evidence.relativePath}`,
    entityType: fileType(file),
    qualifiedName: file?.relativePath ?? evidence.relativePath,
    relativePath: evidence.relativePath,
    changeKind:
      kind === "added"
        ? "file-added"
        : kind === "deleted"
          ? "file-deleted"
          : kind === "renamed"
            ? "file-renamed"
            : fileSpecificKind(file),
    ...(previous?.contentHash || previous?.structuralHash
      ? { beforeFingerprint: previous.contentHash ?? previous.structuralHash }
      : {}),
    ...(current?.contentHash || current?.structuralHash
      ? { afterFingerprint: current.contentHash ?? current.structuralHash }
      : {}),
    confidence: file ? 1 : 0.5,
    evidenceIds: file?.evidenceIds ?? evidence.evidenceIds,
    limitations: file
      ? []
      : ["The file is not available in the current or retained inventory."],
  });
}

function symbolChange(
  after: IntelligenceSymbolRecord | undefined,
  before: IntelligenceSymbolRecord | undefined,
  relativePath: string,
): ChangedEntity {
  const symbol = after ?? before!;
  return ChangedEntitySchema.parse({
    entityId: symbol.id,
    entityType: symbol.type,
    qualifiedName: symbol.qualifiedName,
    relativePath,
    changeKind: !before
      ? "symbol-added"
      : !after
        ? "symbol-deleted"
        : semanticChangeKind(before, after),
    ...(before ? { beforeFingerprint: symbolFingerprint(before) } : {}),
    ...(after ? { afterFingerprint: symbolFingerprint(after) } : {}),
    confidence: symbol.confidence,
    evidenceIds: symbol.evidenceIds,
    limitations:
      !before || !after
        ? [
            "Rename continuity is not claimed without a retained stable identity match.",
          ]
        : [],
  });
}

function semanticChangeKind(
  before: IntelligenceSymbolRecord,
  after: IntelligenceSymbolRecord,
): ChangedEntity["changeKind"] {
  if (before.signature !== after.signature) return "signature-change";
  if (/Route|Endpoint/.test(after.type)) return "route-change";
  if (/Contract|RequestModel|ResponseModel|GraphQL|OpenAPI/.test(after.type))
    return "contract-change";
  if (/Schema|Table|Column|Migration|Orm|Entity|Model/.test(after.type))
    return "schema-change";
  if (/Configuration|EnvironmentVariable|FeatureFlag/.test(after.type))
    return "configuration-change";
  if (/Test|Fixture|Mock/.test(after.type)) return "test-change";
  if (/Build|Pipeline|Artifact/.test(after.type)) return "build-change";
  if (/Infrastructure|Container|Deployment/.test(after.type))
    return "infrastructure-change";
  if (/Package|ExternalDependency/.test(after.type)) return "dependency-change";
  if (/Module|Layer|Service|PublicAPI|InternalAPI/.test(after.type))
    return "architecture-change";
  return "symbol-modified";
}

function fileSpecificKind(
  file?: IntelligenceFileRecord,
): ChangedEntity["changeKind"] {
  if (!file) return "file-modified";
  if (file.isTest || file.category === "test") return "test-change";
  if (file.category === "schema" || file.category === "migration")
    return "schema-change";
  if (file.category === "configuration") return "configuration-change";
  if (file.category === "manifest" || file.category === "ci")
    return "build-change";
  if (file.category === "infrastructure") return "infrastructure-change";
  return "file-modified";
}

function fileType(file?: IntelligenceFileRecord): string {
  if (!file) return "keystone.core.File";
  if (file.category === "test") return "keystone.core.TestFile";
  if (file.category === "schema") return "keystone.core.SchemaFile";
  if (file.category === "migration") return "keystone.core.MigrationFile";
  if (file.category === "configuration")
    return "keystone.core.ConfigurationFile";
  if (file.category === "infrastructure")
    return "keystone.core.InfrastructureFile";
  return "keystone.core.File";
}

function symbolsFor(
  snapshot: IntelligenceSnapshot | undefined,
  fileId?: string,
): IntelligenceSymbolRecord[] {
  return fileId
    ? (snapshot?.symbols ?? []).filter((item) => item.fileId === fileId)
    : [];
}

function symbolKey(symbol: IntelligenceSymbolRecord): string {
  return `${symbol.type}\u001f${symbol.qualifiedName}`;
}

function symbolFingerprint(symbol: IntelligenceSymbolRecord): string {
  return stableHash(
    JSON.stringify([
      symbol.type,
      symbol.qualifiedName,
      symbol.signature,
      symbol.properties,
      symbol.codeAnalysis?.structuralHash,
    ]),
  );
}

function stableHash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalize(value: string, root: string): string {
  const decoded = decodeURIComponent(value.replace(/^file:\/\//, ""));
  const base = decodeURIComponent(root.replace(/^file:\/\//, "")).replace(
    /\/$/,
    "",
  );
  return decoded.replace(base, "").replace(/^\//, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function deduplicate(values: ChangedEntity[]): ChangedEntity[] {
  const output = new Map<string, ChangedEntity>();
  for (const value of values)
    output.set(`${value.entityId}:${value.changeKind}`, value);
  return [...output.values()].sort(
    (left, right) =>
      left.relativePath.localeCompare(right.relativePath) ||
      left.qualifiedName.localeCompare(right.qualifiedName),
  );
}
