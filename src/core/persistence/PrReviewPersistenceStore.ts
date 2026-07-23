import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  PR_REVIEW_SCHEMA_VERSION,
  PullRequestReviewSchema,
  ReviewScopeAssessmentSchema,
  ReviewTraceabilityAssessmentSchema,
  ReviewContractAssessmentSchema,
  ReviewTestAssessmentSchema,
  ReviewFindingSchema,
  ChangeReadinessDecisionSchema,
  PullRequestPackageSchema,
  type PullRequestReview,
  type ReviewScopeAssessment,
  type ReviewTraceabilityAssessment,
  type ReviewContractAssessment,
  type ReviewTestAssessment,
  type ReviewFinding,
  type ChangeReadinessDecision,
  type PullRequestPackage,
} from "../../shared/contracts/prReview";
import { AtomicFileWriter } from "./AtomicFileWriter";

export interface PrReviewPersistentState {
  schemaVersion: typeof PR_REVIEW_SCHEMA_VERSION;
  revision: number;
  reviews: PullRequestReview[];
  scopeAssessments: ReviewScopeAssessment[];
  traceabilityAssessments: ReviewTraceabilityAssessment[];
  contractAssessments: ReviewContractAssessment[];
  testAssessments: ReviewTestAssessment[];
  findings: ReviewFinding[];
  readinessDecisions: ChangeReadinessDecision[];
  packages: PullRequestPackage[];
  updatedAt: string;
}

export class PrReviewPersistenceStore {
  private state = emptyState();
  private chain = Promise.resolve();
  private readonly path?: string;

  constructor(
    storageRoot?: string,
    private readonly writer = new AtomicFileWriter(),
  ) {
    this.path = storageRoot ? join(storageRoot, "workflow", "pr-review-state.json") : undefined;
  }

  get snapshot(): PrReviewPersistentState {
    return structuredClone(this.state);
  }

  async initialize(): Promise<PrReviewPersistentState> {
    if (!this.path) return this.snapshot;
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      this.state = coalesce(parsed);
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`);
      }
      await this.persist(this.state);
    }
    return this.snapshot;
  }

  async update(
    mutate: (state: PrReviewPersistentState) => PrReviewPersistentState,
  ): Promise<PrReviewPersistentState> {
    const next = coalesce(mutate(this.snapshot));
    this.state = next;
    await this.persist(next);
    return this.snapshot;
  }

  private persist(value: PrReviewPersistentState): Promise<void> {
    return this.path ? this.writer.writeJson(this.path, value) : Promise.resolve();
  }
}

function coalesce(value: unknown): PrReviewPersistentState {
  const raw = (value ?? {}) as Partial<PrReviewPersistentState>;
  return {
    schemaVersion: PR_REVIEW_SCHEMA_VERSION,
    revision: typeof raw.revision === "number" ? raw.revision + 1 : 1,
    reviews: (raw.reviews ?? []).map((r) => PullRequestReviewSchema.parse(r)),
    scopeAssessments: (raw.scopeAssessments ?? []).map((r) =>
      ReviewScopeAssessmentSchema.parse(r),
    ),
    traceabilityAssessments: (raw.traceabilityAssessments ?? []).map((r) =>
      ReviewTraceabilityAssessmentSchema.parse(r),
    ),
    contractAssessments: (raw.contractAssessments ?? []).map((r) =>
      ReviewContractAssessmentSchema.parse(r),
    ),
    testAssessments: (raw.testAssessments ?? []).map((r) => ReviewTestAssessmentSchema.parse(r)),
    findings: (raw.findings ?? []).map((r) => ReviewFindingSchema.parse(r)),
    readinessDecisions: (raw.readinessDecisions ?? []).map((r) =>
      ChangeReadinessDecisionSchema.parse(r),
    ),
    packages: (raw.packages ?? []).map((r) => PullRequestPackageSchema.parse(r)),
    updatedAt: new Date().toISOString(),
  };
}

function emptyState(): PrReviewPersistentState {
  return {
    schemaVersion: PR_REVIEW_SCHEMA_VERSION,
    revision: 0,
    reviews: [],
    scopeAssessments: [],
    traceabilityAssessments: [],
    contractAssessments: [],
    testAssessments: [],
    findings: [],
    readinessDecisions: [],
    packages: [],
    updatedAt: new Date().toISOString(),
  };
}
