import { createHash, randomUUID } from "node:crypto";
import {
  canonicalSerialize,
  HANDOFF_LIMITS,
  HANDOFF_SCHEMA_VERSION,
  HandoffCompatibilityIssueSchema,
  HandoffCompatibilityReportSchema,
  HandoffError,
  HandoffReferenceStatusSchema,
  TaskHandoffPackageSchema,
  type HandoffCompatibilityIssue,
  type HandoffCompatibilityReport,
  type HandoffReferenceStatus,
  type HandoffRepositoryIdentity,
  type TaskHandoff,
  type TaskHandoffPackage,
} from "../../shared/contracts/handoff";
import type { RepositoryIdentityService } from "./RepositoryIdentityService";

export interface LocalReferenceState {
  /** relativePath -> current content hash (sha256:...) if available */
  fileHashes: Map<string, string>;
  /** instructionId -> current content hash */
  instructionHashes: Map<string, string>;
  /** skillId -> { version, contentHash } */
  skillState: Map<string, { version: number; contentHash: string }>;
  /** entityId -> current file path (for symbol resolution) */
  symbolLocations: Map<string, { filePath: string; range?: { startLine: number; endLine: number } }>;
  intelligenceRevision?: string;
}

export interface ImportDeps {
  localIdentity: HandoffRepositoryIdentity;
  localReferences: LocalReferenceState;
  repositoryIdentity: RepositoryIdentityService;
  now?: () => string;
}

export type ImportStage =
  | "selected"
  | "verified"
  | "compatibility-reviewed"
  | "accepted"
  | "rejected";

export interface ImportPreview {
  package: TaskHandoffPackage;
  compatibility: HandoffCompatibilityReport;
  blocking: boolean;
}

function detectHash(content: string): string {
  // Recompute the integrity hash over canonical serialization excluding package.contentHash.
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function withoutHashImport(pkg: TaskHandoffPackage): TaskHandoffPackage {
  return { ...pkg, package: { ...pkg.package, contentHash: "sha256:placeholder" } };
}

export class TaskHandoffImportService {
  private readonly now: () => string;

  constructor(private readonly deps: ImportDeps) {
    this.now = deps.now ?? (() => new Date().toISOString());
  }

  /** Stage 1-3: verify format, schema, integrity hash, scan for unsafe content/paths. */
  verify(rawContent: string): TaskHandoffPackage {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawContent);
    } catch {
      throw new HandoffError("package-format-unsupported", "The handoff package is not valid JSON.", true, "package");
    }
    if (Buffer.byteLength(rawContent, "utf8") > HANDOFF_LIMITS.totalPackageBytes) {
      throw new HandoffError("package-too-large", "The handoff package exceeds the safe size limit.", true, "package");
    }
    const result = TaskHandoffPackageSchema.safeParse(parsed);
    if (!result.success) {
      const msg = result.error.issues
        .map((i: (typeof result.error.issues)[number]) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      throw new HandoffError(
        "package-schema-unsupported",
        `The handoff package does not match the supported schema (v${HANDOFF_SCHEMA_VERSION}).`,
        true,
        "package",
        true,
        "Use a package exported by a compatible Keystone version.",
        msg,
      );
    }
    const pkg = result.data;
    if (pkg.schemaVersion !== HANDOFF_SCHEMA_VERSION) {
      throw new HandoffError("package-schema-unsupported", "Unsupported handoff schema version.", true, "package");
    }
    // Integrity: recompute hash excluding the recorded field (placeholder form).
    const recordedHash = pkg.package.contentHash;
    const canonical = canonicalSerialize(withoutHashImport(pkg));
    const computed = detectHash(canonical);
    if (computed !== recordedHash) {
      throw new HandoffError(
        "package-integrity-failed",
        "The handoff package contents do not match its recorded integrity hash.",
        true,
        "package",
        true,
        "Do not edit or re-save the package. Accept only an unmodified export.",
      );
    }
    this.assertNoUnsafePaths(pkg);
    return pkg;
  }

  /** Stage 4-9: compare repository identity, workflow identity, references. */
  analyzeCompatibility(pkg: TaskHandoffPackage): HandoffCompatibilityReport {
    const repoState = this.deps.repositoryIdentity.compare(pkg.repository, this.deps.localIdentity);
    const blockingIssues: HandoffCompatibilityIssue[] = [];
    const warnings: HandoffCompatibilityIssue[] = [];

    if (repoState === "incompatible") {
      blockingIssues.push(
        issue("repository-incompatible", "repository", "This package comes from an incompatible repository.", true),
      );
    }
    if (repoState === "probable-match" || repoState === "ambiguous") {
      warnings.push(
        issue("repository-requires-confirmation", "repository", "Repository match is not exact; confirm before accepting.", false),
      );
    }

    const files = this.compareFiles(pkg);
    const symbols = this.compareSymbols(pkg);
    const instructions = this.compareInstructions(pkg);
    const skills = this.compareSkills(pkg);

    for (const f of [...files, ...symbols, ...instructions, ...skills]) {
      if (f.state === "outside-workspace") {
        blockingIssues.push(issue("package-path-unsafe", "references", `${f.referenceId} escapes the workspace.`, true));
      }
      if (f.state === "missing" && f.required) {
        blockingIssues.push(issue("file-reference-missing", "references", `Required reference missing: ${f.relativePath ?? f.referenceId}.`, false));
      }
      if (f.state === "changed") {
        warnings.push(issue("reference-changed", "references", `Changed reference: ${f.relativePath ?? f.referenceId}.`, false));
      }
    }

    const intelligence = this.compareIntelligence(pkg);

    const workflowState = this.classifyWorkflow(pkg);

    return HandoffCompatibilityReportSchema.parse({
      repository: repoState,
      workflow: workflowState,
      files,
      symbols,
      instructions,
      skills,
      intelligence,
      blockingIssues,
      warnings,
    });
  }

  preview(rawContent: string): ImportPreview {
    const pkg = this.verify(rawContent);
    const compatibility = this.analyzeCompatibility(pkg);
    const blocking = compatibility.blockingIssues.length > 0;
    return { package: pkg, compatibility, blocking };
  }

  /** Accept must re-validate compatibility and confirm no blocking issue remains. */
  accept(pkg: TaskHandoffPackage, receiverLabel?: string, _receiverNotes?: string): TaskHandoff {
    const compatibility = this.analyzeCompatibility(pkg);
    if (compatibility.blockingIssues.length > 0) {
      throw new HandoffError(
        "import-blocked",
        "Import is blocked by unresolved compatibility issues.",
        true,
        "compatibility",
        true,
        "Resolve the blocking issues before accepting the handoff.",
      );
    }
    if (compatibility.repository === "incompatible") {
      throw new HandoffError("repository-incompatible", "Cannot accept a handoff from an incompatible repository.", true, "compatibility");
    }
    const now = this.now();
    const handoff: TaskHandoff = {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      id: randomUUID(),
      workflowId: pkg.workflow.workflowId,
      direction: "incoming",
      status: "accepted",
      progressSummary: "",
      completedWork: [],
      unresolvedWork: [],
      blockers: [],
      assumptions: [],
      nextAction: null,
      packageId: pkg.package.id,
      receiverLabel,
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      acceptedAt: now,
      integrity: { contentHash: pkg.package.contentHash, verifiedAt: now, status: "verified" },
      compatibility: compatibility.repository,
    };
    return handoff;
  }

  reject(pkg: TaskHandoffPackage, _reason?: string): TaskHandoff {
    const now = this.now();
    return {
      schemaVersion: HANDOFF_SCHEMA_VERSION,
      id: randomUUID(),
      workflowId: pkg.workflow.workflowId,
      direction: "incoming",
      status: "rejected",
      progressSummary: "",
      completedWork: [],
      unresolvedWork: [],
      blockers: [],
      assumptions: [],
      nextAction: null,
      packageId: pkg.package.id,
      createdAt: now,
      updatedAt: now,
      importedAt: now,
      integrity: { contentHash: pkg.package.contentHash, verifiedAt: now, status: "verified" },
      compatibility: this.deps.repositoryIdentity.compare(pkg.repository, this.deps.localIdentity),
    };
  }

  // --- reference comparisons ------------------------------------------------

  private compareFiles(pkg: TaskHandoffPackage): HandoffReferenceStatus[] {
    return pkg.references.files.map((ref) => {
      const current = this.deps.localReferences.fileHashes.get(ref.relativePath);
      const state = !current
        ? ref.availabilityAtExport === "available"
          ? "missing"
          : (ref.availabilityAtExport as HandoffReferenceStatus["state"])
        : current === ref.contentHash
          ? "matching"
          : "changed";
      const outside = ref.relativePath.startsWith("/") || ref.relativePath.split("/").includes("..");
      return HandoffReferenceStatusSchema.parse({
        referenceId: ref.relativePath,
        relativePath: ref.relativePath,
        state: outside ? "outside-workspace" : state,
        exportedHash: ref.contentHash,
        currentHash: current,
        required: ref.required,
      });
    });
  }

  private compareSymbols(pkg: TaskHandoffPackage): HandoffReferenceStatus[] {
    return pkg.references.symbols.map((ref) => {
      const local = this.deps.localReferences.symbolLocations.get(ref.entityId);
      const state = !local ? "unverifiable" : local.filePath === ref.filePath ? "matching" : "renamed-candidate";
      return HandoffReferenceStatusSchema.parse({
        referenceId: ref.entityId,
        entityId: ref.entityId,
        relativePath: ref.filePath,
        state,
        exportedHash: ref.contentHash,
        currentHash: local ? this.deps.localReferences.fileHashes.get(local.filePath) : undefined,
        required: false,
      });
    });
  }

  private compareInstructions(pkg: TaskHandoffPackage): HandoffReferenceStatus[] {
    return pkg.references.instructions.map((ref) => {
      const current = this.deps.localReferences.instructionHashes.get(ref.instructionId);
      const state = !current ? "missing" : current === ref.contentHash ? "matching" : "changed";
      return HandoffReferenceStatusSchema.parse({
        referenceId: ref.instructionId,
        relativePath: ref.relativePath,
        state,
        exportedHash: ref.contentHash,
        currentHash: current,
        required: false,
      });
    });
  }

  private compareSkills(pkg: TaskHandoffPackage): HandoffReferenceStatus[] {
    return pkg.references.skills.map((ref) => {
      const local = this.deps.localReferences.skillState.get(ref.skillId);
      const state = !local
        ? "missing"
        : local.contentHash === ref.contentHash
          ? "matching"
          : "changed";
      return HandoffReferenceStatusSchema.parse({
        referenceId: ref.skillId,
        relativePath: undefined,
        state,
        exportedHash: ref.contentHash,
        currentHash: local?.contentHash,
        required: false,
      });
    });
  }

  private compareIntelligence(pkg: TaskHandoffPackage): HandoffCompatibilityReport["intelligence"] {
    const exported = pkg.references.intelligenceRevision;
    const local = this.deps.localReferences.intelligenceRevision;
    if (!exported || !local) return "missing";
    if (exported === local) return "matching";
    // Without ordering guarantees, treat difference as incompatible rather than guess.
    return "incompatible";
  }

  private classifyWorkflow(pkg: TaskHandoffPackage): HandoffCompatibilityReport["workflow"] {
    // Caller supplies known local workflow ids/hashes; default to "new" for a
    // standalone import. The router layer passes richer local state if available.
    void pkg;
    return "new";
  }

  private assertNoUnsafePaths(pkg: TaskHandoffPackage): void {
    for (const ref of pkg.references.files) {
      if (ref.relativePath.startsWith("/") || ref.relativePath.split("/").includes("..")) {
        throw new HandoffError("package-path-unsafe", "The package contains a path that escapes the workspace.", true, "references");
      }
    }
  }
}

function issue(code: string, section: string, message: string, blocking: boolean): HandoffCompatibilityIssue {
  return HandoffCompatibilityIssueSchema.parse({ code, section, message, blocking });
}
