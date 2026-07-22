import { describe, expect, it } from "vitest";
import { InstructionConflictDetector } from "../../../src/core/development/InstructionConflictDetector";

const source = (id: string, path: string, content: string) => ({ id, workspaceRelativePath: path, content });

describe("InstructionConflictDetector", () => {
  const detector = new InstructionConflictDetector();
  it("returns no conflict for compatible actual instructions", () => {
    expect(detector.detect([source("a", "a.md", "Run tests."), source("b", "b.md", "Report tests run.")])).toEqual([]);
  });
  it("detects inferred test, output, and scope conflicts with actual source evidence", () => {
    const conflicts = detector.detect([
      source("a", ".github/a.md", "You must run tests. Output JSON. Only modify src/*.ts."),
      source("b", ".github/b.md", "Do not run tests. Output Markdown. You must modify documentation files."),
    ]);
    expect(conflicts.map((item) => item.category)).toEqual(expect.arrayContaining(["test-requirement", "output-format", "file-scope"]));
    expect(conflicts.every((item) => item.sourcePaths.every((path) => path !== "mock-source"))).toBe(true);
    expect(conflicts[0]?.confidence).toBe("inferred");
    expect(Array.isArray(conflicts[0]?.evidence)).toBe(true);
    expect(typeof conflicts[0]?.recommendedResolution).toBe("string");
  });
  it("reports unresolved unavailable instructions", () => {
    expect(detector.unresolved([{ id: "missing", workspaceRelativePath: "missing.md", availability: "missing" }])) .toMatchObject([{ state: "unresolved", sourcePaths: ["missing.md"] }]);
  });
});
