import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DelegationPersistenceStore } from "../../../src/core/persistence/DelegationPersistenceStore";
import { TeamWorkflowPersistenceStore } from "../../../src/core/persistence/TeamWorkflowPersistenceStore";
import { DevelopmentWorkflowService } from "../../../src/core/workflows/DevelopmentWorkflowService";
import { TeamWorkflowService, type SharedArtifactAdapter } from "../../../src/core/team/TeamWorkflowService";
import { HandoffPackageValidator, decodeHandoffArtifact } from "../../../src/core/team/HandoffSecurity";
import { HandoffPackageSchema, type HandoffRepositoryReference } from "../../../src/shared/contracts/team";
import type { IntelligenceQueryService } from "../../../src/core/intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../../../src/core/persistence/IntelligenceStore";
import { intelligenceSnapshot } from "../intelligence/fixtures";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "keystone-team-")); roots.push(root); const snapshot = intelligenceSnapshot(7);
  const workflows = new DevelopmentWorkflowService(new DelegationPersistenceStore(root), { getSnapshot: () => snapshot, isStorageAvailable: () => true, getLoadError: () => undefined } satisfies IntelligenceSnapshotReader, { unified: vi.fn(() => Promise.resolve({ data: { items: [] }, evidence: [] })) } as unknown as IntelligenceQueryService);
  await workflows.initialize(); let workflow = await workflows.capture("Implement portable task handoff", "spec-driven", "Portable handoff"); workflow = await workflows.approve(workflow.id, workflow.specification!.revision); workflow = await workflows.generateTasks(workflow.id);
  const exported = new Map<string, Uint8Array>(); const adapter: SharedArtifactAdapter = { exportJson: (name, content) => { exported.set(name, new TextEncoder().encode(content)); return Promise.resolve(name); }, exportZip: (name, content) => { exported.set(name, content); return Promise.resolve(name); }, exportRepositoryArtifact: (path, content) => { exported.set(path, new TextEncoder().encode(content)); return Promise.resolve(path); }, importArtifact: () => Promise.resolve(undefined), writeClipboard: vi.fn(() => Promise.resolve()) };
  const store = new TeamWorkflowPersistenceStore(root); let current: HandoffRepositoryReference = { repositoryId: workflow.repositoryId, ...(workflow.branch ? { branch: workflow.branch } : {}), ...(workflow.headCommit ? { baseCommit: workflow.headCommit, headCommit: workflow.headCommit } : {}), intelligenceGeneration: workflow.intelligenceGeneration, repositoryFingerprint: "sha256:" + "1".repeat(64), relevantFileFingerprints: {} }; let comparison: "ahead" | "behind" | "diverged" | "missing-commits" | "unknown" = "unknown";
  const service = new TeamWorkflowService(store, workflows, { current: () => current, compare: () => Promise.resolve(comparison) }, () => undefined, adapter); await service.initialize();
  const lead = await service.participants.create({ displayName: "Lead", role: "lead", source: "local", capabilities: ["assign-task", "accept-task", "execute-task", "observe-workflow", "reassign-task"] });
  const sender = await service.participants.create({ displayName: "Sender", role: "developer", source: "local", capabilities: ["accept-task", "execute-task", "observe-workflow"] }, lead.id);
  const receiver = await service.participants.create({ displayName: "Receiver", role: "developer", source: "local", capabilities: ["accept-task", "execute-task", "observe-workflow"] }, lead.id);
  return { root, snapshot, workflows, workflow, task: workflow.tasks[0]!, service, lead, sender, receiver, exported, setCurrent: (value: typeof current) => { current = value; }, setComparison: (value: typeof comparison) => { comparison = value; } };
}

describe("team assignment and handoff continuity", () => {
  it("requires explicit assignment acceptance and preserves one primary owner", async () => {
    const { service, workflow, task, lead, sender } = await fixture();
    const assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id });
    expect(assignment.status).toBe("awaiting-acceptance");
    await expect(service.assignments.decide({ assignmentId: assignment.id, participantId: lead.id }, "accepted")).rejects.toThrow("intended participant");
    const accepted = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted");
    expect(accepted.status).toBe("accepted"); expect(service.ownership.get(task.id)?.primaryAssignmentId).toBe(assignment.id);
    await expect(service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id })).rejects.toThrow("active primary assignment");
  });

  it("requires a matching handoff package before active reassignment", async () => {
    const { service, workflow, task, lead, sender, receiver } = await fixture(); let assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id }); assignment = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted");
    await expect(service.reassignments.reassign({ assignmentId: assignment.id, requestedBy: lead.id, assignedTo: receiver.id, reason: "Continue implementation" })).rejects.toThrow("handoff package");
    const packageData = await service.packages.build({ assignmentId: assignment.id, senderParticipantId: sender.id, receiverParticipantId: receiver.id, completedWork: [], remainingWork: ["Continue"], blockers: [], openQuestions: [] }); const next = await service.reassignments.reassign({ assignmentId: assignment.id, requestedBy: lead.id, assignedTo: receiver.id, reason: "Continue implementation", handoffPackageId: packageData.id });
    expect(next).toMatchObject({ assignedTo: receiver.id, status: "awaiting-acceptance", previousAssignmentId: assignment.id }); expect(service.assignments.get(assignment.id)?.status).toBe("transferred"); expect(service.ownership.get(task.id)?.primaryAssignmentId).toBe(next.id);
  });

  it("marks active ownership stale after repository or Intelligence drift", async () => {
    const { service, workflow, task, lead, sender, setCurrent } = await fixture(); let assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id }); assignment = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted"); setCurrent({ ...assignment.repositoryBaseline, intelligenceGeneration: assignment.intelligenceGeneration + 1, repositoryFingerprint: "sha256:" + "3".repeat(64) }); const stale = await service.reconcileStaleness(workflow.id); expect(stale[0]?.status).toBe("stale"); expect(service.ownership.get(task.id)?.primaryAssignmentId).toBeUndefined(); expect(service.store.snapshot.audit.at(-1)?.action).toBe("assignment-stale");
  });

  it("completes prepare, validate, JSON/ZIP export, import, reconcile, and receiver acceptance", async () => {
    const { service, snapshot, workflow, task, lead, sender, receiver, exported } = await fixture();
    let assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id }); assignment = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted");
    const packageData = await service.packages.build({ assignmentId: assignment.id, senderParticipantId: sender.id, receiverParticipantId: receiver.id, completedWork: ["Mapped the workflow"], remainingWork: ["Finish integration"], blockers: [], openQuestions: [], senderNotes: "Repository content is not embedded." });
    const validation = service.validator.validate(packageData, service.store.snapshot.settings); expect(validation.valid).toBe(true); expect(validation.calculatedFingerprint).toBe(packageData.fingerprint); expect(packageData.metrics.packageBytes).toBeGreaterThan(0); expect(packageData.metrics.packageBytes).toBeLessThanOrEqual(service.store.snapshot.settings.maxPackageBytes); expect(packageData.metrics.generationDurationMs).toBeLessThan(500);
    await service.artifacts.export(packageData, "json"); await service.artifacts.export(packageData, "zip");
    const json = [...exported.entries()].find(([name]) => name.endsWith(".json"))![1]; const zip = [...exported.entries()].find(([name]) => name.endsWith(".zip"))![1]; expect(HandoffPackageSchema.parse(JSON.parse(new TextDecoder().decode(json))).fingerprint).toBe(packageData.fingerprint); expect(new TextDecoder().decode(decodeHandoffArtifact(zip, 1_000_000))).toContain(packageData.id);
    const receiverRoot = await mkdtemp(join(tmpdir(), "keystone-team-receiver-")); roots.push(receiverRoot); const receivingWorkflows = new DevelopmentWorkflowService(new DelegationPersistenceStore(receiverRoot), { getSnapshot: () => snapshot, isStorageAvailable: () => true, getLoadError: () => undefined }, { unified: vi.fn(() => Promise.resolve({ data: { items: [] }, evidence: [] })) } as unknown as IntelligenceQueryService); await receivingWorkflows.initialize(); const receiving = new TeamWorkflowService(new TeamWorkflowPersistenceStore(receiverRoot), receivingWorkflows, { current: () => packageData.repository }, () => undefined, { exportJson: () => Promise.resolve(undefined), exportZip: () => Promise.resolve(undefined), exportRepositoryArtifact: () => Promise.reject(new Error("disabled")), importArtifact: () => Promise.resolve(undefined), writeClipboard: () => Promise.resolve() }); await receiving.initialize();
    const imported = await receiving.imports.importJson(zip, "file", "portable.buildwise-handoff.zip"); expect(imported.record.status).toBe("reviewable"); expect(receiving.participants.get(receiver.id)?.source).toBe("imported");
    const reconciliation = await receiving.reconciliation.reconcile(imported.package); expect(reconciliation).toMatchObject({ compatibility: "exact", safeToAccept: true }); expect(reconciliation.durationMs).toBeLessThan(500);
    const acceptance = await receiving.acceptance.decide({ packageId: packageData.id, importId: imported.record.id, receiverParticipantId: receiver.id, reconciliationId: reconciliation.id, decision: "accepted" });
    expect(acceptance.continuationSessionRequired).toBe(true); expect(receiving.assignments.get(acceptance.assignmentId)).toMatchObject({ assignedTo: receiver.id, status: "accepted" }); expect(receivingWorkflows.get(workflow.id)?.tasks[0]).toMatchObject({ id: task.id, status: "ready", assignedAgentId: undefined }); expect(service.assignments.get(assignment.id)?.status).toBe("handoff-prepared"); await expect(receiving.imports.importJson(zip, "file", "duplicate.zip")).rejects.toThrow("already imported"); expect(receiving.store.snapshot.imports.at(-1)?.status).toBe("failed");
  });

  it("blocks tampering, secret-like content, unsafe ZIPs, and incompatible repositories", async () => {
    const { service, workflow, task, lead, sender, receiver, setCurrent } = await fixture(); let assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id }); assignment = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted"); const packageData = await service.packages.build({ assignmentId: assignment.id, senderParticipantId: sender.id, receiverParticipantId: receiver.id, completedWork: [], remainingWork: ["Continue"], blockers: [], openQuestions: [] });
    const tampered = { ...packageData, senderNotes: "token=abcdefghijk-secret-value" }; const result = new HandoffPackageValidator().validate(tampered, service.store.snapshot.settings); expect(result.valid).toBe(false); expect(result.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining(["secret-credential-assignment", "fingerprint-mismatch"]));
    expect(() => decodeHandoffArtifact(Uint8Array.from([0x50, 0x4b, 0x03]), 1_000_000)).toThrow("truncated");
    setCurrent({ ...packageData.repository, repositoryId: "different-repository", repositoryFingerprint: "sha256:" + "2".repeat(64) }); const reconciliation = await service.reconciliation.reconcile(packageData); expect(reconciliation.safeToAccept).toBe(false); expect(reconciliation.compatibility).toBe("wrong-repository");
    await expect(service.acceptance.decide({ packageId: packageData.id, receiverParticipantId: receiver.id, reconciliationId: reconciliation.id, decision: "accepted" })).rejects.toThrow("not safe");
  });

  it.each(["ahead", "behind", "diverged", "missing-commits"] as const)("reports %s commit compatibility without synchronizing Git", async (classification) => {
    const { service, workflow, task, lead, sender, setCurrent, setComparison } = await fixture(); let assignment = await service.assignments.create({ workflowId: workflow.id, taskId: task.id, assignedBy: lead.id, assignedTo: sender.id }); assignment = await service.assignments.decide({ assignmentId: assignment.id, participantId: sender.id }, "accepted"); const packageData = await service.packages.build({ assignmentId: assignment.id, senderParticipantId: sender.id, completedWork: [], remainingWork: ["Continue"], blockers: [], openQuestions: [] });
    setComparison(classification); setCurrent({ ...packageData.repository, headCommit: "b".repeat(40), repositoryFingerprint: "sha256:" + "2".repeat(64) }); const result = await service.reconciliation.reconcile({ ...packageData, repository: { ...packageData.repository, headCommit: "a".repeat(40) } }); expect(result.compatibility).toBe(classification); expect(result.safeToAccept).toBe(classification === "ahead");
  });

  it("persists state atomically and restores it without credentials", async () => {
    const { root, service } = await fixture(); expect(service.store.snapshot.participants).toHaveLength(3); const raw = await readFile(join(root, "workflow", "team-state.json"), "utf8"); expect(raw).not.toMatch(/password|accessToken|refreshToken/); const restarted = new TeamWorkflowPersistenceStore(root); expect((await restarted.initialize()).participants).toHaveLength(3);
  });
});
