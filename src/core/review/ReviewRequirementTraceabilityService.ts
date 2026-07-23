import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewTraceabilityAssessmentSchema,
  ReviewTraceabilityLinkSchema,
  type ReviewTraceabilityAssessment,
  type ReviewTraceabilityLink,
  type TraceabilityState,
} from "../../shared/contracts/prReview";

export interface RequirementTraceabilityInput {
  workflowId: string;
  requirements: Array<{ id: string; description: string }>;
  acceptanceCriteria: Array<{ id: string; text: string; requirementIds: string[] }>;
  changedFilePaths: string[];
  changedEntityIds: string[];
  evidenceByCriterion: Record<
    string,
    {
      taskIds: string[];
      changedFiles: string[];
      validationEvidenceIds: string[];
      testEvidenceIds: string[];
      criterionStatus?: TraceabilityState;
    }
  >;
}

export class ReviewRequirementTraceabilityService {
  build(input: RequirementTraceabilityInput): ReviewTraceabilityAssessment {
    const links: ReviewTraceabilityLink[] = [];

    for (const requirement of input.requirements) {
      const criteria = input.acceptanceCriteria.filter((c) =>
        c.requirementIds.includes(requirement.id),
      );
      const criterionIds = new Set(criteria.map((c) => c.id));

      const requirementChangedFiles = new Set<string>();
      const requirementValidationEvidenceIds = new Set<string>();
      const requirementTestEvidenceIds = new Set<string>();
      const requirementTaskIds = new Set<string>();

      for (const [criterionId, evidence] of Object.entries(input.evidenceByCriterion)) {
        if (!criterionIds.has(criterionId)) continue;
        for (const file of evidence.changedFiles) requirementChangedFiles.add(file);
        for (const id of evidence.validationEvidenceIds) requirementValidationEvidenceIds.add(id);
        for (const id of evidence.testEvidenceIds) requirementTestEvidenceIds.add(id);
        for (const id of evidence.taskIds) requirementTaskIds.add(id);
      }

      const criterionStatuses: TraceabilityState[] = criteria
        .map((c) => input.evidenceByCriterion[c.id]?.criterionStatus)
        .filter((status): status is TraceabilityState => status !== undefined);

      const hasValidation =
        requirementValidationEvidenceIds.size + requirementTestEvidenceIds.size > 0;
      const state = deriveRequirementState(
        criteria,
        criterionStatuses,
        [...requirementChangedFiles],
        hasValidation,
        criteria.some((c) => input.evidenceByCriterion[c.id]?.criterionStatus === "contradicted"),
      );

      links.push(
        ReviewTraceabilityLinkSchema.parse({
          id: `req:${requirement.id}`,
          kind: "requirement",
          sourceRef: requirement.id,
          description: requirement.description,
          implementationRefs: [...requirementChangedFiles],
          validationRefs: [
            ...requirementValidationEvidenceIds,
            ...requirementTestEvidenceIds,
          ],
          confidence: confidenceForRequirement(state),
          evidence: [
            ...[...requirementValidationEvidenceIds].map((id) => `validation:${id}`),
            ...[...requirementTestEvidenceIds].map((id) => `test:${id}`),
          ],
          explanation: explainRequirementState(
            state,
            criteria.length,
            [...requirementChangedFiles].length,
            hasValidation ? 1 : 0,
          ),
          state,
        }),
      );
    }

    for (const criterion of input.acceptanceCriteria) {
      const evidence = input.evidenceByCriterion[criterion.id];
      const criterionState = evidence?.criterionStatus ?? deriveCriterionFallback(evidence);
      const validationRefs = [
        ...(evidence?.validationEvidenceIds ?? []),
        ...(evidence?.testEvidenceIds ?? []),
      ];
      const implementationRefs = [...(evidence?.changedFiles ?? [])];

      links.push(
        ReviewTraceabilityLinkSchema.parse({
          id: `ac:${criterion.id}`,
          kind: "acceptance-criterion",
          sourceRef: criterion.id,
          description: criterion.text,
          implementationRefs,
          validationRefs,
          confidence: confidenceForCriterion(criterionState, validationRefs.length),
          evidence: [
            ...(evidence?.validationEvidenceIds ?? []).map((id) => `validation:${id}`),
            ...(evidence?.testEvidenceIds ?? []).map((id) => `test:${id}`),
          ],
          explanation: explainCriterionState(
            criterionState,
            implementationRefs.length,
            validationRefs.length,
          ),
          state: criterionState,
        }),
      );
    }

    const referencedFiles = new Set(links.flatMap((link) => link.implementationRefs));
    const referencedEntities = new Set(input.changedEntityIds);
    const unlinked = input.changedFilePaths.filter(
      (path) => !referencedFiles.has(path) && !referencedEntities.has(path),
    );

    return ReviewTraceabilityAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      links,
      unlinkedChangePaths: unlinked,
      ambiguousLinkIds: [],
      createdAt: new Date().toISOString(),
      contentHash: hash({ links, unlinked }),
    });
  }
}

function deriveRequirementState(
  criteria: RequirementTraceabilityInput["acceptanceCriteria"],
  criterionStatuses: TraceabilityState[],
  changedFiles: string[],
  hasValidationEvidence: boolean,
  hasContradiction: boolean,
): TraceabilityState {
  if (criteria.length === 0) return "not-applicable";
  if (hasContradiction) return "contradicted";
  if (changedFiles.length === 0) return "no-implementation-found";
  if (criterionStatuses.length === 0) {
    if (!hasValidationEvidence) return "implemented-not-validated";
    return "possible-implementation";
  }
  const hasSatisfied = criterionStatuses.some(
    (status) => status === "implemented-and-validated",
  );
  const hasPartial = criterionStatuses.some(
    (status) => status === "partially-implemented",
  );
  const hasNotSatisfied = criterionStatuses.some(
    (status) => status === "no-implementation-found",
  );
  if (hasNotSatisfied) return "no-implementation-found";
  if (hasValidationEvidence && hasSatisfied) return "implemented-and-validated";
  if (hasPartial) return "partially-implemented";
  if (hasValidationEvidence) return "implemented-and-validated";
  return "implemented-not-validated";
}

function deriveCriterionFallback(
  evidence?: RequirementTraceabilityInput["evidenceByCriterion"][string],
): TraceabilityState {
  const changedFiles = evidence?.changedFiles ?? [];
  const hasValidation =
    (evidence?.validationEvidenceIds?.length ?? 0) > 0 ||
    (evidence?.testEvidenceIds?.length ?? 0) > 0;
  if (changedFiles.length === 0) return "no-implementation-found";
  if (hasValidation) return "implemented-and-validated";
  return "implemented-not-validated";
}

function confidenceForRequirement(state: TraceabilityState): number {
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

function confidenceForCriterion(state: TraceabilityState, evidenceCount: number): number {
  if (state === "implemented-and-validated" && evidenceCount > 0) return 0.95;
  if (state === "implemented-not-validated") return 0.5;
  if (state === "no-implementation-found") return 0.9;
  if (state === "contradicted") return 0.9;
  if (state === "partially-implemented") return 0.7;
  return 0.3;
}

function explainRequirementState(
  state: TraceabilityState,
  criterionCount: number,
  fileCount: number,
  evidenceCount: number,
): string {
  const bits = [`state=${state}`, `criteria=${criterionCount}`, `changedFiles=${fileCount}`, `evidence=${evidenceCount}`];
  if (state === "no-implementation-found") bits.push("no changed files or tasks map to this requirement");
  if (state === "contradicted") bits.push("impl evidence conflicts with acceptance state");
  if (state === "implemented-not-validated") bits.push("implementation present but no validation evidence links to it");
  return bits.join("; ");
}

function explainCriterionState(
  state: TraceabilityState,
  fileCount: number,
  evidenceCount: number,
): string {
  const bits = [`state=${state}`, `changedFiles=${fileCount}`, `evidence=${evidenceCount}`];
  if (state === "no-implementation-found") bits.push("no changed files or test evidence support this criterion");
  if (state === "contradicted") bits.push("test evidence contradicts implementation evidence");
  return bits.join("; ");
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
