import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { InstructionDiscoveryService } from "../../../src/core/development/InstructionDiscoveryService";

const root = resolve("tests/fixtures/phase4-instructions");

describe("InstructionDiscoveryService", () => {
  it("discovers actual bounded instruction files with real metadata and content", async () => {
    const service = new InstructionDiscoveryService(root);
    const discovered = await service.discover([]);
    expect(discovered.sources.map((item) => item.workspaceRelativePath)).toEqual([".github/copilot-instructions.md", ".github/instructions/output.instructions.md"]);
    expect(discovered.sources[0]).toMatchObject({ availability: "available", sourceType: "copilot" });
    expect(discovered.sources[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(discovered.sources[0]?.sizeBytes).toBeGreaterThan(0);
    const preview = await service.preview(discovered.sources[0]!.workspaceRelativePath);
    expect(preview.content).toContain("Keep changes inside the selected source scope");
  });

  it("deduplicates paths, rejects unsupported formats, and represents missing configured files honestly", async () => {
    const service = new InstructionDiscoveryService(root);
    const discovered = await service.discover([".github/copilot-instructions.md", ".github/copilot-instructions.md", ".github/instructions/unsupported.bin", "missing.md"]);
    expect(discovered.sources.filter((item) => item.workspaceRelativePath === ".github/copilot-instructions.md")).toHaveLength(1);
    expect(discovered.sources.find((item) => item.workspaceRelativePath.endsWith("unsupported.bin"))).toMatchObject({ availability: "unsupported" });
    expect(discovered.sources.find((item) => item.workspaceRelativePath === "missing.md")).toMatchObject({ availability: "missing" });
    expect(discovered.sources.some((item) => item.workspaceRelativePath.includes("node_modules"))).toBe(false);
  });

  it("rejects workspace escapes and binary previews", async () => {
    const service = new InstructionDiscoveryService(root);
    await expect(service.addExisting("../outside.md")).rejects.toMatchObject({ code: "instruction-outside-workspace" });
    await expect(service.preview(".github/instructions/unsupported.bin")).rejects.toMatchObject({ code: "instruction-format-unsupported" });
  });
});
