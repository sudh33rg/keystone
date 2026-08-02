import { describe, expect, it } from "../../../support/testkit";
import { buildRepositoryEvolution } from "@core/intelligence/pipeline/evolution";

describe("buildRepositoryEvolution", () => {
  it("degrades safely outside a git repository while preserving temporal change counts", async () => {
    const result = await buildRepositoryEvolution("/definitely/not/a/repository", {
      action: "graph",
      filesToAnalyze: ["a.ts"],
      rerunGraph: true,
      rerunArchitecture: false,
      reason: "",
      changes: [
        { path: "a.ts", kind: "structural" },
        { path: "old.ts", kind: "deleted" }
      ]
    });
    expect(result.degraded).toBe(true);
    expect(result.changes.structural).toBe(1);
    expect(result.changes.deleted).toBe(1);
    expect(result.coupling).toEqual([]);
  });
});
