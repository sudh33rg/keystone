export const TASK_STATE_SCHEMA_VERSION = "2.0.0" as const;

export interface RepositoryReference { repositoryName: string; expectedBranch?: string; expectedCommit?: string; remoteUrl?: string; workspaceFingerprint?: string; }

export interface TaskDefinition {
  originalUserRequest: string; normalizedProblemStatement: string; businessGoal: string; technicalGoal: string;
  scope: string[]; nonGoals: string[]; constraints: string[]; assumptions: string[]; acceptanceCriteria: string[];
}
export interface FeatureSpecification {
  approvedBehavior: string[]; functionalRequirements: string[]; nonFunctionalRequirements: string[];
  uiRequirements: string[]; apiRequirements: string[]; dataRequirements: string[]; securityRequirements: string[];
  performanceRequirements: string[]; compatibilityRequirements: string[];
}
export interface PlanItem { id: string; title: string; status: "PENDING" | "ACTIVE" | "COMPLETED" | "BLOCKED" | "DEFERRED"; dependencies: string[]; subtasks: string[]; }
export interface ImplementationPlan { phases: Array<{ id: string; title: string; tasks: PlanItem[] }>; currentPhase?: string; currentTask?: string; completedTasks: string[]; pendingTasks: string[]; blockedTasks: string[]; deferredTasks: string[]; }
export interface ExecutionProgress { progressPercentage: number; completedWorkSummary: string[]; currentActivity?: string; lastCompletedAction?: string; pendingAction?: string; blockers: string[]; openQuestions: string[]; lastUpdateTime: string; }
export interface EngineeringContext { architectureSummary: string; relevantModules: string[]; relevantFiles: string[]; relevantSymbols: string[]; dependencyRelationships: string[]; impactedComponents: string[]; repositoryIntelligenceSnapshotReference?: string; compressedTaskContext: string; importantCodeExcerpts: Array<{ path: string; language?: string; content: string }>; conventionsToFollow: string[]; thingsToAvoid: string[]; knownArchitecturalConstraints: string[]; }
export interface ChangeAwareness { filesExpectedToChange: string[]; filesReportedChanged: string[]; filesAdded: string[]; filesRemoved: string[]; majorImplementationChanges: string[]; knownUnfinishedAreas: string[]; commitReferences?: string[]; }
export interface QualityState { testsPlanned: string[]; testsAdded: string[]; testsReportedPassing: string[]; testsReportedFailing: string[]; testsPending: string[]; coverageSummary?: string; staticAnalysisFindings: string[]; securityFindings: string[]; performanceFindings: string[]; accessibilityFindings: string[]; knownRegressions: string[]; qualityChecksStillRequired: string[]; }
export interface DecisionState { acceptedDecisions: string[]; rejectedAlternatives: string[]; decisionReasons: string[]; assumptions: string[]; unresolvedQuestions: string[]; risks: string[]; reviewerComments: string[]; }
export interface ContinuationState { exactNextRecommendedAction: string; suggestedFirstPrompt: string; expectedFilesToInspect: string[]; expectedTestsToRun: string[]; environmentRequirements: string[]; setupReminders: string[]; restoreWarnings: string[]; manualRepositorySyncReminder: string; definitionOfCompletion: string[]; }
export interface RedactionReport { scannedAt: string; removedCategories: string[]; redactedPaths: string[]; findings: Array<{ category: string; path: string; confidence: "LOW" | "MEDIUM" | "HIGH" }>; safeToShare: boolean; }
import type { SDLCPlan } from "../sdlc/engine";

export interface TaskStatePackage {
  schemaVersion: string; packageId: string; handoffId: string; taskId: string; createdBy: string; createdAt: string; updatedAt: string;
  repositoryReference: RepositoryReference; task: TaskDefinition; specification: FeatureSpecification; plan: ImplementationPlan; sdlcPlan?: SDLCPlan;
  progress: ExecutionProgress; context: EngineeringContext; changes: ChangeAwareness; quality: QualityState;
  decisions: DecisionState; continuation: ContinuationState; redactionReport: RedactionReport; checksum: string;
}

export const MANUAL_SYNC_NOTICE = "Keystone does not synchronize Git repositories. Before restoring this task, confirm that you have manually opened and synchronized the expected repository and branch.";
export const MANUAL_SYNC_CONFIRMATION = "I have manually synchronized the repository and selected the correct branch.";

export class TaskHandoffError extends Error { constructor(message: string, readonly code: string, readonly status = 400) { super(message); this.name = new.target.name; } }
export class TaskStateValidationError extends TaskHandoffError { constructor(message = "The task state package is invalid.") { super(message, "TASK_STATE_VALIDATION", 422); } }
export class TaskStateIntegrityError extends TaskHandoffError { constructor() { super("Task state integrity validation failed.", "TASK_STATE_INTEGRITY", 422); } }
export class SecretDetectedError extends TaskHandoffError { constructor() { super("Sharing was blocked because a high-confidence secret remains. Remove it and scan again.", "SECRET_DETECTED", 422); } }
export class EncryptionError extends TaskHandoffError { constructor() { super("The task state could not be securely processed.", "ENCRYPTION", 500); } }
export class UnsupportedSchemaVersionError extends TaskHandoffError { constructor(version: string) { super(`Task state schema ${version} is not supported by this Keystone client.`, "UNSUPPORTED_SCHEMA_VERSION", 422); } }
