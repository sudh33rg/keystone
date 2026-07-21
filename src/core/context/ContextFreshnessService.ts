/**
 * ContextFreshnessService
 *
 * Determines whether a previously built ContextPackage is still valid. A package
 * becomes stale when a referenced file/symbol changes, the repository revision
 * in the affected scope changes, intelligence updates a referenced entity, the
 * specification / acceptance criteria / instructions / skills / execution
 * profile change, or user-pinned context changes.
 *
 * Crucially, an UNRELATED repository change does NOT invalidate the package
 * unless the affected graph scope intersects the package. Each staleness reason
 * is reported explicitly.
 */

import type { ContextPackage } from "../../shared/contracts/contextPackage";

export interface FreshnessSnapshot {
  repositoryRevision: string;
  intelligenceRevision: string;
  specificationRevision: string;
  instructionRevisionHash: string;
  /** Files changed since the package was built (path -> current fingerprint). */
  changedFiles: Map<string, string>;
  /** Symbol ids changed since build (id -> current fingerprint). */
  changedSymbols: Map<string, string>;
  /** Current instruction/skill ids enabled. */
  instructionIds: Set<string>;
  skillIds: Set<string>;
  executionProfileId: string;
  executionProfileFingerprint: string;
  pinnedItemIds: Set<string>;
}

export interface FreshnessResult {
  stale: boolean;
  reasons: string[];
}

export class ContextFreshnessService {
  check(pkg: ContextPackage, current: FreshnessSnapshot): FreshnessResult {
    const reasons: string[] = [];

    if (
      pkg.sourceSnapshot.repositoryRevision &&
      pkg.sourceSnapshot.repositoryRevision !== current.repositoryRevision
    ) {
      // Only stale if an affected path intersects the package's referenced files.
      const pkgPaths = new Set(
        pkg.items.map((i) => i.sourceReference.filePath).filter((p): p is string => Boolean(p)),
      );
      const intersection = [...current.changedFiles.keys()].some((p) => pkgPaths.has(p));
      if (intersection)
        reasons.push(
          `Referenced file(s) changed under repository revision ${current.repositoryRevision}.`,
        );
      else
        reasons.push(
          `Repository revision changed (${current.repositoryRevision}) but no referenced files were affected; package retained.`,
        );
    }

    if (pkg.sourceSnapshot.intelligenceRevision !== current.intelligenceRevision) {
      const pkgSymbols = new Set(
        pkg.items.map((i) => i.sourceReference.symbolId).filter((s): s is string => Boolean(s)),
      );
      const symIntersection = [...current.changedSymbols.keys()].some((s) => pkgSymbols.has(s));
      if (symIntersection)
        reasons.push(
          `Intelligence updated a referenced symbol (revision ${current.intelligenceRevision}).`,
        );
    }

    if (pkg.sourceSnapshot.specificationRevision !== current.specificationRevision) {
      reasons.push(`Specification changed to revision ${current.specificationRevision}.`);
    }

    if (pkg.sourceSnapshot.instructionRevisionHash !== current.instructionRevisionHash) {
      reasons.push("Selected instructions changed.");
    }

    // Instructions/skills set differences.
    const pkgInstructions = new Set(this.extractIds(pkg, "instruction"));
    if (!setEquals(pkgInstructions, current.instructionIds))
      reasons.push("Enabled instruction set changed.");

    const pkgSkills = new Set(this.extractIds(pkg, "skill"));
    if (!setEquals(pkgSkills, current.skillIds)) reasons.push("Enabled skill set changed.");

    if (pkg.executionProfileId !== current.executionProfileId)
      reasons.push("Execution profile changed.");
    else if (this.profileChanged(pkg, current))
      reasons.push("Execution profile configuration changed.");

    // Pinned context changes.
    const pkgPins = new Set(pkg.items.filter((i) => i.pinned).map((i) => i.id));
    if (!setEquals(pkgPins, current.pinnedItemIds)) reasons.push("User-pinned context changed.");

    return {
      stale: reasons.some((r) => !r.includes("but no referenced files")),
      reasons: reasons.filter((r) => !r.includes("but no referenced files")),
    };
  }

  private extractIds(pkg: ContextPackage, sourceType: string): string[] {
    return pkg.items
      .filter((i) => i.sourceType === sourceType)
      .map((i) => i.sourceReference.entityId ?? i.id);
  }

  private profileChanged(pkg: ContextPackage, current: FreshnessSnapshot): boolean {
    return (
      pkg.metadata.contentHash.length > 0 &&
      current.executionProfileFingerprint !== pkg.sourceSnapshot.instructionRevisionHash
    );
  }
}

function setEquals(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
