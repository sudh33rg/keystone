import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "../../../support/testkit";
import { CockpitService } from "@core/integration/webview/cockpitService";
import { OkfSnapshotStore } from "@core/intelligence/okf/store";
import { validateOkfSnapshot } from "@core/intelligence/okf/validation";

describe("CockpitService persisted intelligence path", () => {
  it("indexes through the production service, promotes valid OKF, queries relationships, and uses OKF for intent context", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-cockpit-persisted-"));
    await fs.cp(path.resolve("tests/fixtures/extension-workspace"), root, { recursive: true });
    // Regression coverage for prior OKF failures: test/configuration files may contain API-looking
    // constructs but relationship generation must still obey the authoritative profile.
    await fs.writeFile(
      path.join(root, "test", "api.config.test.ts"),
      "import express from 'express';\nconst app=express();\napp.get('/health',()=>true);\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "vite.config.ts"),
      "import { orderTotal } from './src/orders';\nexport default { orderTotal };\n",
      "utf8"
    );
    await fs.mkdir(path.join(root, ".github", "agents"), { recursive: true });
    await fs.mkdir(path.join(root, ".github", "skills", "order-safety"), { recursive: true });
    await fs.mkdir(path.join(root, ".github", "instructions"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".github", "agents", "order-review.agent.md"),
      "# Order Review Agent\nReview order changes against repository evidence.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".github", "skills", "order-safety", "SKILL.md"),
      "# Order safety\n- Preserve calculation behavior\n- Run impacted tests\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".github", "instructions", "orders.instructions.md"),
      "# Order instructions\n- Do not change public order contracts without evidence\n",
      "utf8"
    );
    try {
      const service = new CockpitService(root);
      const state = await service.index(() => undefined);
      expect(state.status).toBe("ready");
      const okf = await new OkfSnapshotStore(root).read();
      expect(okf).toBeDefined();
      expect(validateOkfSnapshot(okf!).valid).toBe(true);
      expect(state.intelligence?.okf?.validated).toBe(true);

      const query = await service.queryIntelligence("What tests cover src/orders.ts?");
      expect(query.intent).toBe("tests");
      expect(query.traversedRelationships).toBeGreaterThan(0);
      expect(query.items.some((item) => item.path === "test/orders.test.ts")).toBe(true);
      expect(query.items.some((item) => item.evidenceIds.length > 0)).toBe(true);

      const task = await service.analyze("Change orderTotal and identify impacted tests.", {
        currentFile: "src/orders.ts"
      });
      expect(task.retrievalMetrics?.mode).toMatch(/^okf-/);
      expect(task.relevantFiles).toContain("src/orders.ts");
      expect(task.analysisEvidence?.gitReview.readOnly).toBe(true);
      expect(task.evidence?.some((item) => item.kind === "test")).toBe(true);
      expect(
        task.copilotCustomizations?.agents.some((agent) => agent.name === "order-review")
      ).toBe(true);
      expect(
        task.copilotCustomizations?.skills.some((skill) => skill.name === "order-safety")
      ).toBe(true);
      expect(
        task.copilotCustomizations?.instructions.some((item) =>
          item.path.endsWith("orders.instructions.md")
        )
      ).toBe(true);
      expect(task.testGeneration?.summary.totalScenarios).toBeGreaterThan(3);
      expect(task.testGeneration?.tests.every((item) => item.status === "draft")).toBe(true);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
