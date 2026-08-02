import { describe, expect, it } from "../../../support/testkit";

import { planIncrementalUpdate } from "@core/intelligence/pipeline/incremental";
import type { RepoFile, RepoIntelligence } from "@core/domain/types";

describe("planIncrementalUpdate", () => {
  it("distinguishes unchanged, implementation, structural, added, and deleted files", () => {
    const previous = intelligence([
      file("unchanged.ts", "a", "s1"),
      file("implementation.ts", "a", "s2"),
      file("structural.ts", "a", "s3"),
      file("deleted.ts", "a", "s4")
    ]);
    const current = intelligence([
      file("unchanged.ts", "a", "s1"),
      file("implementation.ts", "b", "s2"),
      file("structural.ts", "b", "s5"),
      file("added.ts", "a", "s6")
    ]);
    const result = planIncrementalUpdate(previous, current);

    expect(result.action).toBe("full");
    expect(result.changes).toEqual([
      { path: "added.ts", kind: "added" },
      { path: "deleted.ts", kind: "deleted" },
      { path: "implementation.ts", kind: "implementation" },
      { path: "structural.ts", kind: "structural" },
      { path: "unchanged.ts", kind: "unchanged" }
    ]);
    expect(result.filesToAnalyze).toEqual(["added.ts", "implementation.ts", "structural.ts"]);
    expect(result.rerunGraph).toBe(true);
  });

  it("skips an identical repository and chooses file-local work for implementation changes", () => {
    const previous = intelligence([file("a.ts", "one", "structure")]);
    expect(
      planIncrementalUpdate(previous, intelligence([file("a.ts", "one", "structure")])).action
    ).toBe("skip");
    expect(
      planIncrementalUpdate(previous, intelligence([file("a.ts", "two", "structure")])).action
    ).toBe("file-local");
  });

  it("uses architecture and full rebuild thresholds", () => {
    const previous = intelligence(
      Array.from({ length: 40 }, (_, index) => file(`${index}.ts`, "old", `old-${index}`))
    );
    const architecture = intelligence(
      Array.from({ length: 40 }, (_, index) =>
        file(
          `${index}.ts`,
          index < 11 ? "new" : "old",
          index < 11 ? `new-${index}` : `old-${index}`
        )
      )
    );
    const full = intelligence(
      Array.from({ length: 40 }, (_, index) => file(`${index}.ts`, "new", `new-${index}`))
    );
    expect(planIncrementalUpdate(previous, architecture).action).toBe("architecture");
    expect(planIncrementalUpdate(previous, full).action).toBe("full");
  });
});

function file(path: string, contentHash: string, structuralHash: string): RepoFile {
  return {
    path,
    contentHash,
    structuralHash,
    language: "typescript",
    sizeBytes: 1,
    lineCount: 1,
    isTest: false,
    isGenerated: false,
    summary: ""
  };
}

function intelligence(files: RepoFile[]): RepoIntelligence {
  return {
    workspaceRoot: "/repo",
    indexedAt: "",
    files,
    symbols: [],
    dependencies: [],
    tests: [],
    apis: [],
    services: [],
    ownershipHints: [],
    frameworkHints: [],
    securitySensitiveAreas: [],
    performanceSensitivePaths: [],
    modernizationCandidates: []
  };
}
