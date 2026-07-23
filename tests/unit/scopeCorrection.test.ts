import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("scope correction", () => {
  it("keeps removed roadmap surfaces out of active runtime, UI, settings, and builds", async () => {
    const files = await Promise.all(
      [
        "package.json",
        "scripts/build-extension.mjs",
        "src/extension/extension.ts",
        "src/extension/webview/WebviewMessageRouter.ts",
        "src/shared/contracts/messages.ts",
        "src/ui/App.tsx",
        "src/ui/services/HostBridge.ts",
      ].map((path) => readFile(path, "utf8")),
    );
    const active = files.join("\n");
    expect(active).not.toMatch(
      /\.\/hub\b|contracts\/hub|core\/hub|extension\/hub|components\/hub|keystone\.hub|"hub\//,
    );
    expect(active).not.toMatch(
      /localModels|localModels\.ts|LocalModel|mlx_lm|Ollama|"model\/|"training\/|"dataset\//i,
    );
  });

  it("removes obsolete legacy intelligence commands from the manifest", async () => {
    const manifest = await readFile("package.json", "utf8");
    for (const sub of [
      "exported-symbols",
      "wildcard-search",
      "module-mapping",
      "circular-dependencies",
      "node-metrics",
      "dead-code",
      "filtered-subgraph",
      "cyclomatic-complexity",
    ]) {
      expect(manifest).not.toContain(`keystone.intelligence.${sub}`);
    }
  });

  it("keeps excluded future ideas out of the active release plan", async () => {
    const { existsSync } = await import("node:fs");
    // Excluded initiatives must not live in a separate roadmap file inside the release plan.
    expect(existsSync("docs/10-future-roadmap.md")).toBe(false);
    // The principal planning document must state the release boundary instead.
    const overview = await readFile("docs/architecture-overview.md", "utf8");
    expect(overview).toContain("Release Boundary");
    expect(overview).toContain("does not include centralized collaboration");
    expect(overview).toContain("automatic Git operations");
    // Excluded capability terms must not reappear as active service/promise references in the overview.
    expect(overview).not.toMatch(/TeamWorkflowService|TeamWorkflowPersistenceStore|TeamRepositoryProvider/i);
  });
});
