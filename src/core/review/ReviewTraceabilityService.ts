import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewTraceabilityAssessmentSchema,
  type ReviewTraceabilityAssessment,
  type ReviewTraceabilityLink,
  type TraceabilityState,
} from "../../shared/contracts/prReview";

export interface TraceabilityRequirement {
  id: string;
  description: string;
}

export interface TraceabilityCriterion {
  id: string;
  description: string;
  required: boolean;
  requirementIds: string[];
}

export interface TraceabilityCriterionEvidence {
  taskIds: string[];
  changedFiles: string[];
  validationEvidenceIds: string[];
  qaEvidence: string[];
  /** status from the underlying review traceability (satisfied|partially-satisfied|failed|not-evaluated|manual-review-required|stale) */
  status: string;
}

export interface TraceabilityInput {
  workflowId: string;
  requirements: TraceabilityRequirement[];
  acceptanceCriteria: TraceabilityCriterion[];
  changedFilePaths: string[];
  changedEntityIds: string[];
  criterionEvidence: Record<string, TraceabilityCriterionEvidence>;
}

/**
 * Deterministic requirement traceability (spec §9, §10, §11).
 * Maps intent/requirements/acceptance criteria to changed files, symbols, and
 * validation evidence. Produces one of eight explicit traceability states and
 * reports requirements with no implementation and changes with no requirement link.
 */
export class ReviewTraceabilityService {
  build(input: TraceabilityInput): ReviewTraceabilityAssessment {
    const links: ReviewTraceabilityLink[] = [];
    const ambiguous: string[] = [];

    for (const requirement of input.requirements) {
      const criteria = input.acceptanceCriteria.filter((c) =>
        c.requirementIds.includes(requirement.id),
      );
      const evidence = this.aggregateEvidence(criteria, input.criterionEvidence);
      const changedFiles = this.changedFilesForCriteria(criteria, input.criterionEvidence);
      const state = this.deriveState(criteria, evidence, changedFiles, input.criterionEvidence);
      links.push({
        id: `req:${requirement.id}`,
        kind: "requirement",
        sourceRef: requirement.id,
        description: requirement.description,
        implementationRefs: changedFiles,
        validationRefs: evidence.validationEvidenceIds,
        confidence: this.confidence(state, evidence),
        evidence: [
          ...evidence.validationEvidenceIds.map((id) => `validation:${id}`),
          ...evidence.qaEvidence.map((id) => `qa:${id}`),
        ],
        explanation: this.explain(state, criteria.length, changedFiles.length, evidence),
        state,
      });
    }

    for (const criterion of input.acceptanceCriteria) {
      const criterionEvidence: TraceabilityCriterionEvidence =
        input.criterionEvidence[criterion.id] ?? {
          taskIds: [],
          changedFiles: [],
          validationEvidenceIds: [],
          qaEvidence: [],
          status: "not-evaluated",
        };
      const changedFiles = criterionEvidence.changedFiles;
      const criterionState = this.deriveCriterionState(criterion, criterionEvidence);
      const criterionAggregated = emptyEvidence();
      criterionAggregated.taskIds.push(...criterionEvidence.taskIds);
      criterionAggregated.changedFiles.push(...criterionEvidence.changedFiles);
      criterionAggregated.validationEvidenceIds.push(...criterionEvidence.validationEvidenceIds);
      criterionAggregated.qaEvidence.push(...criterionEvidence.qaEvidence);
      if (criterionEvidence.status === "failed") criterionAggregated.failed = true;
      if (["satisfied", "partially-satisfied", "manual-review-required"].includes(criterionEvidence.status)) {
        criterionAggregated.touched = true;
      }
      if (criterionEvidence.status === "stale") criterionAggregated.stale = true;
      if (criterionEvidence.status === "not-evaluated") criterionAggregated.notEvaluated = true;
      criterionAggregated.changedFiles = [...new Set(criterionAggregated.changedFiles)];
      if (criterion.requirementIds.length > 1) ambiguous.push(`ac:${criterion.id}`);
      links.push({
        id: `ac:${criterion.id}`,
        kind: "acceptance-criterion",
        sourceRef: criterion.id,
        description: criterion.description,
        implementationRefs: changedFiles,
        validationRefs: criterionAggregated.validationEvidenceIds,
        confidence: this.confidence(criterionState, criterionAggregated),
        evidence: [
          ...criterionAggregated.validationEvidenceIds.map((id) => `validation:${id}`),
          ...criterionAggregated.qaEvidence.map((id) => `qa:${id}`),
        ],
        explanation: this.explain(criterionState, 1, changedFiles.length, criterionAggregated),
        state: criterionState,
      });
    }

    const referencedFiles = new Set(
      links.flatMap((link) => link.implementationRefs),
    );
    const unlinked = input.changedFilePaths.filter((path) => !referencedFiles.has(path));

    const assessment = ReviewTraceabilityAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      links,
      unlinkedChangePaths: unlinked,
      ambiguousLinkIds: ambiguous,
      createdAt: new Date().toISOString(),
      contentHash: hash({ links, unlinked, ambiguous }),
    });
    return assessment;
  }

  private aggregateEvidence(
    criteria: TraceabilityCriterion[],
    map: Record<string, TraceabilityCriterionEvidence>,
  ) {
    const out = emptyEvidence();
    for (const c of criteria) {
      const e = map[c.id];
      if (!e) continue;
      out.taskIds.push(...e.taskIds);
      out.changedFiles.push(...e.changedFiles);
      out.validationEvidenceIds.push(...e.validationEvidenceIds);
      out.qaEvidence.push(...e.qaEvidence);
      if (e.status === "failed") out.failed = true;
      if (["satisfied", "partially-satisfied", "manual-review-required"].includes(e.status))
        out.touched = true;
      if (e.status === "stale") out.stale = true;
      if (e.status === "not-evaluated") out.notEvaluated = true;
    }
    out.changedFiles = [...new Set(out.changedFiles)];
    return out;
  }

  private changedFilesForCriteria(
    criteria: TraceabilityCriterion[],
    map: Record<string, TraceabilityCriterionEvidence>,
  ): string[] {
    const files = new Set<string>();
    for (const c of criteria) {
      const e = map[c.id];
      if (e) e.changedFiles.forEach((f) => files.add(f));
    }
    return [...files];
  }

  private deriveState(
    criteria: TraceabilityCriterion[],
    evidence: ReturnType<ReviewTraceabilityService["aggregateEvidence"]>,
    changedFiles: string[],
    map: Record<string, TraceabilityCriterionEvidence>,
  ): TraceabilityState {
    if (criteria.length === 0) return "not-applicable";
    if (evidence.failed) return "contradicted";
    if (evidence.stale) return "ambiguous";
    if (changedFiles.length === 0) return "no-implementation-found";
    const hasValidation = evidence.validationEvidenceIds.length > 0 || evidence.qaEvidence.length > 0;
    if (!hasValidation) return "implemented-not-validated";
    const allSatisfied = criteria.every((c) => (map[c.id]?.status ?? "not-evaluated") === "satisfied");
    if (allSatisfied && changedFiles.length > 0) return "implemented-and-validated";
    if (evidence.touched) return "partially-implemented";
    return "possible-implementation";
  }

  private deriveCriterionState(
    criterion: TraceabilityCriterion,
    evidence: TraceabilityCriterionEvidence,
  ): TraceabilityState {
    if (evidence.status === "failed") return "contradicted";
    if (evidence.status === "stale") return "ambiguous";
    if (evidence.changedFiles.length === 0) return "no-implementation-found";
    if (["satisfied"].includes(evidence.status) && (evidence.validationEvidenceIds.length || evidence.qaEvidence.length))
      return "implemented-and-validated";
    if (evidence.status === "partially-satisfied" || evidence.status === "manual-review-required")
      return "partially-implemented";
    if (evidence.validationEvidenceIds.length === 0 && evidence.qaEvidence.length === 0)
      return "implemented-not-validated";
    return "possible-implementation";
  }

  private confidence(
    state: TraceabilityState,
    evidence: ReturnType<ReviewTraceabilityService["aggregateEvidence"]>,
  ): number {
    switch (state) {
      case "implemented-and-validated":
        return 0.95;
      case "partially-implemented":
        return 0.7;
      case "implemented-not-validated":
        return 0.5;
      case "possible-implementation":
        return 0.4;
      case "no-implementation-found":
        return 0.9;
      case "contradicted":
        return 0.9;
      case "ambiguous":
        return 0.3;
      case "not-applicable":
        return 1;
      default:
        return 0.5;
    }
  }

  private explain(
    state: TraceabilityState,
    criterionCount: number,
    fileCount: number,
    evidence: ReturnType<ReviewTraceabilityService["aggregateEvidence"]>,
  ): string {
    const bits: string[] = [`state=${state}`];
    bits.push(`criteria=${criterionCount}`);
    bits.push(`changedFiles=${fileCount}`);
    bits.push(`validationEvidence=${evidence.validationEvidenceIds.length}`);
    bits.push(`qaEvidence=${evidence.qaEvidence.length}`);
    if (state === "no-implementation-found")
      bits.push("no changed files or tasks map to this requirement");
    if (state === "implemented-not-validated")
      bits.push("implementation present but no validation evidence links to it");
    if (state === "contradicted") bits.push("underlying validation status is failed/contradicted");
    return bits.join("; ");
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function emptyEvidence() {
  return {
    taskIds: [] as string[],
    changedFiles: [] as string[],
    validationEvidenceIds: [] as string[],
    qaEvidence: [] as string[],
    failed: false,
    touched: false,
    stale: false,
    notEvaluated: false,
  };
}
