import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewScopeAssessmentSchema,
  type ReviewScopeArea,
  type ReviewScopeAssessment,
} from "../../shared/contracts/prReview";

export interface ScopeAssessmentInput {
  workflowId: string;
  expectedAreas: ReviewScopeArea[];
  /** actual changed file paths observed in the workspace / change set */
  actualFilePaths: string[];
  /** paths the user explicitly included or excluded */
  includedPaths?: string[];
  excludedPaths?: string[];
  /** generated output paths (build artifacts, generated code) */
  generatedPaths?: string[];
  /** dependency manifest/lockfile paths that changed */
  dependencyPaths?: string[];
  /** true when the review covers only part of the workspace changes */
  partial?: boolean;
  partialConfirmed?: boolean;
}

/**
 * Deterministic scope-drift assessment (spec §12, §13).
 * Compares expected scope (from workflow intent/specification) against the
 * actual changed files. Flags unlinked changes as candidates, allows justified
 * expansion, and surfaces repository-wide formatting / generated / dependency
 * changes explicitly rather than silently.
 */
export class ReviewScopeAssessmentService {
  build(input: ScopeAssessmentInput): ReviewScopeAssessment {
    const expectedFiles = new Set(input.expectedAreas.flatMap((a) => a.filePaths));
    const generated = new Set(input.generatedPaths ?? []);
    const dependency = new Set(input.dependencyPaths ?? []);

    const unlinked: string[] = [];
    const justifiedExpansionIds: string[] = [];

    for (const path of input.actualFilePaths) {
      if (input.excludedPaths?.includes(path)) continue;
      const isExpected = expectedFiles.has(path);
      const isGenerated = generated.has(path);
      const isDependency = dependency.has(path);
      // Generated and dependency changes are disclosed but not treated as scope drift.
      if (isExpected || isGenerated || isDependency) continue;
      unlinked.push(path);
    }

    const hasUnexpected = unlinked.length > 0;
    const hasExpected = expectedFiles.size > 0;
    const hasActual = input.actualFilePaths.length > 0;

    let state: ReviewScopeAssessment["state"];
    if (input.partial && !input.partialConfirmed) {
      state = "incomplete";
    } else if (!hasActual) {
      state = "incomplete";
    } else if (!hasExpected) {
      state = "unexplained-expansion";
    } else if (hasUnexpected && !justifiedExpansionIds.length) {
      state = "unexplained-expansion";
    } else if (hasUnexpected) {
      state = "expanded-with-explanation";
    } else {
      state = "aligned";
    }
    if (hasUnexpected && state === "aligned") state = "unexplained-expansion";

    const assessment = ReviewScopeAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      expectedAreas: input.expectedAreas,
      actualAreas: input.actualFilePaths.map((path) => ({
        area: path,
        filePaths: [path],
        rationale:
          generated.has(path)
            ? "generated-output"
            : dependency.has(path)
              ? "dependency-change"
              : expectedFiles.has(path)
                ? "expected"
                : "unlinked-candidate",
      })),
      unlinkedFilePaths: unlinked,
      justifiedExpansionIds,
      state,
      evidenceIds: [
        `expected:${expectedFiles.size}`,
        `actual:${input.actualFilePaths.length}`,
        `unlinked:${unlinked.length}`,
      ],
      repositoryStateAvailable: Boolean(input.includedPaths || input.excludedPaths),
      partialReviewConfirmed: Boolean(input.partialConfirmed),
      createdAt: new Date().toISOString(),
      contentHash: hash(input),
    });
    return assessment;
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
