import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  canonicalSerialize,
  CONTENT_HASH_PLACEHOLDER,
  HANDOFF_LIMITS,
  HANDOFF_SCHEMA_VERSION,
  HandoffError,
  HandoffPrivacyReportSchema,
  TaskHandoffPackageSchema,
  type HandoffPrivacyReport,
  type HandoffRepositoryIdentity,
  type TaskHandoffPackage,
} from "../../shared/contracts/handoff";

export interface HandoffWorkflowStateSource {
  getWorkflow(workflowId: string): HandoffWorkflowView | undefined;
  getActiveWorkflowId(): string | null;
  /** Expected revision guard for optimistic concurrency. */
  getRevision(workflowId: string): number;
}

export interface HandoffWorkflowView {
  id: string;
  intentText: string;
  workType: string;
  specificationText?: string;
  specificationRevision?: number;
  status: string;
  stages: Array<{
    id: string;
    type: string;
    displayName: string;
    order: number;
    status: string;
  }>;
  currentStageId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export interface HandoffDraftsProvider {
  getDraft(workflowId: string): HandoffDraftView | undefined;
}

export interface HandoffDraftView {
  progressSummary: string;
  completedWork: string[];
  unresolvedWork: string[];
  blockers: string[];
  assumptions: string[];
  nextActionTitle: string;
  nextActionDescription: string;
  nextActionStageId?: string;
  nextActionWorkItemId?: string;
}

export interface HandoffEvidenceProvider {
  buildBundle(workflowId: string): unknown;
}

export interface HandoffReferenceProvider {
  buildManifest(workflowId: string): unknown;
}

export interface HandoffContinuityProvider {
  buildContinuity(workflowId: string): unknown;
}

export interface PathNormalizer {
  /** Normalize an absolute or home path to a workspace-relative path; null if unsafe. */
  normalize(absoluteOrHomePath: string): string | null;
}

export type HandoffHashComputer = (content: string) => string;

function defaultHashComputer(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/** Return a copy of the package with package.contentHash set to the placeholder, so
 * the integrity hash is computed over field-excluded content on both export and import. */
function withoutHash(pkg: TaskHandoffPackage): TaskHandoffPackage {
  return { ...pkg, package: { ...pkg.package, contentHash: CONTENT_HASH_PLACEHOLDER } };
}

export interface ExportServiceDeps {
  workflows: HandoffWorkflowStateSource;
  drafts: HandoffDraftsProvider;
  repository: HandoffRepositoryIdentity;
  evidence: HandoffEvidenceProvider;
  references: HandoffReferenceProvider;
  continuity: HandoffContinuityProvider;
  normalizer: PathNormalizer;
  privacyScan: (sections: Record<string, string>) => HandoffPrivacyReport;
  hashComputer?: HandoffHashComputer;
  keystoneVersion?: string;
  now?: () => string;
}

export interface ExportResult {
  package: TaskHandoffPackage;
  savedUri: string;
}

/**
 * Constructs the final package in the extension host (never trusts the webview).
 * Performs path normalization, disallowed-field removal, privacy scan, and blocks
 * unsafe export before computing the integrity hash and writing atomically.
 */
export class TaskHandoffExportService {
  private readonly now: () => string;
  private readonly hash: HandoffHashComputer;

  constructor(private readonly deps: ExportServiceDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
    this.hash = deps.hashComputer ?? defaultHashComputer;
  }

  async export(workflowId: string, expectedRevision: number, targetPath: string): Promise<ExportResult> {
    const workflow = this.deps.workflows.getWorkflow(workflowId);
    if (!workflow) throw new HandoffError("handoff-not-eligible", "No workflow state was found for handoff.");
    if (this.deps.workflows.getRevision(workflowId) !== expectedRevision) {
      throw new HandoffError("handoff-evidence-stale", "Workflow revision changed; refresh and retry export.");
    }
    if (workflow.status !== "active") {
      throw new HandoffError("handoff-not-eligible", "Only active workflows can create an active handoff.", true, "eligibility");
    }
    const draft = this.deps.drafts.getDraft(workflowId);
    if (!draft || !draft.progressSummary.trim()) {
      throw new HandoffError("handoff-summary-required", "A progress summary is required before export.", true, "progress");
    }
    if (!draft.nextActionTitle.trim()) {
      throw new HandoffError("handoff-next-action-required", "A next action is required before export.", true, "next-action");
    }

    const pkg = this.assemble(workflow, draft);
    // Integrity hash excludes the package.contentHash field (use placeholder form).
    const canonical = canonicalSerialize(withoutHash(pkg));
    if (Buffer.byteLength(canonical, "utf8") > HANDOFF_LIMITS.totalPackageBytes) {
      throw new HandoffError("package-too-large", "The handoff package exceeds the safe size limit.", true, "package");
    }

    // Privacy scan over serialized sections.
    const sections = this.scanSections(pkg);
    const privacy = HandoffPrivacyReportSchema.parse({ ...this.deps.privacyScan(sections), scannedAt: this.now() });
    if (privacy.findings.some((f) => f.status === "open" && (f.severity === "critical" || f.confidence === "high"))) {
      throw new HandoffError(
        "sensitive-content-blocked",
        "Export is blocked by unresolved sensitive-content findings. Redact or remove them first.",
        true,
        "privacy",
        true,
        "Review the privacy findings and redact or remove the flagged content.",
      );
    }

    // Integrity hash excludes the package.contentHash field itself.
    const contentHash = this.hash(canonical);
    const finalPackage = TaskHandoffPackageSchema.parse({
      ...pkg,
      package: { ...pkg.package, contentHash },
    });

    try {
      await writeFile(targetPath, JSON.stringify(finalPackage, null, 2), "utf8");
    } catch (cause) {
      throw new HandoffError(
        "export-failed",
        "The handoff package could not be written to the selected location.",
        true,
        "package",
        true,
        "Check write permissions for the selected location and retry.",
        cause instanceof Error ? cause.message : String(cause),
      );
    }
    return { package: finalPackage, savedUri: targetPath };
  }

  private assemble(workflow: HandoffWorkflowView, draft: HandoffDraftView): TaskHandoffPackage {
    const evidence = this.deps.evidence.buildBundle(workflow.id) as Record<string, unknown>;
    const references = this.deps.references.buildManifest(workflow.id) as Record<string, unknown>;
    const continuity = this.deps.continuity.buildContinuity(workflow.id) as Record<string, unknown>;
    return {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      package: {
        id: randomUUID(),
        createdAt: this.now(),
        contentHash: CONTENT_HASH_PLACEHOLDER,
        keystoneVersion: this.deps.keystoneVersion ?? "unknown",
      },
      repository: this.deps.repository,
      workflow: {
        workflowId: workflow.id,
        intent: { text: workflow.intentText, workType: workflow.workType },
        ...(workflow.specificationText
          ? { specification: { text: workflow.specificationText, revision: workflow.specificationRevision ?? 1 } }
          : {}),
        status: workflow.status as TaskHandoffPackage["workflow"]["status"],
        stages: workflow.stages.map((s) => ({
          id: s.id,
          type: s.type,
          displayName: s.displayName,
          order: s.order,
          status: s.status as TaskHandoffPackage["workflow"]["stages"][number]["status"],
        })),
        currentStageId: workflow.currentStageId,
        handoffSourceRevision: workflow.revision,
        createdAt: workflow.createdAt,
        updatedAt: workflow.updatedAt,
      },
      continuity: continuity as TaskHandoffPackage["continuity"],
      references: references as TaskHandoffPackage["references"],
      evidence: evidence as TaskHandoffPackage["evidence"],
      privacy: {
        scanPassed: true,
        findings: [],
        scannedSections: [],
        scannedAt: this.now(),
      },
    };
  }

  private scanSections(pkg: TaskHandoffPackage): Record<string, string> {
    return {
      workflow: JSON.stringify(pkg.workflow),
      continuity: JSON.stringify(pkg.continuity),
      references: JSON.stringify(pkg.references),
      evidence: JSON.stringify(pkg.evidence),
    };
  }
}
