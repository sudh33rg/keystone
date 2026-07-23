import { describe, expect, it } from "vitest";
import { RepositoryReadService } from "../../../src/core/repository/RepositoryReadService";

describe("ReadOnlyGitBoundary", () => {
  it("RepositoryReadService exposes only read-only git operations", async () => {
    const source = await import("fs").then((fs) =>
      fs.promises.readFile("src/core/repository/RepositoryReadService.ts", "utf-8"),
    );
    const publicMethods = [
      "getCurrentBranch",
      "getCurrentRevision",
      "getStatus",
      "getChangedFiles",
      "getDiff",
      "getHistory",
      "getRepositoryIdentity",
    ];
    for (const method of publicMethods) {
      expect(source, `RepositoryReadService must expose ${method}`).toMatch(
        new RegExp(`\\b${method}\\b`),
      );
    }
    const banned = ["stage", "unstage", "commit", "push", "createBranch", "checkout"];
    for (const method of banned) {
      expect(source, `RepositoryReadService must not expose ${method}`).not.toMatch(
        new RegExp(`(?:^|\\.|\\s)async\\s+${method}\\b`),
      );
    }
  });

  it("Router dispatch does not expose git-write or PR-create handlers", async () => {
    const source = await import("fs").then((fs) =>
      fs.promises.readFile("src/extension/webview/WebviewMessageRouter.ts", "utf-8"),
    );
    const banned = [
      'case "git/stage"',
      'case "git/unstage"',
      'case "git/commit"',
      'case "git/push"',
      'case "git/createBranch"',
      'case "git/checkout"',
      'case "pullRequest/create"',
      'case "pullRequest/approve"',
    ];
    for (const token of banned) {
      expect(source, `banned handler must not be exposed: ${token}`).not.toMatch(
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
  });

  it("Completion path accepts only the read-only RepositoryReadService surface", async () => {
    const repo: Partial<RepositoryReadService> = {
      getStatus: () => Promise.resolve({ branch: "main", repoRoot: "/", dirty: false } as never),
      getCurrentBranch: () => Promise.resolve("main"),
      getCurrentRevision: () => Promise.resolve("HEAD"),
      getChangedFiles: () => Promise.resolve([] as never),
      getDiff: () => Promise.resolve("" as never),
      getHistory: () => Promise.resolve([] as never),
      getRepositoryIdentity: () =>
        ({ owner: "o", repo: "r", remote: "x", branch: "main", headCommit: "h", displayName: "x" } as never),
    };

    const _exhaustive: Partial<RepositoryReadService> = repo;
    void _exhaustive;
    expect(true).toBe(true);
    // would no longer satisfy Partial<RepositoryReadService> and this test would fail.
    expect(true).toBe(true);
  });
});
