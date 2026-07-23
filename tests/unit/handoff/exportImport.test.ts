import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TaskHandoffExportService } from "../../../src/core/handoff/TaskHandoffExportService";
import { TaskHandoffImportService } from "../../../src/core/handoff/TaskHandoffImportService";
import { RepositoryIdentityService } from "../../../src/core/handoff/RepositoryIdentityService";
import {
  HandoffError,
  HANDOFF_SCHEMA_VERSION,
  type HandoffRepositoryIdentity,
  type TaskHandoffPackage,
} from "../../../src/shared/contracts/handoff";

const identity = new RepositoryIdentityService().build({
  repositoryName: "keystone",
  manifestHashes: [{ relativePath: "package.json", contentHash: "sha256:" + "a".repeat(64) }],
  workspaceRootCount: 1,
});

function makeExportService(workflow: any, draft: any) {
  return new TaskHandoffExportService({
    workflows: {
      getWorkflow: (id: string) => (id === workflow.id ? workflow : undefined),
      getActiveWorkflowId: () => workflow.id,
      getRevision: () => workflow.revision,
    },
    drafts: { getDraft: (id: string) => (id === workflow.id ? draft : undefined) },
    repository: identity,
    evidence: { buildBundle: () => ({ evidenceIncluded: true, findingsAndRemediation: [], contextPackages: [] }) },
    references: { buildManifest: () => ({ files: [], symbols: [], instructions: [], skills: [], intelligenceRevision: "gen-1" }) },
    continuity: { buildContinuity: () => ({ sourceScope: [], instructionReferences: [], unresolvedIssues: [], changedFileAssociations: [] }) },
    normalizer: { normalize: (p: string) => (p.startsWith("/Users/") ? p.replace("/Users/sudheer/", "src/") : p) },
    privacyScan: () => ({ scanPassed: true, findings: [], scannedSections: [], scannedAt: new Date().toISOString() }),
    keystoneVersion: "1.0.0",
  });
}

const activeWorkflow = {
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
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  revision: 3,
};

const goodDraft = {
  progressSummary: "Implemented backoff",
  completedWork: [],
  unresolvedWork: [],
  blockers: [],
  assumptions: [],
  nextActionTitle: "Review failing test",
  nextActionDescription: "Fix auth contract",
  nextActionStageId: "11111111-0000-4000-8000-000000000002",
  nextActionWorkItemId: "22222222-0000-4000-8000-000000000001",
};

describe("TaskHandoffExportService", () => {
  it("exports a valid package with schema version, hash, and creation time", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const target = join(dir, "h.keystone-handoff");
    const result = await makeExportService(activeWorkflow, goodDraft).export(activeWorkflow.id, 3, target);
    expect(result.package.schemaVersion).toBe(HANDOFF_SCHEMA_VERSION);
    expect(result.package.package.contentHash.startsWith("sha256:")).toBe(true);
    expect(result.package.package.createdAt).toBeTruthy();
    const onDisk = JSON.parse(await readFile(target, "utf8"));
    expect(onDisk.package.id).toBe(result.package.package.id);
    await rm(dir, { recursive: true, force: true });
  });

  it("blocks export when the workflow is completed", async () => {
    const completed = { ...activeWorkflow, status: "completed" };
    await expect(makeExportService(completed, goodDraft).export(completed.id, 3, "/tmp/x")).rejects.toMatchObject({ code: "handoff-not-eligible" });
  });

  it("requires a progress summary", async () => {
    const noSummary = { ...goodDraft, progressSummary: "" };
    await expect(makeExportService(activeWorkflow, noSummary).export(activeWorkflow.id, 3, "/tmp/x")).rejects.toMatchObject({ code: "handoff-summary-required" });
  });

  it("requires a next action", async () => {
    const noNext = { ...goodDraft, nextActionTitle: "" };
    await expect(makeExportService(activeWorkflow, noNext).export(activeWorkflow.id, 3, "/tmp/x")).rejects.toMatchObject({ code: "handoff-next-action-required" });
  });

  it("blocks export when a high-confidence secret is present", async () => {
    const malicious = {
      ...makeExportService(activeWorkflow, goodDraft),
    };
    // Inject a privacy scan that reports a critical finding.
    const service = new TaskHandoffExportService({
      workflows: { getWorkflow: (id: string) => (id === activeWorkflow.id ? activeWorkflow : undefined), getActiveWorkflowId: () => activeWorkflow.id, getRevision: () => activeWorkflow.revision },
      drafts: { getDraft: () => goodDraft },
      repository: identity,
      evidence: { buildBundle: () => ({ evidenceIncluded: true, findingsAndRemediation: [{ kind: "note", excerpt: "postgres://admin:pass@db/x" }], contextPackages: [] }) },
      references: { buildManifest: () => ({ files: [], symbols: [], instructions: [], skills: [], intelligenceRevision: "gen-1" }) },
      continuity: { buildContinuity: () => ({ sourceScope: [], instructionReferences: [], unresolvedIssues: [], changedFileAssociations: [] }) },
      normalizer: { normalize: (p: string) => p },
      privacyScan: () => ({
        scanPassed: false,
        findings: [{ id: "11111111-0000-4000-8000-000000000009", category: "connection-string", location: "evidence", severity: "critical", confidence: "high", recommendedAction: "redact", maskedPreview: "post*********", status: "open" }],
        scannedSections: ["evidence"],
        scannedAt: new Date().toISOString(),
      }),
    });
    await expect(service.export(activeWorkflow.id, 3, "/tmp/x")).rejects.toMatchObject({ code: "sensitive-content-blocked" });
  });

  it("does not mutate workflow state on export", async () => {
    const snapshot = JSON.parse(JSON.stringify(activeWorkflow));
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    await makeExportService(activeWorkflow, goodDraft).export(activeWorkflow.id, 3, join(dir, "h.keystone-handoff"));
    expect(activeWorkflow).toEqual(snapshot);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("TaskHandoffImportService", () => {
  it("rejects a tampered package on integrity mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const target = join(dir, "h.keystone-handoff");
    const exported = await makeExportService(activeWorkflow, goodDraft).export(activeWorkflow.id, 3, target);
    const raw = await readFile(target, "utf8");
    const tampered = raw.replace("Add retry with backoff", "Add retry with backoff (hacked)");
    const importer = new TaskHandoffImportService({ localIdentity: identity, localReferences: emptyRefs(), repositoryIdentity: new RepositoryIdentityService() });
    expect(() => importer.verify(tampered)).toThrowError(HandoffError);
    expect(() => importer.verify(tampered)).toThrow(/integrity hash/);
    await rm(dir, { recursive: true, force: true });
    void exported;
  });

  it("rejects an unsupported schema version", () => {
    const bad = { schemaVersion: 999, package: { id: "x", createdAt: new Date().toISOString(), contentHash: "sha256:" + "a".repeat(64), keystoneVersion: "1" }, repository: identity, workflow: {} as any, continuity: {} as any, references: {} as any, evidence: {} as any, privacy: {} as any };
    const importer = new TaskHandoffImportService({ localIdentity: identity, localReferences: emptyRefs(), repositoryIdentity: new RepositoryIdentityService() });
    expect(() => importer.verify(JSON.stringify(bad))).toThrowError(/schema/);
  });

  it("accepts a matching repository and produces a preview before acceptance", async () => {
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const target = join(dir, "h.keystone-handoff");
    await makeExportService(activeWorkflow, goodDraft).export(activeWorkflow.id, 3, target);
    const raw = await readFile(target, "utf8");
    const importer = new TaskHandoffImportService({ localIdentity: identity, localReferences: emptyRefs(), repositoryIdentity: new RepositoryIdentityService() });
    const preview = importer.preview(raw);
    expect(preview.compatibility.repository).toBe("exact-match");
    expect(preview.blocking).toBe(false);
    const accepted = importer.accept(preview.package, "Receiver");
    expect(accepted.status).toBe("accepted");
    expect(accepted.direction).toBe("incoming");
    await rm(dir, { recursive: true, force: true });
  });

  it("does not allow accepting an incompatible repository", async () => {
    const other: HandoffRepositoryIdentity = new RepositoryIdentityService().build({ repositoryName: "other", manifestHashes: [{ relativePath: "Cargo.toml", contentHash: "sha256:" + "f".repeat(64) }], workspaceRootCount: 1 });
    const dir = await mkdtemp(join(tmpdir(), "handoff-"));
    const target = join(dir, "h.keystone-handoff");
    await makeExportService(activeWorkflow, goodDraft).export(activeWorkflow.id, 3, target);
    const raw = await readFile(target, "utf8");
    const importer = new TaskHandoffImportService({ localIdentity: other, localReferences: emptyRefs(), repositoryIdentity: new RepositoryIdentityService() });
    const preview = importer.preview(raw);
    expect(preview.compatibility.repository).toBe("incompatible");
    expect(preview.blocking).toBe(true);
    try {
      await importer.accept(preview.package);
      throw new Error("expected accept to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HandoffError);
      expect((err as HandoffError).code).toBe("import-blocked");
    }
    await rm(dir, { recursive: true, force: true });
  });
});

function emptyRefs() {
  return { fileHashes: new Map(), instructionHashes: new Map(), skillState: new Map(), symbolLocations: new Map() };
}
