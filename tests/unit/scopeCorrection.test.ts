import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scope correction", () => {
  it("keeps removed roadmap surfaces out of active runtime, UI, settings, and builds", async () => {
    const files = await Promise.all(["package.json", "scripts/build-extension.mjs", "src/extension/extension.ts", "src/extension/webview/WebviewMessageRouter.ts", "src/shared/contracts/messages.ts", "src/ui/App.tsx", "src/ui/services/HostBridge.ts"].map((path) => readFile(path, "utf8")));
    const active = files.join("\n");
    expect(active).not.toMatch(/\.\/hub\b|contracts\/hub|core\/hub|extension\/hub|components\/hub|keystone\.hub|"hub\//);
    expect(active).not.toMatch(/localModels|localModels\.ts|LocalModel|mlx_lm|Ollama|"model\/|"training\/|"dataset\//i);
  });

  it("retains future ideas only in a clearly excluded roadmap", async () => {
    const roadmap = await readFile("docs/10-future-roadmap.md", "utf8");
    expect(roadmap).toContain("Not Part of Current Implementation"); expect(roadmap).toContain("Business Unit Intelligence Hub"); expect(roadmap).toContain("Local Model and LoRA Adaptation"); expect(roadmap).toContain("Neither capability is implemented");
  });
});
