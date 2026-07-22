import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ImpactQaPersistence } from "../../../src/core/impactQa/ImpactQaPersistence";

describe("Phase 7 persistence", () => {
  it("restores completed data and recovers an in-flight command as interrupted after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-p7-persist-"));
    const workflowId = crypto.randomUUID();
    const first = new ImpactQaPersistence(root); await first.initialize();
    await first.save({ workflowId, changedEntities: [], capabilities: [], qaPlan: { id: "plan", workflowId, impactAnalysisId: "impact", impactHash: "sha256:impact", changeSetHash: "sha256:change", requiredItems: [], recommendedItems: [], optionalItems: [], coverageGapIds: [], status: "executing", createdAt: new Date().toISOString(), contentHash: "sha256:plan" }, execution: { id: "run", workflowId, qaPlanId: "plan", commandRuns: [], parsedResults: [], status: "running", startedAt: new Date().toISOString() } });
    const restarted = new ImpactQaPersistence(root); await restarted.initialize();
    expect(restarted.get(workflowId)).toMatchObject({ qaPlan: { status: "approved" }, execution: { status: "interrupted" } });
  });
});
