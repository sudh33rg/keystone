import { describe, expect, it } from "vitest";
import { ReviewChangeSetService } from "../../../src/core/review/ReviewChangeSetService";
import type { ReviewChangeSetSource } from "../../../src/shared/contracts/prReview";

const workflowId = "00000000-0000-4000-8000-000000000001";

describe("ReviewChangeSetService", () => {
  it("loads current accepted change set", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "abc123",
      currentRevision: "def456",
      committedPaths: ["src/a.ts"],
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: ["src/a.ts"],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const result = service.build({
      workflowId,
      changeSet,
      currentChangeSet: changeSet,
    });
    expect(result.committedPaths).toEqual(["src/a.ts"]);
  });

  it("distinguishes committed/staged/unstaged/untracked when repository state is supplied", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "abc",
      currentRevision: "def",
      committedPaths: ["src/committed.ts"],
      stagedPaths: ["src/staged.ts"],
      unstagedPaths: ["src/unstaged.ts"],
      untrackedPaths: ["src/untracked.ts"],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const current: ReviewChangeSetSource = {
      baseRevision: "abc",
      currentRevision: "def",
      committedPaths: [],
      stagedPaths: ["src/staged.ts"],
      unstagedPaths: ["src/unstaged.ts"],
      untrackedPaths: [],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const result = service.build({ workflowId, changeSet, currentChangeSet: current });
    expect(result.stagedPaths).toEqual(["src/staged.ts"]);
    expect(result.unstagedPaths).toEqual(["src/unstaged.ts"]);
    expect(result.untrackedPaths).toEqual(["src/untracked.ts"]);
    expect(result.committedPaths).toEqual(["src/committed.ts"]);
  });

  it("preserves staged/unstaged split", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "a",
      currentRevision: "b",
      committedPaths: [],
      stagedPaths: ["src/staged.ts"],
      unstagedPaths: ["src/unstaged.ts"],
      untrackedPaths: [],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const result = service.build({ workflowId, changeSet, currentChangeSet: changeSet });
    expect(result.stagedPaths).toEqual(["src/staged.ts"]);
    expect(result.unstagedPaths).toEqual(["src/unstaged.ts"]);
  });

  it("represents added/modified/deleted/renamed paths", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "a",
      currentRevision: "b",
      committedPaths: [],
      stagedPaths: [
        "src/new.ts",
        "src/modified.ts",
        "src/deleted.ts",
        "src/renamed.ts",
      ],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const result = service.build({ workflowId, changeSet, currentChangeSet: changeSet });
    expect(result.stagedPaths).toContain("src/new.ts");
    expect(result.stagedPaths).toContain("src/modified.ts");
    expect(result.stagedPaths).toContain("src/deleted.ts");
    expect(result.stagedPaths).toContain("src/renamed.ts");
  });

  it("marks partial review scope clearly", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "a",
      currentRevision: "b",
      committedPaths: ["src/a.ts"],
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: ["src/a.ts"],
      excludedPaths: ["src/b.ts"],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: true,
      gitWritesPerformed: false,
    };
    const result = service.build({ workflowId, changeSet, currentChangeSet: changeSet });
    expect(result.partial).toBe(true);
    expect(result.excludedPaths).toEqual(["src/b.ts"]);
  });

  it("becomes stale after workspace changes", () => {
    const service = new ReviewChangeSetService();
    const oldChangeSet: ReviewChangeSetSource = {
      baseRevision: "old",
      currentRevision: "old",
      committedPaths: [],
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: false,
    };
    const newChangeSet: ReviewChangeSetSource = {
      ...oldChangeSet,
      currentRevision: "new",
    };
    expect(ReviewChangeSetService.isStale(oldChangeSet, newChangeSet)).toBe(true);
    expect(ReviewChangeSetService.isStale(oldChangeSet, oldChangeSet)).toBe(false);
  });

  it("does not perform Git writes", () => {
    const service = new ReviewChangeSetService();
    const changeSet: ReviewChangeSetSource = {
      baseRevision: "a",
      currentRevision: "b",
      committedPaths: [],
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: [],
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: [],
      documentationPaths: [],
      partial: false,
      gitWritesPerformed: true,
    };
    expect(() =>
      service.build({ workflowId, changeSet, currentChangeSet: changeSet }),
    ).toThrow(/Git writes/i);
  });
});
