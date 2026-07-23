import { describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskHandoffService } from "../../../src/core/handoff/TaskHandoffService";
import { HandoffPersistenceStore } from "../../../src/core/persistence/HandoffPersistenceStore";
import { RepositoryIdentityService } from "../../../src/core/handoff/RepositoryIdentityService";
import type { HandoffRepositoryIdentity } from "../../../src/shared/contracts/handoff";

function makeIdentity(over: Partial<HandoffRepositoryIdentity> = {}): HandoffRepositoryIdentity {
  return new RepositoryIdentityService().build({
    repositoryName: "keystone",
    manifestHashes: [{ relativePath: "package.json", contentHash: "sha256:" + "a".repeat(64) }],
    workspaceRootCount: 1,
    ...over,
  });
}

function makeService(dir: string, over: Record<string, unknown> = {}) {
  const store = new HandoffPersistenceStore(dir);
  const identity = makeIdentity();
  const now = () => "2026-07-23T00:00:00.000Z";
  const workflow = {
    id: "00000000-0000-4000-8000-000000000001",
    intentText: "Add retry with backoff",
    workType: "feature",
    specificationText: "Implement resilient client",
    specificationRevision: 1,
    status: "active",
    stages: [
      { id: "11111111-0000-4000-8000-000000000001", type: "development", displayName: "Development", order: 1, status: "completed" },
      { id: "11111111-0000-4000-8000-000000000002", type: "qa", displayName: "QA", order: 2, status: "in-progress" },
    ],
    currentStageId: "11111111-0000-4000-8000-000000000002",
    createdAt: now(),
    updatedAt: now(),
    revision: 3,
  };
  return {
    store,
    service: new TaskHandoffService({
      workflows: {
        getActiveWorkflowId: () => workflow.id,
        getWorkflow: (id: string) => (id === workflow.id ? workflow : undefined),
        getRevision: () => workflow.revision,
      },
      development: { load: async () => undefined },
      evidence: { buildBundle: () => ({ evidenceIncluded: false, findingsAndRemediation: [], contextPackages: [] }) },
      references: { buildManifest: () => ({ files: [], symbols: [], instructions: [], skills: [], intelligenceRevision: "gen-1" }) },
      repository: { build: () => identity },
      localReferences: { build: () => ({ fileHashes: new Map(), instructionHashes: new Map(), skillState: new Map(), symbolLocations: new Map() }) },
      store,
      now,
      ...over,
    }),
    workflow,
  };
}

describe("TaskHandoffService", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "handoff-orch-"));
  });

  it("blocks draft creation for a non-active workflow", async () => {
    const dir2 = await mkdtemp(join(tmpdir(), "handoff-orch-"));
    const built = makeService(dir2);
    const completed = { ...built.workflow, status: "completed" };
    const svc2 = new TaskHandoffService({
      workflows: {
        getActiveWorkflowId: () => null,
        getWorkflow: (id: string) => (id === completed.id ? completed : undefined),
        getRevision: () => completed.revision,
      },
      development: { load: async () => undefined },
      evidence: { buildBundle: () => ({ evidenceIncluded: false, findingsAndRemediation: [], contextPackages: [] }) },
      references: { buildManifest: () => ({ files: [], symbols: [], instructions: [], skills: [], intelligenceRevision: "gen-1" }) },
      repository: { build: () => makeIdentity() },
      localReferences: { build: () => ({ fileHashes: new Map(), instructionHashes: new Map(), skillState: new Map(), symbolLocations: new Map() }) },
      store: built.store,
      now: () => "2026-07-23T00:00:00.000Z",
    });
    await expect(svc2.createDraft(completed.id)).rejects.toMatchObject({ code: "handoff-not-eligible" });
    await rm(dir2, { recursive: true, force: true });
  });

  it("creates a draft, updates it, exports a package, then imports it", async () => {
    const { service, workflow } = makeService(dir);
    const draft = await service.createDraft(workflow.id);
    expect(draft.status).toBe("draft");
    expect(draft.direction).toBe("outgoing");

    const updated = await service.updateDraft(workflow.id, draft.id, {
      progressSummary: "Implemented backoff",
      nextActionTitle: "Review failing test",
      nextActionDescription: "Fix auth contract",
      nextActionStageId: "11111111-0000-4000-8000-000000000002",
    });
    expect(updated.progressSummary).toBe("Implemented backoff");
    expect(updated.nextAction?.title).toBe("Review failing test");

    const target = join(dir, "handoff.keystone-handoff");
    const exported = await service.exportPackage(draft.id, workflow.revision, target);
    expect(exported.pkg.package.contentHash.startsWith("sha256:")).toBe(true);
    expect(exported.savedUri).toBe(target);

    const raw = await readFile(target, "utf8");
    const preview = service.previewImport(raw);
    expect(preview.compatibility.repository).toBe("exact-match");
    expect(preview.blocking).toBe(false);

    const accepted = await service.acceptImport(raw, "other-dev");
    expect(accepted.direction).toBe("incoming");
    expect(accepted.status).toBe("accepted");
    expect(accepted.receiverLabel).toBe("other-dev");

    await rm(dir, { recursive: true, force: true });
  });

  it("cleans up temp dir", async () => {
    await rm(dir, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});
