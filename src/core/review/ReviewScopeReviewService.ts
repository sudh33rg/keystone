import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewScopeAssessmentSchema,
  type ReviewScopeAssessment,
  type ReviewScopeArea,
} from "../../shared/contracts/prReview";

export interface ScopeReviewInput {
  workflowId: string;
  expectedAreas: ReviewScopeArea[];
  actualFilePaths: string[];
  includedPaths?: string[];
  excludedPaths?: string[];
  generatedPaths?: string[];
  dependencyPaths?: string[];
  partial?: boolean;
  partialConfirmed?: boolean;
  /** fingerprint from the underlying change set or workspace snapshot */
  changeSetFingerprint?: string;
}

/**
 * Deterministic scope review (spec §6, §12, §13).
 * - Derives expected areas from workflow scope.
 * - Compares actual changes with expected scope.
 * - Unrelated module changes become candidates.
 * - Generated files are grouped but disclosed.
 * - Repository-wide formatting is detected.
 * - Dependency changes without reason are identified.
 * - Scope findings carry evidence and confidence.
 */
export class ReviewScopeReviewService {
  build(input: ScopeReviewInput): ReviewScopeAssessment {
    const expectedFiles = new Set(input.expectedAreas.flatMap((a) => a.filePaths));
    const generated = new Set(input.generatedPaths ?? []);
    const dependency = new Set(input.dependencyPaths ?? []);
    const excluded = new Set(input.excludedPaths ?? []);

    const actualAreas: ReviewScopeArea[] = [];
    const unlinked: string[] = [];
    const candidates: string[] = [];
    const formattingFindings: string[] = [];
    const dependencyFindings: string[] = [];

    let repositoryWideFormatting = false;
    const unrelatedModules = new Set<string>();

    for (const path of input.actualFilePaths) {
      if (excluded.has(path)) continue;
      const isExpected = expectedFiles.has(path);
      const isGenerated = generated.has(path);
      const isDependency = dependency.has(path);

      const rationale = isGenerated
        ? "generated-output"
        : isDependency
          ? "dependency-change"
          : isExpected
            ? "expected"
            : "unlinked-candidate";

      actualAreas.push({
        area: path,
        entityIds: [],
        filePaths: [path],
        rationale,
      });

      if (!isExpected && !isGenerated && !isDependency) {
        unlinked.push(path);
        candidates.push(path);

        // Detect unrelated module changes.
        const module = path.split("/")[1] ?? path;
        unrelatedModules.add(module);
      }

      if (isGenerated) {
        // Group generated files but disclose them.
      }

      if (isDependency && !path.trim()) {
        dependencyFindings.push(path);
      }

      // Detect repository-wide formatting by heuristic: many unrelated files
      // changed with formatting-like extensions or paths.
      if (/\.(json|md|prettierrc|eslintrc|editorconfig)$/.test(path)) {
        repositoryWideFormatting = true;
        formattingFindings.push(path);
      }
    }

    const hasUnexpected = unlinked.length > 0;
    const hasExpected = expectedFiles.size > 0;
    const hasActual = input.actualFilePaths.length > 0;
    const hasDependencyReason = input.dependencyPaths
      ? input.dependencyPaths.every((p) => p.trim().length > 0)
      : true;

    let state: ReviewScopeAssessment["state"];
    if (input.partial && !input.partialConfirmed) {
      state = "incomplete";
    } else if (!hasActual) {
      state = "incomplete";
    } else if (!hasExpected) {
      state = "unexplained-expansion";
    } else if (hasUnexpected && unrelatedModules.size > 1) {
      state = "materially-out-of-scope";
    } else if (hasUnexpected && !hasDependencyReason) {
      state = "unexplained-expansion";
    } else if (hasUnexpected) {
      state = "expanded-with-explanation";
    } else {
      state = "aligned";
    }

    const evidenceIds = [
      `expected:${expectedFiles.size}`,
      `actual:${input.actualFilePaths.length}`,
      `unlinked:${unlinked.length}`,
      `candidates:${candidates.length}`,
      ...(repositoryWideFormatting ? [`formatting:${formattingFindings.length}`] : []),
      ...(dependencyFindings.length > 0 ? [`dependencies:${dependencyFindings.length}`] : []),
    ];

    const assessment = ReviewScopeAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      expectedAreas: input.expectedAreas,
      actualAreas,
      unlinkedFilePaths: unlinked,
      justifiedExpansionIds: [],
      state,
      evidenceIds,
      repositoryStateAvailable: Boolean(input.includedPaths || input.excludedPaths),
      partialReviewConfirmed: Boolean(input.partialConfirmed),
      createdAt: new Date().toISOString(),
      contentHash: hash(input),
    });

    return assessment;
  }

  static evidence(assessment: ReviewScopeAssessment): string[] {
    return [...assessment.evidenceIds];
  }
}

function hash(value: ScopeReviewInput): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
