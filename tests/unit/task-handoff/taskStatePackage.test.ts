import { describe, expect, it } from "../../support/testkit";
import {
  TaskStatePackageBuilder,
  verifyTaskStatePackage
} from "../../../src/core/workflow/handoff/taskStatePackage";
import {
  decryptHandoffPackage,
  encryptHandoffPackage
} from "../../../src/core/workflow/handoff/handoffSecurity";
import { SDLCEngine } from "../../../src/core/workflow/sdlc/engine";
const sdlcPlan = new SDLCEngine().createPlan("Build handoff");
const input: any = {
  handoffId: "handoff",
  taskId: "task",
  createdBy: "dev",
  repositoryReference: { repositoryName: "Keystone", expectedBranch: "manual-branch" },
  task: {
    originalUserRequest: "Build handoff",
    normalizedProblemStatement: "Share state",
    businessGoal: "Continuity",
    technicalGoal: "Portable metadata",
    scope: [],
    nonGoals: ["Git automation"],
    constraints: [],
    assumptions: [],
    acceptanceCriteria: []
  },
  specification: {
    approvedBehavior: [],
    functionalRequirements: [],
    nonFunctionalRequirements: [],
    uiRequirements: [],
    apiRequirements: [],
    dataRequirements: [],
    securityRequirements: [],
    performanceRequirements: [],
    compatibilityRequirements: []
  },
  sdlcPlan,
  plan: { phases: [], completedTasks: [], pendingTasks: [], blockedTasks: [], deferredTasks: [] },
  progress: {
    progressPercentage: 10,
    completedWorkSummary: [],
    blockers: [],
    openQuestions: [],
    lastUpdateTime: "2026-01-01T00:00:00.000Z"
  },
  context: {
    architectureSummary: "",
    relevantModules: [],
    relevantFiles: [],
    relevantSymbols: [],
    dependencyRelationships: [],
    impactedComponents: [],
    compressedTaskContext: "",
    importantCodeExcerpts: [],
    conventionsToFollow: [],
    thingsToAvoid: [],
    knownArchitecturalConstraints: []
  },
  changes: {
    filesExpectedToChange: [],
    filesReportedChanged: [],
    filesAdded: [],
    filesRemoved: [],
    majorImplementationChanges: [],
    knownUnfinishedAreas: []
  },
  quality: {
    testsPlanned: [],
    testsAdded: [],
    testsReportedPassing: [],
    testsReportedFailing: [],
    testsPending: [],
    staticAnalysisFindings: [],
    securityFindings: [],
    performanceFindings: [],
    accessibilityFindings: [],
    knownRegressions: [],
    qualityChecksStillRequired: []
  },
  decisions: {
    acceptedDecisions: [],
    rejectedAlternatives: [],
    decisionReasons: [],
    assumptions: [],
    unresolvedQuestions: [],
    risks: [],
    reviewerComments: []
  },
  continuation: {
    exactNextRecommendedAction: "Continue",
    suggestedFirstPrompt: "Continue safely",
    expectedFilesToInspect: [],
    expectedTestsToRun: [],
    environmentRequirements: [],
    setupReminders: [],
    restoreWarnings: [],
    manualRepositorySyncReminder: "Manual",
    definitionOfCompletion: []
  }
};
describe("task-state package", () => {
  it("creates a deterministic integrity-protected package", () => {
    const value = new TaskStatePackageBuilder().build(input, new Date("2026-01-01T00:00:00Z"));
    expect(value.schemaVersion).toBe("2.0.0");
    expect(() => verifyTaskStatePackage(value)).not.toThrow();
    expect(() => verifyTaskStatePackage({ ...value, taskId: "tampered" })).toThrow(/integrity/);
  });
  it("rejects malformed and unknown package fields before restoration", () => {
    const value = new TaskStatePackageBuilder().build(input);
    expect(() => verifyTaskStatePackage({ ...value, unexpected: true } as any)).toThrow(
      /Unknown task state field/
    );
    expect(() => verifyTaskStatePackage({ ...value, context: null } as any)).toThrow(
      /context is required/
    );
  });
  it("round-trips an encrypted portable package", async () => {
    const value = new TaskStatePackageBuilder().build(input);
    const encrypted = await encryptHandoffPackage(
      JSON.stringify(value),
      "separate secure passphrase"
    );
    const restored = JSON.parse(
      await decryptHandoffPackage(encrypted, "separate secure passphrase")
    );
    expect(() => verifyTaskStatePackage(restored)).not.toThrow();
    expect(restored.checksum).toBe(value.checksum);
    expect(restored.sdlcPlan).toEqual(sdlcPlan);
  });
});
