import { createHash } from "node:crypto";
import {
  PullRequestPackageSchema,
  type PullRequestPackage,
  type ReviewTestAssessment,
  type ReviewFinding,
} from "../../shared/contracts/prReview";
import { PrReviewPersistenceStore } from "../persistence/PrReviewPersistenceStore";

export interface PrPackageInput {
  workflowId: string;
  reviewId: string;
  intent: string;
  outcome: string;
  sections: Partial<PullRequestPackage["sections"]>;
  testAssessment: ReviewTestAssessment;
  findings: ReviewFinding[];
}

/**
 * Deterministic PR package generator.
 *
 * Preserves user edits across regeneration unless the caller explicitly
 * passes new intent/outcome/sections content.
 */
export class ReviewPrPackageService {
  private readonly store: PrReviewPersistenceStore;

  constructor(store: PrReviewPersistenceStore) {
    this.store = store;
  }

  async generate(input: PrPackageInput): Promise<PullRequestPackage> {
    const existing = this.currentPersisted(input.workflowId, input.reviewId);
    const hasExisting = Boolean(existing);
    const sectionDefaults = defaultSections(input);
    const title = hasExisting ? existing!.title : buildTitle(input.intent, input.outcome);
    const description = hasExisting ? existing!.description : sectionDefaults.summary;
    const sections = hasExisting
      ? { ...sectionDefaults, ...existing!.sections }
      : sectionDefaults;

    const value = PullRequestPackageSchema.parse({
      schemaVersion: 1,
      id: existing?.id ?? crypto.randomUUID(),
      workflowId: input.workflowId,
      reviewId: input.reviewId,
      title,
      description,
      userEdited: existing?.userEdited ?? false,
      stale: false,
      sections,
      contextBudget: {
        maxSummaryTokens: 2000,
        maxSectionTokens: 1000,
        maxTotalTokens: 12_000,
        estimatedTokensUsed: estimateTokenCount(title, description, sections),
      },
      generatedAt: new Date().toISOString(),
      contentHash: hash({ title, sections, userEdited: existing?.userEdited ?? false }),
    });

    await this.persist(input.workflowId, input.reviewId, value);
    return value;
  }

  async updatePackage(input: {
    workflowId: string;
    reviewId: string;
    title?: string;
    description?: string;
  }): Promise<PullRequestPackage> {
    const existing = this.currentPersisted(input.workflowId, input.reviewId);
    if (!existing) throw new Error("No existing PR package found for this workflow/review.");

    const updated: PullRequestPackage = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      userEdited: true,
      contentHash: hash({ ...existing, ...input, userEdited: true }),
    };

    await this.persist(input.workflowId, input.reviewId, updated);
    return updated;
  }

  currentPersisted(workflowId: string, reviewId: string): PullRequestPackage | undefined {
    return this.store.snapshot.packages.find(
      (pkg) => pkg.workflowId === workflowId && pkg.reviewId === reviewId,
    );
  }

  private persist(workflowId: string, reviewId: string, value: PullRequestPackage): Promise<unknown> {
    return this.store.update((state) => ({
      ...state,
      packages: [
        ...state.packages.filter(
          (pkg) => !(pkg.workflowId === workflowId && pkg.reviewId === reviewId),
        ),
        value,
      ].slice(-200),
    }));
  }
}

function buildTitle(intent: string, outcome: string): string {
  const sanitized = (value: string) => value.replace(/[`~]/g, "").trim();
  const i = sanitized(intent).slice(0, 80);
  const o = sanitized(outcome).slice(0, 80);
  const base = `${i} -> ${o}`;
  return base.length <= 140 ? base : `${base.slice(0, 137)}...`;
}

function defaultSections(input: PrPackageInput): PullRequestPackage["sections"] {
  const summary = [
    input.intent.trim(),
    input.outcome.trim(),
    input.sections.mainChanges?.trim(),
    input.sections.affectedAreas?.trim(),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 20_000);

  const testEvidence = buildTestEvidence(input);
  const acceptedRisks = input.findings
    .filter((f) => f.status === "accepted-risk")
    .map((f) => `- ${f.title}: ${f.description}`)
    .join("\n");

  return {
    summary,
    problem: input.sections.problem ?? "",
    solution: input.sections.solution ?? "",
    mainChanges: input.sections.mainChanges ?? "",
    requirementCoverage: input.sections.requirementCoverage ?? "",
    affectedAreas: input.sections.affectedAreas ?? "",
    contractChanges: input.sections.contractChanges ?? "",
    configurationOrMigration: input.sections.configurationOrMigration ?? "",
    testEvidence,
    security: input.sections.security ?? "",
    performance: input.sections.performance ?? "",
    knownLimitations: input.sections.knownLimitations ?? "",
    acceptedRisks: acceptedRisks || input.sections.acceptedRisks || "",
    reviewerGuidance: input.sections.reviewerGuidance ?? "",
    checklist: input.sections.checklist ?? "",
  };
}

function buildTestEvidence(input: PrPackageInput): string {
  const raw = (input.sections.testEvidence ?? "").trim();
  const assessment = input.testAssessment;
  const parts = [raw];
  parts.push(
    `Targeted tests: ${assessment.testsExecuted.length} executed; required impacted tests: ${assessment.requiredImpactedTests.length}.`,
  );
  parts.push(
    `Results: passed=${assessment.resultsByTest ? Object.values(assessment.resultsByTest).filter((r) => r === "passed").length : 0}, skipped=${assessment.skippedTests?.length ?? 0}, not-run=${(assessment.requiredImpactedTests ?? []).filter((t) => !(assessment.testsExecuted ?? []).includes(t)).length}.`,
  );
  const evidence = parts.filter(Boolean).join("\n");
  return evidence || "No targeted test evidence was recorded.";
}

function hash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

function estimateTokenCount(title: string, description: string, sections: PullRequestPackage["sections"]): number {
  const text = [title, description, Object.values(sections).join(" ")].join(" ");
  return Math.max(0, Math.ceil(text.length / 4));
}
