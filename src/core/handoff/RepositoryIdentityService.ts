import { createHash } from "node:crypto";
import {
  HandoffRepositoryIdentitySchema,
  type HandoffRepositoryIdentity,
} from "../../shared/contracts/handoff";

export interface ManifestHashInput {
  relativePath: string;
  contentHash: string;
}

export interface GitIdentityInput {
  remoteUrl?: string;
  branchName?: string;
  revision?: string;
}

export interface RepositoryIdentityInput {
  repositoryName: string;
  manifestHashes: ManifestHashInput[];
  git?: GitIdentityInput;
  /** Logical workspace-root count (bounded). */
  workspaceRootCount: number;
  /** Project configuration markers (e.g. detected tech signals), bounded. */
  configurationMarkers?: string[];
}

export type RepositoryCompatibility =
  | "exact-match"
  | "compatible-revision-difference"
  | "probable-match"
  | "ambiguous"
  | "incompatible"
  | "unverifiable";

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * Build a normalized, credential-free remote identity hash. The remote URL is
 * normalized (scheme + host + path; query/auth stripped) before hashing so no
 * credentials leak. Folder name alone never decides identity.
 */
function remoteIdentityHash(remoteUrl?: string): string | undefined {
  if (!remoteUrl) return undefined;
  try {
    const url = new URL(remoteUrl);
    const normalized = `${url.protocol}//${url.host}${url.pathname}`.replace(/\.git$/, "");
    return sha256(normalized);
  } catch {
    // Fall back to a path/host stripped token without credentials.
    const stripped = remoteUrl
      .replace(/\/\/[^@/]*@/, "//")
      .replace(/[?#].*$/, "")
      .replace(/\.git$/, "");
    return sha256(stripped);
  }
}

export class RepositoryIdentityService {
  /** Deterministic, bounded repository identity that never includes absolute paths. */
  build(input: RepositoryIdentityInput): HandoffRepositoryIdentity {
    const normalizedManifests = [...input.manifestHashes]
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
      .map((m) => ({ relativePath: m.relativePath, contentHash: m.contentHash }));

    const roots = this.deriveRoots(normalizedManifests, input.workspaceRootCount);

    const git = input.git
      ? {
          ...(remoteIdentityHash(input.git.remoteUrl) !== undefined
            ? { remoteIdentityHash: remoteIdentityHash(input.git.remoteUrl) }
            : {}),
          ...(input.git.branchName ? { branchName: input.git.branchName } : {}),
          ...(input.git.revision ? { revision: input.git.revision } : {}),
        }
      : undefined;

    const identityHash = this.hashInput({
      repositoryName: input.repositoryName,
      manifests: normalizedManifests,
      git: input.git ? { remoteUrl: input.git.remoteUrl, revision: input.git.revision } : undefined,
      workspaceRootCount: input.workspaceRootCount,
      configurationMarkers: [...(input.configurationMarkers ?? [])].sort(),
    });

    return HandoffRepositoryIdentitySchema.parse({
      repositoryName: input.repositoryName,
      identityHash,
      roots,
      ...(git ? { git } : {}),
      manifestHashes: normalizedManifests,
    });
  }

  private deriveRoots(manifests: ManifestHashInput[], workspaceRootCount: number) {
    // Bounded: use at most the first 10 manifests as markers, blended with root count.
    const markers = manifests.slice(0, 10).map((m) => ({
      logicalName: m.relativePath,
      relativeMarkerHash: m.contentHash,
    }));
    return markers.length
      ? markers
      : [{ logicalName: `root:${workspaceRootCount}`, relativeMarkerHash: sha256(String(workspaceRootCount)) }];
  }

  private hashInput(value: unknown): string {
    const canonical = JSON.stringify(value, Object.keys(value as object).sort());
    return sha256(canonical);
  }

  /**
   * Compare two repository identities. Never trusts folder name alone. Compatibility
   * states match the spec. Probable/ambiguous matches require explicit user confirmation.
   */
  compare(exported: HandoffRepositoryIdentity, local: HandoffRepositoryIdentity): RepositoryCompatibility {
    const overlap = this.manifestOverlap(exported, local);
    if (exported.identityHash === local.identityHash) {
      const revMatch = this.revisionMatches(exported, local);
      return revMatch ? "exact-match" : "compatible-revision-difference";
    }
    if (this.remoteMatches(exported, local)) return "probable-match";
    if (overlap >= 0.5) return "ambiguous";
    if (overlap === 0) return "incompatible";
    // Partial overlap but Git metadata missing on one side: cannot confirm.
    if (!exported.git?.remoteIdentityHash || !local.git?.remoteIdentityHash) return "unverifiable";
    return "incompatible";
  }

  private revisionMatches(a: HandoffRepositoryIdentity, b: HandoffRepositoryIdentity): boolean {
    return a.git?.revision === b.git?.revision || (!a.git?.revision && !b.git?.revision);
  }

  private remoteMatches(a: HandoffRepositoryIdentity, b: HandoffRepositoryIdentity): boolean {
    return (
      !!a.git?.remoteIdentityHash &&
      !!b.git?.remoteIdentityHash &&
      a.git.remoteIdentityHash === b.git.remoteIdentityHash
    );
  }

  private manifestOverlap(a: HandoffRepositoryIdentity, b: HandoffRepositoryIdentity): number {
    const aSet = new Set(a.manifestHashes.map((m) => m.contentHash));
    if (aSet.size === 0) return 0;
    const overlap = b.manifestHashes.filter((m) => aSet.has(m.contentHash)).length;
    return overlap / aSet.size;
  }

  /** Deterministic identity survives workspace relocation (only bounded evidence matters). */
  relocated(original: HandoffRepositoryIdentity, newName: string): HandoffRepositoryIdentity {
    return { ...original, repositoryName: newName };
  }
}
