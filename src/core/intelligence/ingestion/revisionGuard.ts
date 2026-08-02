import { promises as fs } from "node:fs";
import path from "node:path";

import { GitReadOnly } from "../../platform/git/gitReadOnly";

export interface RepositoryRevision {
  readonly head: string;
  readonly branch: string;
  readonly capturedAt: string;
}

export interface RevisionMismatch {
  readonly previous?: RepositoryRevision;
  readonly current: RepositoryRevision;
}

/**
 * Records the Git revision that an intelligence run was derived from, in a
 * sidecar file *outside* the OKF boundary (a sibling of `okf/`, never inside
 * it). OKF/CPG schemas and writers are not touched.
 *
 * The guard answers one question: is the cached intelligence still representative
 * of the working tree? After a branch switch or checkout the file contents and
 * hashes may legitimately match a stale baseline, so the revision is the only
 * reliable signal. A missing or differing `head` means the index must be
 * rebuilt from scratch — incremental reuse is unsafe.
 */
export class RevisionGuard {
  private readonly filePath: string;

  constructor(private readonly workspaceRoot: string) {
    this.filePath = path.join(workspaceRoot, ".keystone", "intelligence", "revision.json");
  }

  async read(): Promise<RepositoryRevision | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<RepositoryRevision>;
      if (typeof parsed.head !== "string" || typeof parsed.branch !== "string") return undefined;
      return {
        head: parsed.head,
        branch: parsed.branch,
        capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : ""
      };
    } catch {
      return undefined;
    }
  }

  async write(revision: RepositoryRevision): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(revision, null, 2), "utf8");
  }

  /**
   * Resolve the current revision, or `undefined` when the workspace is not a
   * Git repository (the guard simply stays silent rather than forcing rebuilds
   * on unversioned folders).
   */
  async current(): Promise<RepositoryRevision | undefined> {
    const git = new GitReadOnly(this.workspaceRoot);
    try {
      const head = await git.run("rev-parse", ["HEAD"]);
      if (!head) return undefined;
      const branch = (await git.branch()) || "HEAD";
      return { head, branch, capturedAt: new Date().toISOString() };
    } catch {
      return undefined;
    }
  }

  /**
   * Detect a revision mismatch. Returns the mismatch when a rebuild is required
   * (no prior record, or a different head), otherwise `undefined` (incremental
   * reuse is safe).
   */
  async detectMismatch(): Promise<RevisionMismatch | undefined> {
    const previous = await this.read();
    const current = await this.current();
    if (!current) return undefined; // not versioned — do not force rebuilds
    if (!previous) return { current };
    if (previous.head !== current.head) return { previous, current };
    return undefined;
  }
}
