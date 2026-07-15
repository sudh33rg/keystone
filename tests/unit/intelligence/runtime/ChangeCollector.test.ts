import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangeCollector, type RepositoryChange } from "../../../../src/core/intelligence/runtime/ChangeCollector";

describe("ChangeCollector", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces repeated changes and delete-then-create into one deterministic batch", () => {
    vi.useFakeTimers();
    const batches: RepositoryChange[][] = [];
    const collector = new ChangeCollector((batch) => batches.push(batch.changes), 100);
    const base = { rootUri: "file:///repo", uri: "file:///repo/src/a.ts", relativePath: "src/a.ts", reason: "file" as const };
    collector.add({ ...base, kind: "added" });
    collector.add({ ...base, kind: "deleted" });
    collector.add({ ...base, kind: "added", reason: "active-editor" });
    vi.advanceTimersByTime(100);

    expect(batches).toEqual([[{ ...base, kind: "replaced", reason: "active-editor" }]]);
    collector.dispose();
  });

  it("reduces create/change and change/delete sequences without losing deletion", () => {
    vi.useFakeTimers();
    const batches: RepositoryChange[][] = [];
    const collector = new ChangeCollector((batch) => batches.push(batch.changes), 50);
    const root = "file:///repo";
    collector.add({ kind: "added", rootUri: root, uri: `${root}/src/new.ts`, relativePath: "src/new.ts", reason: "file" });
    collector.add({ kind: "modified", rootUri: root, uri: `${root}/src/new.ts`, relativePath: "src/new.ts", reason: "file" });
    collector.add({ kind: "modified", rootUri: root, uri: `${root}/src/old.ts`, relativePath: "src/old.ts", reason: "file" });
    collector.add({ kind: "deleted", rootUri: root, uri: `${root}/src/old.ts`, relativePath: "src/old.ts", reason: "file" });
    vi.advanceTimersByTime(50);

    expect(batches[0]).toEqual([
      { kind: "added", rootUri: root, uri: `${root}/src/new.ts`, relativePath: "src/new.ts", reason: "file" },
      { kind: "deleted", rootUri: root, uri: `${root}/src/old.ts`, relativePath: "src/old.ts", reason: "file" }
    ]);
    collector.dispose();
  });
});
