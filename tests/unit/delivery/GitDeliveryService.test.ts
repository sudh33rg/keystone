import { describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClipboardPullRequestProvider,
  CommitPlanningService,
  GitBranchService,
  GitHubPullRequestProvider,
  GitMutationApprovalService,
  GitMutationService,
  PullRequestCreationService,
  PullRequestProviderRegistry,
  PullRequestValidationService,
  type GitRuntimeAdapter,
} from "../../../src/core/delivery/GitDeliveryService";
import { DeliveryPersistenceStore } from "../../../src/core/persistence/DeliveryPersistenceStore";
import {
  CommitPlanSchema,
  DeliveryChangeSetSchema,
  GitRepositoryStateSchema,
  PullRequestDraftSchema,
  type DeliveryChangeSet,
  type GitRepositoryState,
} from "../../../src/shared/contracts/delivery";
import { HostMessageSchema, WebviewRequestSchema } from "../../../src/shared/contracts/messages";
import { SCHEMA_VERSION } from "../../../src/shared/contracts/domain";

describe("delivery source-control safety", () => {
  it("validates and deterministically suggests branch names", () => {
    const branches = new GitBranchService();
    expect(branches.validate("feature/delivery-workflow")).toEqual([]);
    expect(branches.validate("../unsafe branch")).not.toEqual([]);
    expect(branches.suggest("bug", "Fix PR status race")).toBe("fix/fix-pr-status-race");
  });

  it("creates deterministic bounded commit groups from included files", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const service = new CommitPlanningService(store);
    const plan = await service.create(changeSet(), "conventional");
    expect(plan.commits.map((item) => item.commitType)).toEqual(["migration", "feat", "docs"]);
    expect(plan.commits.every((item) => item.title.length <= 200)).toBe(true);
  });

  it("supports explicit merge, split, move, and reorder operations", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const service = new CommitPlanningService(store);
    const initial = await service.create(changeSet(), "conventional");
    const merged = await service.merge(
      initial,
      initial.commits.slice(0, 2).map((item) => item.id),
    );
    expect(merged.commits).toHaveLength(2);
    const source = merged.commits.find((item) => item.includedFileIds.length > 1)!;
    const split = await service.split(
      merged,
      source.id,
      [source.includedFileIds[0]!],
      "docs: split reviewed file",
    );
    expect(split.commits).toHaveLength(3);
    const moved = await service.moveFile(
      split,
      split.commits[0]!.includedFileIds[0]!,
      split.commits[1]!.id,
    );
    expect(moved.commits.flatMap((item) => item.includedFileIds)).toHaveLength(3);
    const reordered = await service.reorder(
      moved,
      [...moved.commits].reverse().map((item) => item.id),
    );
    expect(reordered.commits.map((item) => item.order)).toEqual(
      reordered.commits.map((_item, index) => index),
    );
  });

  it("requires a one-use approval and verifies exact staged paths", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const adapter = fakeAdapter();
    const approvals = new GitMutationApprovalService(store);
    const mutations = new GitMutationService(adapter, approvals, store);
    const current = changeSet();
    const approval = await approvals.approve({
      action: "stage",
      repositoryId: current.repositoryId,
      branch: current.branch,
      changeSetId: current.id,
      changeSetFingerprint: current.fingerprint,
      paths: ["src/service.ts"],
      message: "sha256:state",
      risks: [],
      safelyRetryable: true,
    });
    const result = await mutations.stage("/repo", approval.id, current);
    expect(result.status).toBe("succeeded");
    expect((await adapter.state("/repo")).stagedFiles).toEqual(["src/service.ts"]);
    await expect(mutations.stage("/repo", approval.id, current)).rejects.toThrow(/approval/i);
  });

  it("fails closed when repository state changed after approval", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const adapter = fakeAdapter({ fingerprint: "sha256:changed" });
    const approvals = new GitMutationApprovalService(store);
    const current = changeSet();
    const approval = await approvals.approve({
      action: "stage",
      repositoryId: current.repositoryId,
      branch: current.branch,
      changeSetId: current.id,
      changeSetFingerprint: current.fingerprint,
      paths: ["src/service.ts"],
      message: "sha256:state",
      risks: [],
      safelyRetryable: true,
    });
    const result = await new GitMutationService(adapter, approvals, store).stage(
      "/repo",
      approval.id,
      current,
    );
    expect(result.status).toBe("failed");
    expect(result.sanitizedOutput).toMatch(/stale/i);
  });

  it("never stages a path outside the reviewed included set", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const adapter = fakeAdapter();
    const approvals = new GitMutationApprovalService(store);
    const current = changeSet();
    const approval = await approvals.approve({
      action: "stage",
      repositoryId: current.repositoryId,
      branch: current.branch,
      changeSetId: current.id,
      changeSetFingerprint: current.fingerprint,
      paths: [".env"],
      message: "sha256:state",
      risks: [],
      safelyRetryable: true,
    });
    await expect(
      new GitMutationService(adapter, approvals, store).stage("/repo", approval.id, current),
    ).rejects.toThrow(/outside the reviewed/i);
  });

  it("blocks a commit when any extra file is staged", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const adapter = fakeAdapter({ stagedFiles: ["src/service.ts", "unexpected.txt"] });
    const approvals = new GitMutationApprovalService(store);
    const current = changeSet();
    const proposal = proposedPlan(current);
    const approval = await approvals.approve({
      action: "commit",
      repositoryId: current.repositoryId,
      branch: current.branch,
      changeSetId: current.id,
      changeSetFingerprint: current.fingerprint,
      commitPlanId: proposal.id,
      proposedCommitId: proposal.commits[0]!.id,
      paths: [],
      message: "feat(core): deliver",
      risks: [],
      safelyRetryable: false,
    });
    const result = await new GitMutationService(adapter, approvals, store).commit(
      "/repo",
      approval.id,
      current,
      proposal,
    );
    expect(result.status).toBe("failed");
    expect(result.sanitizedOutput).toMatch(/exactly match/i);
  });

  it("blocks push while the branch is behind", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const adapter = fakeAdapter({ behind: 1 });
    const approvals = new GitMutationApprovalService(store);
    const approval = await approvals.approve({
      action: "push",
      repositoryId: "repository:test",
      branch: "feature/test",
      paths: [],
      remote: "origin",
      remoteBranch: "feature/test",
      risks: [],
      safelyRetryable: true,
    });
    const result = await new GitMutationService(adapter, approvals, store).push(
      "/repo",
      approval.id,
    );
    expect(result.status).toBe("failed");
  });

  it("reports provider capabilities honestly and fails closed", async () => {
    const github = new GitHubPullRequestProvider({
      detected: () => Promise.resolve(true),
      commands: () => Promise.resolve(["pr.create"]),
    });
    const capability = (
      await new PullRequestProviderRegistry([github]).detect("/repo", repository())
    ).capability;
    expect(capability.integrationMethod).toBe("supported-assisted-command");
    expect(capability.directCreationAvailable).toBe(false);
    expect(capability.authenticated).toBe("unknown");
  });

  it("uses clipboard fallback without claiming authoritative PR creation", async () => {
    let copied = "";
    const provider = new ClipboardPullRequestProvider((value) => {
      copied = value;
      return Promise.resolve();
    });
    const capability = await provider.detect();
    const draft = draftFixture();
    await provider.openAssisted(draft);
    expect(capability.directCreationAvailable).toBe(false);
    expect(capability.integrationMethod).toBe("clipboard");
    expect(copied).toContain(draft.title);
  });

  it("records direct provider failure and consumes approval without deleting the draft", async () => {
    const store = new DeliveryPersistenceStore();
    await store.initialize();
    const draft = draftFixture();
    await store.update((state) => ({ ...state, pullRequestDrafts: [draft] }));
    const approvals = new GitMutationApprovalService(store);
    const approval = await approvals.approve({
      action: "create-pr",
      repositoryId: draft.repository,
      branch: draft.headBranch,
      paths: [],
      message: draft.fingerprint,
      risks: [],
      safelyRetryable: false,
    });
    const provider = {
      detect: () => Promise.reject(new Error("not used")),
      discoverTemplates: () => Promise.resolve([]),
      create: () => Promise.reject(new Error("provider failed")),
    };
    const capability = {
      provider: "github" as const,
      detected: true,
      authenticated: true,
      draftCreationAvailable: true,
      directCreationAvailable: true,
      reviewerSelectionAvailable: false,
      labelSelectionAvailable: false,
      templateDiscoveryAvailable: false,
      resultTrackingAvailable: false,
      diagnostics: [],
    };
    const result = await new PullRequestCreationService(approvals, store).create(
      approval.id,
      draft,
      provider,
      capability,
    );
    expect(result.status).toBe("failed");
    expect(store.snapshot.pullRequestDrafts[0]?.status).toBe("failed");
    expect(store.snapshot.approvals[0]?.consumedAt).toBeTruthy();
  });

  it("restores persisted approvals and consumed results after reload", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-delivery-state-"));
    try {
      const first = new DeliveryPersistenceStore(root);
      await first.initialize();
      const approval = await new GitMutationApprovalService(first).approve({
        action: "push",
        repositoryId: "repository:test",
        branch: "feature/test",
        paths: [],
        remote: "origin",
        remoteBranch: "feature/test",
        risks: [],
        safelyRetryable: true,
      });
      const restored = new DeliveryPersistenceStore(root);
      await restored.initialize();
      expect(restored.snapshot.approvals[0]?.id).toBe(approval.id);
      expect(JSON.stringify(restored.snapshot)).not.toMatch(/credential|secret-token/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("blocks PR creation until the branch is pushed and distinct from base", () => {
    const draft = PullRequestDraftSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId: crypto.randomUUID(),
      changeSetId: crypto.randomUUID(),
      provider: "github",
      repository: "repository:test",
      baseBranch: "main",
      headBranch: "main",
      title: "Delivery",
      body: "Evidence-backed delivery",
      isDraft: true,
      reviewers: [],
      labels: [],
      linkedTasks: [],
      linkedRequirements: [],
      linkedAcceptanceCriteria: [],
      validationSummary: [],
      riskSummary: [],
      reviewGuidance: [],
      status: "draft",
      fingerprint: "sha256:draft",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const result = new PullRequestValidationService().validate(
      draft,
      {
        provider: "github",
        detected: true,
        authenticated: "unknown",
        draftCreationAvailable: true,
        directCreationAvailable: false,
        reviewerSelectionAvailable: false,
        labelSelectionAvailable: false,
        templateDiscoveryAvailable: false,
        resultTrackingAvailable: false,
        diagnostics: [],
      },
      repository({ upstreamBranch: undefined }),
    );
    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([expect.stringMatching(/differ/), expect.stringMatching(/pushed/)]),
    );
  });

  it("requires explicit true confirmation on every mutating Webview contract", () => {
    const base = {
      requestId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
    };
    expect(
      WebviewRequestSchema.safeParse({
        ...base,
        type: "git/push",
        payload: { remote: "origin", branch: "feature/test", confirm: false },
      }).success,
    ).toBe(false);
    expect(
      WebviewRequestSchema.safeParse({
        ...base,
        type: "git/push",
        payload: { remote: "origin", branch: "feature/test", confirm: true },
      }).success,
    ).toBe(true);
    expect(
      WebviewRequestSchema.safeParse({
        ...base,
        type: "pullRequest/create",
        payload: { draftId: crypto.randomUUID(), confirm: false },
      }).success,
    ).toBe(false);
  });

  it("keeps delivery events typed and bounded", () => {
    const event = {
      eventId: crypto.randomUUID(),
      type: "git/actionCompleted",
      timestamp: new Date().toISOString(),
      schemaVersion: SCHEMA_VERSION,
      payload: { action: "commit", resultId: crypto.randomUUID(), message: "Verified" },
    };
    expect(HostMessageSchema.safeParse(event).success).toBe(true);
    expect(
      HostMessageSchema.safeParse({
        ...event,
        payload: { ...event.payload, message: "x".repeat(2001) },
      }).success,
    ).toBe(false);
  });
});

function changeSet(): DeliveryChangeSet {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const files = [
    file("src/service.ts", "expected"),
    file("db/migration.sql", "related"),
    file("docs/delivery.md", "expected"),
  ];
  return DeliveryChangeSetSchema.parse({
    schemaVersion: 1,
    id,
    workflowId: crypto.randomUUID(),
    specificationId: crypto.randomUUID(),
    specificationRevision: 1,
    repositoryId: "repository:test",
    branch: "feature/test",
    baseCommit: "a".repeat(40),
    currentHead: "b".repeat(40),
    repositoryStateFingerprint: "sha256:state",
    intelligenceGeneration: 1,
    files,
    entities: [],
    includedFileIds: files.map((item) => item.id),
    excludedFileIds: [],
    validationRunIds: [],
    findings: [],
    status: "reviewing",
    fingerprint: "sha256:changes",
    createdAt: now,
    updatedAt: now,
  });
}
function file(path: string, attribution: "expected" | "related") {
  return {
    id: `delivery-file:${path}`,
    path,
    status: "modified" as const,
    staged: false,
    attribution,
    relatedTaskIds: [],
    relatedRequirementIds: [],
    relatedAcceptanceCriterionIds: [],
    changedEntityIds: [],
    binary: false,
    generated: false,
    sensitive: false,
    included: true,
    diagnostics: [],
  };
}
function repository(overrides: Partial<GitRepositoryState> = {}): GitRepositoryState {
  return GitRepositoryStateSchema.parse({
    schemaVersion: 1,
    repositoryRoot: "/repo",
    repositoryId: "repository:test",
    branch: "feature/test",
    detachedHead: false,
    headCommit: "b".repeat(40),
    upstreamBranch: "origin/feature/test",
    ahead: 0,
    behind: 0,
    dirty: true,
    stagedFiles: ["src/service.ts"],
    unstagedFiles: [],
    untrackedFiles: [],
    conflictedFiles: [],
    remotes: [
      {
        name: "origin",
        sanitizedUrl: "https://github.com/org/repo.git",
        isDefault: true,
        defaultBranch: "main",
      },
    ],
    defaultRemote: "origin",
    defaultBranch: "main",
    operation: "none",
    worktree: true,
    submodules: false,
    fingerprint: "sha256:state",
    capturedAt: new Date().toISOString(),
    diagnostics: [],
    ...overrides,
  });
}
function fakeAdapter(overrides: Partial<GitRepositoryState> = {}): GitRuntimeAdapter {
  let state = repository(overrides);
  return {
    capabilities: () => Promise.reject(new Error("not used")),
    state: () => Promise.resolve(state),
    changes: () => Promise.resolve([]),
    diff: () => Promise.reject(new Error("not used")),
    stage: (_root: string, paths: string[]) => {
      state = repository({ ...overrides, stagedFiles: paths });
      return Promise.resolve({ output: "staged" });
    },
    unstage: () => Promise.resolve({ output: "unstaged" }),
    createBranch: () => Promise.resolve({ output: "created" }),
    commit: () =>
      Promise.resolve({ hash: "c".repeat(40), files: ["src/service.ts"], output: "committed" }),
    push: () => Promise.resolve({ output: "pushed", verified: true }),
  };
}
function proposedPlan(current: DeliveryChangeSet) {
  const now = new Date().toISOString();
  return CommitPlanSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    changeSetId: current.id,
    convention: "conventional",
    commits: [
      {
        id: crypto.randomUUID(),
        order: 0,
        title: "feat(core): deliver",
        description: "",
        includedFileIds: [current.files[0]!.id],
        relatedTaskIds: [],
        relatedRequirementIds: [],
        relatedAcceptanceCriterionIds: [],
        dependencies: [],
        commitType: "feat",
        breaking: false,
        validationRunIds: [],
        risks: [],
        userNotes: "",
        actualFiles: [],
      },
    ],
    status: "approved",
    fingerprint: "sha256:plan",
    diagnostics: [],
    createdAt: now,
    updatedAt: now,
  });
}
function draftFixture() {
  const now = new Date().toISOString();
  return PullRequestDraftSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    workflowId: crypto.randomUUID(),
    changeSetId: crypto.randomUUID(),
    provider: "github",
    repository: "repository:test",
    baseBranch: "main",
    headBranch: "feature/test",
    title: "Delivery",
    body: "Evidence-backed delivery",
    isDraft: true,
    reviewers: [],
    labels: [],
    linkedTasks: [],
    linkedRequirements: [],
    linkedAcceptanceCriteria: [],
    validationSummary: [],
    riskSummary: [],
    reviewGuidance: [],
    status: "approved",
    fingerprint: "sha256:draft",
    createdAt: now,
    updatedAt: now,
  });
}
