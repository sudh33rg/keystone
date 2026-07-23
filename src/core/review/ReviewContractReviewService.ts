import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewContractAssessmentSchema,
  type ReviewContractAssessment,
  type ContractChange,
} from "../../shared/contracts/prReview";

export interface ContractChangeInput {
  id: string;
  contractKind: ContractChange["contractKind"];
  location: string;
  oldShape?: string;
  newShape?: string;
  classification: ContractChange["classification"];
  affectedConsumers?: string[];
  evidenceIds?: string[];
  behaviouralNote?: string;
  confidence?: number;
}

export interface ContractReviewInput {
  workflowId: string;
  changes: ContractChangeInput[];
}

/**
 * Contract review (spec §16, §17). Detects exported-function, public-method,
 * interface, route, request/response, event, configuration, and database schema
 * changes, classifies them, and surfaces behavioural-compatibility uncertainty
 * honestly when consumer evidence is incomplete.
 */
export class ReviewContractReviewService {
  build(input: ContractReviewInput): ReviewContractAssessment {
    const changes: ContractChange[] = input.changes.map((c) => ({
      id: c.id,
      contractKind: c.contractKind,
      location: c.location,
      oldShape: c.oldShape,
      newShape: c.newShape,
      classification: c.classification,
      affectedConsumers: c.affectedConsumers ?? [],
      behaviouralNote:
        c.behaviouralNote ??
        (c.classification === "unresolved" || c.classification === "potentially-breaking"
          ? "Behavioural compatibility remains unresolved when consumer evidence is incomplete."
          : ""),
      evidenceIds: c.evidenceIds ?? [],
      confidence: c.confidence ?? 0.5,
    }));
    return ReviewContractAssessmentSchema.parse({
      schemaVersion: PR_REVIEW_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      changes,
      createdAt: new Date().toISOString(),
      contentHash: hash(changes),
    });
  }

  static hasBreakingChange(assessment: ReviewContractAssessment): boolean {
    return assessment.changes.some(
      (c) => c.classification === "breaking" || c.classification === "potentially-breaking",
    );
  }

  static summary(assessment: ReviewContractAssessment): string {
    const counts = assessment.changes.reduce(
      (acc, c) => {
        acc[c.classification] = (acc[c.classification] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const parts = [
      `contract changes: ${assessment.changes.length}`,
      ...Object.entries(counts).map(([k, v]) => `${k}: ${v}`),
    ];
    return parts.join("\n");
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
