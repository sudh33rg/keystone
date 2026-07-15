import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { RepositoryIndexService } from "../intelligence/RepositoryIndexService";
import type { IntentEngine } from "../intent/IntentEngine";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import {
  type KeystoneSpecification,
  type SpecificationRevision,
  type AcceptanceCriterion,
  type ApprovalRecord,
  type SpecificationStatus,
  SpecificationStatus as SpecStatus,
  KeystoneSpecificationSchema,
  SpecificationRevisionSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export class SpecificationService {
  private specifications = new Map<string, KeystoneSpecification>();
  private revisions = new Map<string, SpecificationRevision[]>();

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly index: RepositoryIndexService,
    private readonly intentEngine: IntentEngine,
    private readonly store: WorkspaceStateStore
  ) {}

  create(intentId: string, title: string, workflowId: string): KeystoneSpecification {
    const id = crypto.randomUUID();
    const spec: KeystoneSpecification = {
      id,
      title,
      status: "draft",
      revision: 0,
      workflowId,
      repositoryId: this.workspace.getWorkspaceId(),
      indexVersion: this.index.getIndex()?.indexVersion ?? 0,
      intent: {
        originalRequest: "",
        normalizedIntent: "",
        businessObjective: "",
        outcome: ""
      },
      scope: {
        includedFunctionality: [],
        excludedFunctionality: [],
        modules: [],
        expectedFiles: [],
        dependencies: []
      },
      existingBehavior: {
        implementationSummary: "",
        architecture: "",
        constraints: [],
        knownLimitations: [],
        evidenceReferences: []
      },
      proposedBehavior: {
        functionalRequirements: [],
        nonFunctionalRequirements: [],
        userFlows: "",
        interfaces: "",
        models: "",
        errors: ""
      },
      engineeringConstraints: {
        conventions: [],
        frameworks: [],
        dependencies: [],
        security: [],
        performance: [],
        compatibility: [],
        protectedAreas: []
      },
      criteria: [],
      testStrategy: {
        existingTests: [],
        newTests: [],
        impactedSuites: [],
        manualScenarios: [],
        negativeScenarios: [],
        regressionRisks: []
      },
      implementationPlan: {
        planRevision: 0
      },
      decisionLog: {
        questions: [],
        decisions: [],
        assumptions: [],
        rejectedApproaches: [],
        revisions: []
      }
    };

    this.specifications.set(id, spec);
    this.revisions.set(id, []);
    return spec;
  }

  update(specificationId: string, patch: Partial<KeystoneSpecification>): KeystoneSpecification {
    const spec = this.specifications.get(specificationId);
    if (!spec) {
      throw new KeystoneError({
        code: "SPEC_NOT_FOUND",
        category: "INTERNAL",
        message: `Specification ${specificationId} not found.`,
        operation: "spec.update",
        recoverable: false,
        recommendedAction: "Create a new specification first."
      });
    }

    const previousStatus = spec.status;
    Object.assign(spec, patch);
    spec.revision++;

    if (previousStatus === "draft" && spec.status !== "draft") {
      spec.status = "awaiting_review";
    }

    const validated = KeystoneSpecificationSchema.safeParse(spec);
    if (!validated.success) {
      throw new KeystoneError({
        code: "SPEC_VALIDATION_FAILED",
        category: "INTERNAL",
        message: "Specification update failed validation.",
        operation: "spec.update",
        recoverable: false,
        recommendedAction: "Review the specification fields and retry."
      });
    }

    this.recordRevision(specificationId, "clarification", "Manual update");
    return spec;
  }

  approve(specificationId: string, expectedRevision: number, rationale?: string): KeystoneSpecification {
    const spec = this.specifications.get(specificationId);
    if (!spec) {
      throw new KeystoneError({
        code: "SPEC_NOT_FOUND",
        category: "INTERNAL",
        message: `Specification ${specificationId} not found.`,
        operation: "spec.approve",
        recoverable: false,
        recommendedAction: "Create a new specification first."
      });
    }

    if (spec.revision !== expectedRevision) {
      throw new KeystoneError({
        code: "SPEC_REVISION_MISMATCH",
        category: "INTERNAL",
        message: `Expected revision ${expectedRevision}, but current revision is ${spec.revision}.`,
        operation: "spec.approve",
        recoverable: false,
        recommendedAction: "Review the latest specification revision and retry."
      });
    }

    if (spec.status !== "awaiting_review") {
      throw new KeystoneError({
        code: "SPEC_NOT_APPROVABLE",
        category: "INTERNAL",
        message: `Specification ${specificationId} is not in an approvable state (${spec.status}).`,
        operation: "spec.approve",
        recoverable: false,
        recommendedAction: "Submit the specification for review first."
      });
    }

    if (spec.criteria.some((c) => c.required && !c.validationMethod)) {
      throw new KeystoneError({
        code: "SPEC_MISSING_VALIDATION",
        category: "INTERNAL",
        message: "Cannot approve: some required criteria lack a validation method.",
        operation: "spec.approve",
        recoverable: false,
        recommendedAction: "Add validation methods to all required criteria."
      });
    }

    const approval: ApprovalRecord = {
      approvedBy: "user",
      approvedAt: new Date().toISOString(),
      expectedRevision,
      rationale
    };

    spec.status = "approved";
    spec.revision++;

    this.recordRevision(specificationId, "editorial", "Specification approved.", approval);
    return spec;
  }

  reject(specificationId: string, reason: string): KeystoneSpecification {
    const spec = this.specifications.get(specificationId);
    if (!spec) {
      throw new KeystoneError({
        code: "SPEC_NOT_FOUND",
        category: "INTERNAL",
        message: `Specification ${specificationId} not found.`,
        operation: "spec.reject",
        recoverable: false,
        recommendedAction: "Create a new specification first."
      });
    }

    if (spec.status !== "awaiting_review") {
      throw new KeystoneError({
        code: "SPEC_NOT_REJECTABLE",
        category: "INTERNAL",
        message: `Specification ${specificationId} is not in a rejectable state (${spec.status}).`,
        operation: "spec.reject",
        recoverable: false,
        recommendedAction: "Submit the specification for review first."
      });
    }

    spec.status = "draft";
    spec.revision++;
    this.recordRevision(specificationId, "clarification", reason);
    return spec;
  }

  revise(specificationId: string, reason: string): SpecificationRevision {
    const spec = this.specifications.get(specificationId);
    if (!spec) {
      throw new KeystoneError({
        code: "SPEC_NOT_FOUND",
        category: "INTERNAL",
        message: `Specification ${specificationId} not found.`,
        operation: "spec.revise",
        recoverable: false,
        recommendedAction: "Create a new specification first."
      });
    }

    const revision: SpecificationRevision = {
      id: crypto.randomUUID(),
      specificationId,
      revisionNumber: spec.revision,
      snapshot: { ...spec },
      changedSectionPaths: [],
      semanticChangeClass: "editorial",
      impactedTaskIds: [],
      author: "user",
      reason
    };

    if (spec.status === "approved") {
      spec.status = "draft";
      revision.semanticChangeClass = "material";
      this.recordRevision(specificationId, "material", reason);
    }

    return revision;
  }

  generateFromIntent(
    intentId: string,
    workflowId: string,
    title: string
  ): KeystoneSpecification {
    const intent = this.intentEngine.getIntent(intentId);
    if (!intent) {
      throw new KeystoneError({
        code: "INTENT_NOT_FOUND",
        category: "INTERNAL",
        message: `Intent ${intentId} not found.`,
        operation: "spec.generateFromIntent",
        recoverable: false,
        recommendedAction: "Create an intent first before generating a specification."
      });
    }

    const spec = this.create(intentId, title, workflowId);

    spec.intent = {
      originalRequest: intent.originalText,
      normalizedIntent: intent.normalizedObjective,
      businessObjective: intent.expectedOutcome,
      outcome: intent.expectedOutcome
    };

    spec.scope.modules = intent.affectedAreas.map((a) => a.reference);
    spec.existingBehavior.constraints = intent.constraints.map((c) => c.description);
    spec.criteria = this.generateCriteria(intent, title);

    return spec;
  }

  get(specificationId: string): KeystoneSpecification | undefined {
    return this.specifications.get(specificationId);
  }

  getAll(): KeystoneSpecification[] {
    return Array.from(this.specifications.values());
  }

  getRevisions(specificationId: string): SpecificationRevision[] {
    return this.revisions.get(specificationId) ?? [];
  }

  private recordRevision(
    specificationId: string,
    semanticClass: "editorial" | "clarification" | "material",
    reason: string,
    approval?: ApprovalRecord
  ): void {
    const spec = this.specifications.get(specificationId);
    if (!spec) return;

    const revision: SpecificationRevision = {
      id: crypto.randomUUID(),
      specificationId,
      revisionNumber: spec.revision,
      snapshot: { ...spec },
      previousRevisionId: this.revisions.get(specificationId)?.[this.revisions.get(specificationId)!.length - 1]?.id,
      changedSectionPaths: [],
      semanticChangeClass: semanticClass,
      impactedTaskIds: [],
      author: "user",
      reason,
      approvalRecord: approval
    };

    const existing = this.revisions.get(specificationId) ?? [];
    existing.push(revision);
    this.revisions.set(specificationId, existing);
  }

  private generateCriteria(
    intent: IntentRecord,
    title: string
  ): AcceptanceCriterion[] {
    const criteria: AcceptanceCriterion[] = [
      {
        id: crypto.randomUUID(),
        description: `Implement ${intent.normalizedObjective}.`,
        required: true,
        sourceRequirementIds: [],
        validationMethod: "manual",
        expectedEvidenceType: "code-review",
        coveringTaskIds: [],
        result: "unverified",
        evidenceReferences: []
      },
      {
        id: crypto.randomUUID(),
        description: "The implementation does not break existing tests.",
        required: true,
        sourceRequirementIds: [],
        validationMethod: "test",
        expectedEvidenceType: "test-results",
        coveringTaskIds: [],
        result: "unverified",
        evidenceReferences: []
      }
    ];

    if (intent.expectedOutcome) {
      criteria.push({
        id: crypto.randomUUID(),
        description: intent.expectedOutcome,
        required: true,
        sourceRequirementIds: [],
        validationMethod: "manual",
        expectedEvidenceType: "code-review",
        coveringTaskIds: [],
        result: "unverified",
        evidenceReferences: []
      });
    }

    return criteria;
  }
}
