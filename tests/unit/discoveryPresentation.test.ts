import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { generateDiscoveryPresentation } from "@core/workflow/sdlc/discoveryPresentation";
import { SDLCEngine } from "@core/workflow/sdlc/engine";

test("Discovery presentation generator writes a PowerPoint briefing", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-discovery-test-"));
  try {
    const plan = new SDLCEngine().createPlan("Enable saved searches");
    const result = await generateDiscoveryPresentation(root, plan);
    const output = await fs.readFile(result.outputPath);

    assert.equal(result.slideCount, 6);
    assert.ok(result.outputPath.endsWith("-discovery.pptx"));
    assert.equal(output.subarray(0, 2).toString("utf8"), "PK");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Discovery presentation requires the Discovery stage", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-discovery-test-"));
  try {
    const plan = new SDLCEngine().createPlan("Enable saved searches", {
      enabledStages: ["planning", "development"]
    });
    await assert.rejects(() => generateDiscoveryPresentation(root, plan), /Discovery is not enabled/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
