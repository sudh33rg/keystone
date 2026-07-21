import { mkdtemp, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ScopeCorrectionMigration } from "../../../src/core/persistence/ScopeCorrectionMigration";

describe("ScopeCorrectionMigration", () => {
  it("archives obsolete development state and preserves unrelated storage", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-scope-correction-"));
    await Promise.all([
      mkdir(join(root, "hub")),
      mkdir(join(root, "local-models")),
      mkdir(join(root, "workflows")),
      mkdir(join(root, "intelligence")),
    ]);
    const result = await new ScopeCorrectionMigration(root).run();
    const entries = await readdir(root);
    expect(result.archived.sort()).toEqual(["hub", "local-models"]);
    expect(entries).toContain("workflows");
    expect(entries).toContain("intelligence");
    expect(entries.some((entry) => entry.startsWith("retired-roadmap-hub-"))).toBe(true);
    expect(entries.some((entry) => entry.startsWith("retired-roadmap-local-models-"))).toBe(true);
  });

  it("does not fail when obsolete state is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-scope-correction-empty-"));
    await expect(new ScopeCorrectionMigration(root).run()).resolves.toEqual({
      archived: [],
      diagnostics: [],
    });
  });
});
