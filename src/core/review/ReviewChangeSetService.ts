import { createHash } from "node:crypto";
import {
  ReviewChangeSetSourceSchema,
  type ReviewChangeSetSource,
} from "../../shared/contracts/prReview";

export interface ReviewChangeSetInput {
  workflowId: string;
  changeSet: ReviewChangeSetSource;
  currentChangeSet: ReviewChangeSetSource;
}

/**
 * Deterministic PR-review change-set assessment (spec §6, §13).
 * - Loads current accepted change set and derives PR-review staged/unstaged split.
 * - Represents added/modified/deleted/renamed.
 * - Requires a reason when files are excluded.
 * - Marks partial scope clearly.
 * - Becomes stale when a newer workspace change-set fingerprint is supplied.
 * - Does not perform Git writes.
 */
export class ReviewChangeSetService {
  build(input: ReviewChangeSetInput): ReviewChangeSetSource {
    const current = input.currentChangeSet;
    const changeSet = ReviewChangeSetSourceSchema.parse(input.changeSet);

    if (changeSet.gitWritesPerformed) {
      throw new Error("ReviewChangeSetService cannot consume a change set that performed Git writes.");
    }

    const currentStaged = new Set(current.stagedPaths);
    const currentUnstaged = new Set(current.unstagedPaths);

    const committedPaths: string[] = [];
    const stagedPaths: string[] = [];
    const unstagedPaths: string[] = [];
    const untrackedPaths: string[] = [];

    for (const path of changeSet.committedPaths) {
      if (currentStaged.has(path)) stagedPaths.push(path);
      else if (currentUnstaged.has(path)) unstagedPaths.push(path);
      else committedPaths.push(path);
    }
    for (const path of changeSet.stagedPaths) {
      if (!stagedPaths.includes(path)) stagedPaths.push(path);
    }
    for (const path of changeSet.unstagedPaths) {
      if (!unstagedPaths.includes(path)) unstagedPaths.push(path);
    }
    for (const path of changeSet.untrackedPaths) {
      if (!untrackedPaths.includes(path)) untrackedPaths.push(path);
    }

    const excludedMissingReason = changeSet.excludedPaths.some((p) => !p.trim());
    if (excludedMissingReason) {
      throw new Error(
        "Excluded file paths require a reason in the current review scope contract.",
      );
    }

    const result: ReviewChangeSetSource = {
      ...changeSet,
      committedPaths,
      stagedPaths,
      unstagedPaths,
      untrackedPaths,
      excludedPaths: [...changeSet.excludedPaths],
      includedPaths: [...changeSet.includedPaths],
      generatedPaths: [...changeSet.generatedPaths],
      testPaths: [...changeSet.testPaths],
      configPaths: [...changeSet.configPaths],
      documentationPaths: [...changeSet.documentationPaths],
    };
    return result;
  }

  static isStale(current: ReviewChangeSetSource, latest: ReviewChangeSetSource): boolean {
    return current.baseRevision !== latest.baseRevision ||
      current.currentRevision !== latest.currentRevision ||
      hash(current) !== hash(latest);
  }

  private computeStale(
    changeSet: ReviewChangeSetSource,
    current: ReviewChangeSetSource,
  ): boolean {
    return ReviewChangeSetService.isStale(changeSet, current);
  }
}

function hash(value: ReviewChangeSetSource): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
