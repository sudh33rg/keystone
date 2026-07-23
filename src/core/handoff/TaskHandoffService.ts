import { randomUUID } from "node:crypto";
import {
  HandoffError,
  HANDOFF_SCHEMA_VERSION,
  TaskHandoffSchema,
  type HandoffCompatibilityReport,
  type HandoffPrivacyReport,
  type HandoffRepositoryIdentity,
  type TaskHandoff,
  type TaskHandoffPackage,
} from "../../shared/contracts/handoff";
import { HandoffPersistenceStore } from "../persistence/HandoffPersistenceStore";
import { HandoffPrivacyService } from "./HandoffPrivacyService";
import { RepositoryIdentityService } from "./RepositoryIdentityService";
import { TaskHandoffExportService } from "./TaskHandoffExportService";
import { TaskHandoffImportService, type LocalReferenceState } from "./TaskHandoffImportService";

export interface HandoffDraftInput {
  progressSummary?: string;
  completedWork?: string[];
  unresolvedWork?: string[];
  blockers?: string[];
  assumptions?: string[];
  nextActionTitle?: string;
  nextActionDescription?: string;
  nextActionStageId?: string;
  nextActionWorkItemId?: string;
  senderLabel?: string;
}

export interface HandoffWorkflowProvider {
  getActiveWorkflowId(): string | null;
  getWorkflow(workflowId: string): HandoffWorkflowView | undefined;
  getRevision(workflowId: string): number;
}

export interface HandoffWorkflowView {
  id: string;
  intentText: string;
  workType: string;
  specificationText?: string;
  specificationRevision?: number;
  status: string;
  stages: Array<{ id: string; type: string; displayName: string; order: number; status: string }>;
  currentStageId: string | null;
  currentWorkItemId?: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface HandoffDevelopmentProvider {
  load(workflowId: string): Promise<HandoffDevelopmentView | undefined>;
}

export interface HandoffDevelopmentView {
  objective?: string;
  workItemStatus?: string;
  scopeItems: Array<{ itemId: string; workItemId: string; kind: string; workspaceRelativePath: string; entityId?: string; range?: { startLine: number; endLine: number }; availability: string }>;
  instructionReferences: Array<{ instructionId: string; relativePath: string; contentHash: string }>;
  result?: { summary: string; decisions?: string; assumptions?: string; testsRun?: string; unresolvedIssues?: string; associatedChangedFiles: string[]; noCode?: boolean };
  changedFileAssociations: string[];
  unresolvedIssues: string[];
}

export interface HandoffPrReviewProvider {
  getReview(workflowId: string): { id: string } | undefined;
  getFindings(reviewId: string): Array<{ severity: string; status: string; title: string }>;
  calculateReadiness(workflowId: string): { decision: string; gates: Array<{ name: string; status: string }> };
}

export interface HandoffEvidenceProvider {
  buildBundle(workflowId: string): unknown;
}

export interface HandoffReferenceProvider {
  buildManifest(workflowId: string): unknown;
}

export interface HandoffRepoIdentityProvider {
  build(): HandoffRepositoryIdentity;
}

export interface HandoffLocalReferencesProvider {
  build(): LocalReferenceState;
}

export interface TaskHandoffServiceDeps {
  workflows: HandoffWorkflowProvider;
  development: HandoffDevelopmentProvider;
  prReview?: HandoffPrReviewProvider;
  evidence: HandoffEvidenceProvider;
  references: HandoffReferenceProvider;
  repository: HandoffRepoIdentityProvider;
  localReferences: HandoffLocalReferencesProvider;
  store: HandoffPersistenceStore;
  now?: () => string;
}

/**
 * Orchestrates Task Handoff: eligibility, draft lifecycle, package build/export,
 * import preview/accept/reject, and history. Reads REAL persisted state; never
 * trusts webview-assembled packages. No Git/PR/account operations occur here.
 */
export class TaskHandoffService {
  private readonly privacy = new HandoffPrivacyService();
  private readonly repoIdentity = new RepositoryIdentityService();
  private readonly now: () => string;

  constructor(private readonly deps: TaskHandoffServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  // --- eligibility ----------------------------------------------------------

  checkEligibility(workflowId: string): { eligible: boolean; reason?: string } {
    const wf = this.deps.workflows.getWorkflow(workflowId);
    if (!wf) return { eligible: false, reason: "No workflow state was found." };
    if (wf.status !== "active") return { eligible: false, reason: "Only active workflows can create a handoff." };
    if (this.deps.store.hasActiveDraft(workflowId)) return { eligible: false, reason: "An active handoff draft already exists for this workflow." };
    return { eligible: true };
  }

  // --- draft lifecycle ------------------------------------------------------

  async createDraft(workflowId: string): Promise<TaskHandoff> {
    const eligibility = this.checkEligibility(workflowId);
    if (!eligibility.eligible) throw new HandoffError("handoff-not-eligible", eligibility.reason ?? "Workflow is not eligible for handoff.", true, "eligibility");
    const wf = this.deps.workflows.getWorkflow(workflowId)!;
    const draft = await this.prefillFromState(wf);
    const now = this.now();
    const handoff: TaskHandoff = TaskHandoffSchema.parse({
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      id: randomUUID(),
      workflowId,
      direction: "outgoing",
      status: "draft",
      progressSummary: draft.progressSummary,
      completedWork: draft.completedWork,
      unresolvedWork: draft.unresolvedWork,
      blockers: draft.blockers,
      assumptions: draft.assumptions,
      nextAction: draft.nextAction,
      createdAt: now,
      updatedAt: now,
    });
    await this.deps.store.update((s) => ({ ...s, handoffs: [...s.handoffs, handoff] }));
    return handoff;
  }

  async updateDraft(workflowId: string, handoffId: string, input: HandoffDraftInput): Promise<TaskHandoff> {
    const existing = this.deps.store.getHandoff(handoffId);
    if (!existing || existing.workflowId !== workflowId) throw new HandoffError("handoff-draft-exists", "No editable handoff draft was found.", true, "draft");
    if (existing.status === "rejected" || existing.status === "superseded") throw new HandoffError("handoff-draft-exists", "This handoff can no longer be edited.", true, "draft");
    const next: TaskHandoff = TaskHandoffSchema.parse({
      ...existing,
      progressSummary: input.progressSummary !== undefined ? input.progressSummary : existing.progressSummary,
      completedWork: input.completedWork !== undefined ? input.completedWork : existing.completedWork,
      unresolvedWork: input.unresolvedWork !== undefined ? input.unresolvedWork : existing.unresolvedWork,
      blockers: input.blockers !== undefined ? input.blockers : existing.blockers,
      assumptions: input.assumptions !== undefined ? input.assumptions : existing.assumptions,
      nextAction:
        input.nextActionTitle !== undefined || input.nextActionDescription !== undefined || input.nextActionStageId !== undefined || input.nextActionWorkItemId !== undefined
          ? {
              title: input.nextActionTitle ?? existing.nextAction?.title ?? "",
              description: input.nextActionDescription ?? existing.nextAction?.description ?? "",
              ...(input.nextActionStageId !== undefined ? { stageId: input.nextActionStageId } : existing.nextAction?.stageId ? { stageId: existing.nextAction.stageId } : {}),
              ...(input.nextActionWorkItemId !== undefined ? { workItemId: input.nextActionWorkItemId } : existing.nextAction?.workItemId ? { workItemId: existing.nextAction.workItemId } : {}),
            }
          : existing.nextAction,
      ...(input.senderLabel !== undefined ? { senderLabel: input.senderLabel } : {}),
      status: "draft",
      updatedAt: this.now(),
    });
    await this.deps.store.update((s) => ({ ...s, handoffs: s.handoffs.map((h) => (h.id === handoffId ? next : h)) }));
    return next;
  }

  listHistory(workflowId: string): TaskHandoff[] {
    return this.deps.store.listForWorkflow(workflowId);
  }

  // --- privacy + export -----------------------------------------------------

  runPrivacyScan(handoffId: string): HandoffPrivacyReport {
    const draft = this.deps.store.getHandoff(handoffId);
    if (!draft) throw new HandoffError("handoff-draft-exists", "No handoff draft was found.", true, "draft");
    const wf = this.deps.workflows.getWorkflow(draft.workflowId)!;
    const sections: Record<string, string> = {
      progress: draft.progressSummary,
      nextAction: draft.nextAction?.description ?? "",
      blockers: draft.blockers.join("\n"),
      unresolved: draft.unresolvedWork.join("\n"),
      development: JSON.stringify(this.deps.evidence.buildBundle(wf.id)),
    };
    return this.privacy.scan(sections);
  }

  markRedacted(handoffId: string, findingId: string): HandoffPrivacyReport {
    return this.privacy.markRedacted(this.runPrivacyScan(handoffId), findingId);
  }

  async exportPackage(handoffId: string, expectedRevision: number, targetPath: string): Promise<{ pkg: TaskHandoffPackage; savedUri: string }> {
    const draft = this.deps.store.getHandoff(handoffId);
    if (!draft) throw new HandoffError("handoff-draft-exists", "No handoff draft was found.", true, "draft");
    const wf = this.deps.workflows.getWorkflow(draft.workflowId);
    if (!wf) throw new HandoffError("handoff-not-eligible", "Workflow state is missing.", true, "eligibility");
    const continuity = await this.buildContinuity(wf.id);
    const exportService = new TaskHandoffExportService({
      workflows: {
        getWorkflow: (id: string) => (id === wf.id ? wf : undefined),
        getActiveWorkflowId: () => this.deps.workflows.getActiveWorkflowId(),
        getRevision: () => this.deps.workflows.getRevision(wf.id),
      },
      drafts: {
        getDraft: (id: string) =>
          id === wf.id
            ? {
                progressSummary: draft.progressSummary,
                completedWork: draft.completedWork,
                unresolvedWork: draft.unresolvedWork,
                blockers: draft.blockers,
                assumptions: draft.assumptions,
                nextActionTitle: draft.nextAction?.title ?? "",
                nextActionDescription: draft.nextAction?.description ?? "",
                nextActionStageId: draft.nextAction?.stageId,
                nextActionWorkItemId: draft.nextAction?.workItemId,
              }
            : undefined,
      },
      repository: this.deps.repository.build(),
      evidence: { buildBundle: () => this.deps.evidence.buildBundle(wf.id) },
      references: { buildManifest: () => this.deps.references.buildManifest(wf.id) },
      continuity: { buildContinuity: () => continuity },
      normalizer: { normalize: (p: string) => this.normalizePath(p) },
      privacyScan: () => this.privacy.scan(this.scanSectionsFor(wf, draft)),
      keystoneVersion: "1.0.0",
    });
    const result = await exportService.export(wf.id, expectedRevision, targetPath);
    const now = this.now();
    await this.deps.store.update((s) => ({
      ...s,
      handoffs: s.handoffs.map((h) => (h.id === handoffId ? { ...h, status: "exported", packageId: result.package.package.id, exportedAt: now, updatedAt: now } : h)),
      exports: [...s.exports, { id: randomUUID(), workflowId: wf.id, handoffId, packageId: result.package.package.id, packagePath: targetPath, packageHash: result.package.package.contentHash, createdAt: now }],
    }));
    return { pkg: result.package, savedUri: result.savedUri };
  }

  // --- import ---------------------------------------------------------------

  previewImport(rawContent: string): { pkg: TaskHandoffPackage; compatibility: HandoffCompatibilityReport; blocking: boolean } {
    const importer = new TaskHandoffImportService({
      localIdentity: this.deps.repository.build(),
      localReferences: this.deps.localReferences.build(),
      repositoryIdentity: this.repoIdentity,
    });
    const preview = importer.preview(rawContent);
    return { pkg: preview.package, compatibility: preview.compatibility, blocking: preview.blocking };
  }

  async acceptImport(rawContent: string, receiverLabel?: string, receiverNotes?: string): Promise<TaskHandoff> {
    const importer = new TaskHandoffImportService({
      localIdentity: this.deps.repository.build(),
      localReferences: this.deps.localReferences.build(),
      repositoryIdentity: this.repoIdentity,
    });
    const pkg = importer.verify(rawContent);
    const handoff = importer.accept(pkg, receiverLabel, receiverNotes);
    const now = this.now();
    await this.deps.store.update((s) => ({
      ...s,
      handoffs: [...s.handoffs, handoff],
      imports: [...s.imports, { id: randomUUID(), workflowId: pkg.workflow.workflowId, handoffId: handoff.id, packageId: pkg.package.id, importedAt: now, accepted: true }],
      acceptances: [...s.acceptances, { id: randomUUID(), workflowId: pkg.workflow.workflowId, handoffId: handoff.id, packageId: pkg.package.id, acceptedAt: now, ...(receiverLabel ? { receiverLabel } : {}), ...(receiverNotes ? { receiverNotes } : {}) }],
    }));
    return handoff;
  }

  rejectImport(rawContent: string): TaskHandoff {
    const importer = new TaskHandoffImportService({
      localIdentity: this.deps.repository.build(),
      localReferences: this.deps.localReferences.build(),
      repositoryIdentity: this.repoIdentity,
    });
    const pkg = importer.verify(rawContent);
    const handoff = importer.reject(pkg);
    return handoff;
  }

  // --- helpers --------------------------------------------------------------

  private async prefillFromState(wf: HandoffWorkflowView) {
    const dev = await this.deps.development.load(wf.id).catch(() => undefined);
    const completedStages = wf.stages.filter((s) => s.status === "completed").map((s) => s.displayName);
    const current = wf.stages.find((s) => s.id === wf.currentStageId);
    const progressSummary =
      `Current stage: ${current?.displayName ?? "unknown"}. ` +
      `Completed stages: ${completedStages.length} of ${wf.stages.length}.`;
    const blockers: string[] = [];
    const unresolved: string[] = [];
    if (dev?.result?.unresolvedIssues) unresolved.push(dev.result.unresolvedIssues);
    const nextAction = current
      ? { title: `Continue ${current.displayName}`, description: `Resume work in the ${current.displayName} stage for this workflow.`, ...(current.id ? { stageId: current.id } : {}) }
      : null;
    return { progressSummary, completedWork: completedStages, unresolvedWork: unresolved, blockers, assumptions: [], nextAction };
  }

  private async buildContinuity(workflowId: string): Promise<unknown> {
    const dev = await this.deps.development.load(workflowId).catch(() => undefined);
    if (!dev) return { sourceScope: [], instructionReferences: [], unresolvedIssues: [], changedFileAssociations: [] };
    return {
      objective: dev.objective,
      workItemStatus: dev.workItemStatus,
      sourceScope: dev.scopeItems.map((s) => ({
        itemId: s.itemId,
        workItemId: s.workItemId,
        kind: s.kind,
        workspaceRelativePath: s.workspaceRelativePath,
        ...(s.entityId ? { entityId: s.entityId } : {}),
        ...(s.range ? { range: s.range } : {}),
        availabilityExported: s.availability,
      })),
      instructionReferences: dev.instructionReferences,
      changedFileAssociations: dev.changedFileAssociations,
      unresolvedIssues: dev.unresolvedIssues,
      ...(dev.result
        ? { developmentResult: { summary: dev.result.summary, ...(dev.result.decisions ? { decisions: dev.result.decisions } : {}), ...(dev.result.assumptions ? { assumptions: dev.result.assumptions } : {}), ...(dev.result.testsRun ? { testsRun: dev.result.testsRun } : {}), ...(dev.result.unresolvedIssues ? { unresolvedIssues: dev.result.unresolvedIssues } : {}), associatedChangedFiles: dev.result.associatedChangedFiles, ...(dev.result.noCode ? { noCode: true } : {}) } }
        : {}),
    };
  }

  private scanSectionsFor(wf: HandoffWorkflowView, draft: TaskHandoff): Record<string, string> {
    return {
      progress: draft.progressSummary,
      nextAction: draft.nextAction?.description ?? "",
      blockers: draft.blockers.join("\n"),
      unresolved: draft.unresolvedWork.join("\n"),
      development: JSON.stringify(this.deps.evidence.buildBundle(wf.id)),
    };
  }

  private normalizePath(p: string): string | null {
    if (p.startsWith("/Users/") || p.startsWith("/home/")) return null;
    if (p.startsWith("/") || p.split("/").includes("..")) return null;
    return p;
  }
}
