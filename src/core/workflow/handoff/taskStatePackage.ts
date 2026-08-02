import { randomUUID } from "node:crypto";
import {
  TASK_STATE_SCHEMA_VERSION,
  TaskStateIntegrityError,
  TaskStateValidationError,
  UnsupportedSchemaVersionError,
  type TaskStatePackage
} from "./contracts";
import { safeChecksumEqual, scanAndRedact, sha256 } from "./handoffSecurity";

export type TaskStatePackageInput = Omit<
  TaskStatePackage,
  "schemaVersion" | "packageId" | "createdAt" | "updatedAt" | "redactionReport" | "checksum"
> &
  Partial<Pick<TaskStatePackage, "packageId" | "createdAt" | "updatedAt">>;

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
export function packageChecksum(value: Omit<TaskStatePackage, "checksum">): string {
  return sha256(canonicalJson(value));
}

const topLevelKeys = [
  "schemaVersion",
  "packageId",
  "handoffId",
  "taskId",
  "createdBy",
  "createdAt",
  "updatedAt",
  "repositoryReference",
  "task",
  "specification",
  "plan",
  "sdlcPlan",
  "progress",
  "context",
  "changes",
  "quality",
  "decisions",
  "continuation",
  "redactionReport",
  "checksum"
] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const requireStrings = (value: Record<string, unknown>, keys: readonly string[]) => {
  for (const key of keys)
    if (typeof value[key] !== "string")
      throw new TaskStateValidationError(`Task state field ${key} must be a string.`);
};
const requireArrays = (
  value: Record<string, unknown>,
  keys: readonly string[],
  section: string
) => {
  for (const key of keys)
    if (!Array.isArray(value[key]))
      throw new TaskStateValidationError(`Task state field ${section}.${key} must be an array.`);
};
export function validateTaskStatePackage(value: unknown): asserts value is TaskStatePackage {
  if (!isRecord(value)) throw new TaskStateValidationError();
  const unknown = Object.keys(value).filter((key) => !topLevelKeys.includes(key as never));
  if (unknown.length)
    throw new TaskStateValidationError(`Unknown task state field: ${unknown[0]}.`);
  requireStrings(value, [
    "schemaVersion",
    "packageId",
    "handoffId",
    "taskId",
    "createdBy",
    "createdAt",
    "updatedAt",
    "checksum"
  ]);
  for (const section of [
    "repositoryReference",
    "task",
    "specification",
    "plan",
    "progress",
    "context",
    "changes",
    "quality",
    "decisions",
    "continuation",
    "redactionReport"
  ])
    if (!isRecord(value[section]))
      throw new TaskStateValidationError(`Task state section ${section} is required.`);
  const task = value.task as Record<string, unknown>;
  requireStrings(task, [
    "originalUserRequest",
    "normalizedProblemStatement",
    "businessGoal",
    "technicalGoal"
  ]);
  requireArrays(
    task,
    ["scope", "nonGoals", "constraints", "assumptions", "acceptanceCriteria"],
    "task"
  );
  const specification = value.specification as Record<string, unknown>;
  requireArrays(
    specification,
    [
      "approvedBehavior",
      "functionalRequirements",
      "nonFunctionalRequirements",
      "uiRequirements",
      "apiRequirements",
      "dataRequirements",
      "securityRequirements",
      "performanceRequirements",
      "compatibilityRequirements"
    ],
    "specification"
  );
  const plan = value.plan as Record<string, unknown>;
  requireArrays(
    plan,
    ["phases", "completedTasks", "pendingTasks", "blockedTasks", "deferredTasks"],
    "plan"
  );
  if (value.sdlcPlan !== undefined) {
    if (!isRecord(value.sdlcPlan))
      throw new TaskStateValidationError("Task state section sdlcPlan must be an object.");
    const sdlc = value.sdlcPlan as Record<string, unknown>;
    requireStrings(sdlc, [
      "id",
      "intentId",
      "intent",
      "specificationStatus",
      "createdAt",
      "updatedAt"
    ]);
    if (!Array.isArray(sdlc.stories) || sdlc.stories.length !== 16)
      throw new TaskStateValidationError(
        "Task state sdlcPlan must contain the complete 16-story workflow."
      );
    for (const storyValue of sdlc.stories) {
      if (!isRecord(storyValue))
        throw new TaskStateValidationError("Task state SDLC story is invalid.");
      requireStrings(storyValue, [
        "id",
        "intentId",
        "type",
        "title",
        "objective",
        "status",
        "createdAt",
        "updatedAt"
      ]);
      requireArrays(
        storyValue,
        [
          "dependencies",
          "acceptanceCriteria",
          "satisfiedCriteria",
          "evidence",
          "blockers",
          "decisions",
          "validationRuns",
          "findings"
        ],
        "sdlcPlan.story"
      );
    }
  }
  const context = value.context as Record<string, unknown>;
  requireStrings(context, ["architectureSummary", "compressedTaskContext"]);
  requireArrays(
    context,
    [
      "relevantModules",
      "relevantFiles",
      "relevantSymbols",
      "dependencyRelationships",
      "impactedComponents",
      "importantCodeExcerpts",
      "conventionsToFollow",
      "thingsToAvoid",
      "knownArchitecturalConstraints"
    ],
    "context"
  );
  const progress = value.progress as Record<string, unknown>;
  if (
    typeof progress.progressPercentage !== "number" ||
    progress.progressPercentage < 0 ||
    progress.progressPercentage > 100
  )
    throw new TaskStateValidationError("Task progress percentage must be between 0 and 100.");
  requireArrays(progress, ["completedWorkSummary", "blockers", "openQuestions"], "progress");
  const changes = value.changes as Record<string, unknown>;
  requireArrays(
    changes,
    [
      "filesExpectedToChange",
      "filesReportedChanged",
      "filesAdded",
      "filesRemoved",
      "majorImplementationChanges",
      "knownUnfinishedAreas"
    ],
    "changes"
  );
  const quality = value.quality as Record<string, unknown>;
  requireArrays(
    quality,
    [
      "testsPlanned",
      "testsAdded",
      "testsReportedPassing",
      "testsReportedFailing",
      "testsPending",
      "staticAnalysisFindings",
      "securityFindings",
      "performanceFindings",
      "accessibilityFindings",
      "knownRegressions",
      "qualityChecksStillRequired"
    ],
    "quality"
  );
  const decisions = value.decisions as Record<string, unknown>;
  requireArrays(
    decisions,
    [
      "acceptedDecisions",
      "rejectedAlternatives",
      "decisionReasons",
      "assumptions",
      "unresolvedQuestions",
      "risks",
      "reviewerComments"
    ],
    "decisions"
  );
  const continuation = value.continuation as Record<string, unknown>;
  requireStrings(continuation, [
    "exactNextRecommendedAction",
    "suggestedFirstPrompt",
    "manualRepositorySyncReminder"
  ]);
  requireArrays(
    continuation,
    [
      "expectedFilesToInspect",
      "expectedTestsToRun",
      "environmentRequirements",
      "setupReminders",
      "restoreWarnings",
      "definitionOfCompletion"
    ],
    "continuation"
  );
  const redaction = value.redactionReport as Record<string, unknown>;
  if (typeof redaction.safeToShare !== "boolean")
    throw new TaskStateValidationError("Task state redaction report is invalid.");
  requireArrays(redaction, ["removedCategories", "redactedPaths", "findings"], "redactionReport");
  if (typeof (value.repositoryReference as Record<string, unknown>).repositoryName !== "string")
    throw new TaskStateValidationError("Expected repository name is required.");
}

export class TaskStatePackageBuilder {
  build(input: TaskStatePackageInput, now = new Date()): TaskStatePackage {
    if (
      !input.handoffId ||
      !input.taskId ||
      !input.createdBy ||
      !input.repositoryReference?.repositoryName
    )
      throw new TaskStateValidationError(
        "Task state identity and repository guidance are required."
      );
    const timestamp = now.toISOString();
    const initial = {
      ...input,
      schemaVersion: TASK_STATE_SCHEMA_VERSION,
      packageId: input.packageId ?? randomUUID(),
      createdAt: input.createdAt ?? timestamp,
      updatedAt: input.updatedAt ?? timestamp
    };
    const scanned = scanAndRedact(initial);
    const withoutChecksum = { ...scanned.value, redactionReport: scanned.report } as Omit<
      TaskStatePackage,
      "checksum"
    >;
    const size = Buffer.byteLength(canonicalJson(withoutChecksum));
    if (size > 10 * 1024 * 1024)
      throw new TaskStateValidationError(
        "Task state exceeds the 10 MB sharing limit. Remove large excerpts or test output."
      );
    const packageValue = { ...withoutChecksum, checksum: packageChecksum(withoutChecksum) };
    validateTaskStatePackage(packageValue);
    return packageValue;
  }
}

export function verifyTaskStatePackage(value: TaskStatePackage): void {
  validateTaskStatePackage(value);
  if (value.schemaVersion !== TASK_STATE_SCHEMA_VERSION && value.schemaVersion !== "1.0.0")
    throw new UnsupportedSchemaVersionError(value.schemaVersion);
  const { checksum, ...content } = value;
  if (!/^[a-f0-9]{64}$/.test(checksum) || !safeChecksumEqual(checksum, packageChecksum(content)))
    throw new TaskStateIntegrityError();
}

export function migrateTaskStatePackage(value: TaskStatePackage): TaskStatePackage {
  verifyTaskStatePackage(value);
  if (value.schemaVersion === TASK_STATE_SCHEMA_VERSION) return value;
  if (value.schemaVersion === "1.0.0") {
    const { checksum: _checksum, ...content } = value;
    const upgraded = {
      ...content,
      schemaVersion: TASK_STATE_SCHEMA_VERSION,
      updatedAt: new Date().toISOString()
    } as Omit<TaskStatePackage, "checksum">;
    return { ...upgraded, checksum: packageChecksum(upgraded) };
  }
  throw new UnsupportedSchemaVersionError(value.schemaVersion);
}
