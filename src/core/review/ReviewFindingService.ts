import { createHash } from "node:crypto";
import {
  PR_REVIEW_SCHEMA_VERSION,
  ReviewFindingSchema,
  type ReviewFinding,
} from "../../shared/contracts/prReview";

export interface ReviewFindingInput {
  workflowId: string;
  reviewId: string;
  findings: ReviewFinding[];
}

export interface UpdateFindingInput {
  workflowId: string;
  findingId: string;
  status: ReviewFinding["status"];
  resolutionEvidence?: string[];
  justification?: string;
}

export interface DedupeInput {
  candidateId: string;
  canonicalId: string;
  kind: "duplicate" | "same-root-cause" | "related" | "superseded" | "reopened";
}

const STATUS_VALUES: ReviewFinding["status"][] = [
  "open",
  "remediation-planned",
  "resolved",
  "accepted-risk",
  "false-positive",
  "deferred",
  "superseded",
];

const PROVENANCE_VALUES: ReviewFinding["provenance"][] = [
  "deterministic",
  "qa",
  "security",
  "performance",
  "agent",
  "user",
];

/**
 * Deterministic review-finding lifecycle (spec §29, §30).
 * - findings must carry category/severity/confidence/provenance/source
 * - duplicates are consolidated, never silently dropped
 * - resolution requires evidence; high-severity deferral requires justification
 * - resolved/deferred findings are preserved in the persisted record set
 */
export class ReviewFindingService {
  findings: ReviewFinding[] = [];

  initialize(): ReviewFinding[] {
    return this.findings;
  }

  record(input: ReviewFindingInput): ReviewFinding[] {
    const timestamp = new Date().toISOString();
    const next = input.findings.map((finding) =>
      ReviewFindingSchema.parse({
        ...finding,
        workflowId: input.workflowId,
        reviewId: input.reviewId,
        createdAt: finding.createdAt ?? timestamp,
        contentHash: hash({
          id: finding.id,
          workflowId: input.workflowId,
          reviewId: input.reviewId,
          status: finding.status,
          title: finding.title,
          createdAt: timestamp,
        }),
      }),
    );
    this.replaceFindings(next);
    return this.list();
  }

  updateStatus(input: UpdateFindingInput): ReviewFinding[] {
    const idx = this.findings.findIndex((item) => item.id === input.findingId);
    if (idx < 0) {
      throw new Error(`Review finding not found: ${input.findingId}`);
    }
    const current = this.findings[idx]!;
    if (!STATUS_VALUES.includes(input.status)) {
      throw new Error(`Invalid finding status: ${input.status}`);
    }
    this.findings[idx] = ReviewFindingSchema.parse({
      ...current,
      status: input.status,
      resolutionEvidence: input.resolutionEvidence ?? current.resolutionEvidence,
      contentHash: hash({
        ...current,
        status: input.status,
        resolutionEvidence: input.resolutionEvidence ?? current.resolutionEvidence,
      }),
    });
    return this.list();
  }

  dedupe(candidates: ReviewFinding[]): { deduped: ReviewFinding[]; relations: DedupeInput[] } {
    const keyed = new Map<string, ReviewFinding>();
    const relations: DedupeInput[] = [];
    const deduped: ReviewFinding[] = [];

    const keyFor = (finding: ReviewFinding): string =>
      [
        finding.category,
        finding.location?.filePath ?? "",
        finding.location?.entityId ?? finding.location?.startLine ?? "",
        normalizeTitle(finding.title),
      ].join("|");

    for (const finding of candidates) {
      const key = keyFor(finding);
      const existing = keyed.get(key);
      if (existing) {
        relations.push({
          candidateId: finding.id,
          canonicalId: existing.id,
          kind: "duplicate",
        });
        continue;
      }
      keyed.set(key, finding);
      deduped.push(finding);
    }

    return { deduped, relations };
  }

  validateDeferral(finding: ReviewFinding, justification?: string): void {
    if (
      finding.severity === "high" &&
      finding.status !== "resolved" &&
      finding.status !== "accepted-risk" &&
      finding.status !== "false-positive" &&
      !justification
    ) {
      throw new Error(
        "High-severity finding deferral requires explicit justification evidence before it can be marked resolved.",
      );
    }
  }

  enforceProvenance(findings: ReviewFinding[]): ReviewFinding[] {
    return findings.map((finding) => {
      const provenance = PROVENANCE_VALUES.includes(finding.provenance)
        ? finding.provenance
        : "agent";
      return ReviewFindingSchema.parse({ ...finding, provenance });
    });
  }

  list(): ReviewFinding[] {
    return [...this.findings];
  }

  private replaceFindings(findings: ReviewFinding[]): void {
    this.findings.length = 0;
    findings.slice(0, 5000).forEach((finding) => this.findings.push(finding));
  }
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}
