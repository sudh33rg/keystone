import { KeystoneError } from "../../shared/errors/KeystoneError";
import {
  ConsistencyCheckResultSchema,
  MigrateResultSchema,
  RelationshipViolationSchema,
  RelationshipTypeSchema,
  type ConsistencyCheckResult,
  type MigrateResult,
  type RelationshipViolation,
} from "../../shared/contracts/persistence";
import type { DevelopmentWorkflowSnapshot } from "../../shared/contracts/delegation";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { ExecutionPersistenceStore } from "./ExecutionPersistenceStore";
import type { DeliveryPersistenceStore } from "./DeliveryPersistenceStore";
import type { ReviewPersistenceStore } from "./ReviewPersistenceStore";
import type { DelegationPersistenceStore } from "./DelegationPersistenceStore";
import type { ContextPersistenceStore } from "../context/ContextPersistenceStore";
import type { OrchestrationPersistenceStore } from "./OrchestrationPersistenceStore";
import type { TeamWorkflowPersistenceStore } from "./TeamWorkflowPersistenceStore";
import type { NativeShellPersistenceStore } from "./NativeShellPersistenceStore";

/**
 * PersistenceConsistencyService validates all persistent relationships.
 */
export class PersistenceConsistencyService {
  private readonly checks: Array<() => Promise<ConsistencyCheckResult>> = [];

  constructor(
    private readonly workflows: DevelopmentWorkflowService,
    private readonly execution: ExecutionPersistenceStore,
    private readonly delivery: DeliveryPersistenceStore,
    private readonly review: ReviewPersistenceStore,
    private readonly delegation: DelegationPersistenceStore,
    private readonly context: ContextPersistenceStore,
    private readonly orchestration: OrchestrationPersistenceStore,
    private readonly team: TeamWorkflowPersistenceStore,
    private readonly native: NativeShellPersistenceStore,
  ) {
    this.registerChecks();
  }

  /**
   * Register consistency checks.
   */
  private registerChecks(): void {
    // Workflow references existing stages
    this.checks.push(() => this.checkWorkflowStages());

    // Stage references valid execution profile
    this.checks.push(() => this.checkStageExecutionProfiles());

    // Delegation references context package
    this.checks.push(() => this.checkDelegationContext());

    // Context package references current sources
    this.checks.push(() => this.checkContextSources());

    // QA cycle references change set
    this.checks.push(() => this.checkQaChangeSet());

    // Review references current evidence
    this.checks.push(() => this.checkReviewEvidence());

    // Handoff references existing records
    this.checks.push(() => this.checkHandoffReferences());

    // Change set references workflow
    this.checks.push(() => this.checkChangeSetWorkflow());

    // Commit plan references change set
    this.checks.push(() => this.checkCommitPlanChangeSet());

    // Approval references valid state
    this.checks.push(() => this.checkApprovalState());

    // Activity references valid workflow
    this.checks.push(() => this.checkActivityWorkflow());

    // Freshness record references valid source
    this.checks.push(() => this.checkFreshnessSource());

    // Rerun plan references current workflow
    this.checks.push(() => this.checkRerunPlanWorkflow());
  }

  /**
   * Run all consistency checks.
   */
  async run(): Promise<ConsistencyCheckResult> {
    const results = await Promise.all(this.checks.map((check) => check()));
    const violations = results.flatMap((r) => r.violations);
    const passed = violations.length === 0;
    return ConsistencyCheckResultSchema.parse({
      passed,
      violations,
      checkedRelationships: results.reduce((sum, r) => sum + r.checkedRelationships, 0),
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check workflow references existing stages.
   */
  private async checkWorkflowStages(): Promise<ConsistencyCheckResult> {
    const workflows = this.workflows.list();
    const violations: RelationshipViolation[] = [];

    for (const workflow of workflows) {
      for (const stage of workflow.stages) {
        if (!stage.stageId) continue;
        if (!this.workflows.getStageState(workflow.id, stage.stageId)) {
          violations.push({
            type: "workflow-references-existing-stages",
            leftId: workflow.id,
            leftType: "workflow",
            rightId: stage.stageId,
            rightType: "stage",
            message: `Stage ${stage.stageId} does not exist in workflow ${workflow.id}.`,
            severity: "error",
          });
        }
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: workflows.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check stage references valid execution profile.
   */
  private async checkStageExecutionProfiles(): Promise<ConsistencyCheckResult> {
    const workflows = this.workflows.list();
    const violations: RelationshipViolation[] = [];

    for (const workflow of workflows) {
      for (const stage of workflow.stages) {
        if (!stage.executionProfileId) continue;
        if (!this.workflows.getExecutionProfile(stage.executionProfileId)) {
          violations.push({
            type: "stage-references-valid-execution-profile",
            leftId: workflow.id,
            leftType: "workflow",
            rightId: stage.executionProfileId,
            rightType: "execution-profile",
            message: `Stage ${stage.stageId} references non-existent execution profile ${stage.executionProfileId}.`,
            severity: "error",
          });
        }
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: workflows.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check delegation references context package.
   */
  private async checkDelegationContext(): Promise<ConsistencyCheckResult> {
    const sessions = this.execution.snapshot.sessions;
    const violations: RelationshipViolation[] = [];

    for (const session of sessions) {
      if (!session.contextPackageId) continue;
      const context = this.context.get(session.contextPackageId);
      if (!context) {
        violations.push({
          type: "delegation-references-context-package",
          leftId: session.id,
          leftType: "delegation-session",
          rightId: session.contextPackageId,
          rightType: "context-package",
          message: `Delegation session ${session.id} references non-existent context package ${session.contextPackageId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: sessions.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check context package references current sources.
   */
  private async checkContextSources(): Promise<ConsistencyCheckResult> {
    const packages = this.context.getAllPackages();
    const violations: RelationshipViolation[] = [];

    for (const package of packages) {
      if (!package.contentFingerprint) continue;
      const snapshot = this.native.snapshot.intelligence();
      if (!snapshot || snapshot.status !== "ready") {
        continue; // Can't validate without intelligence
      }
      // Check if referenced files still exist
      for (const item of package.items) {
        if (item.sourceReference.filePath) {
          const file = snapshot.files.find((f) => f.relativePath === item.sourceReference.filePath);
          if (!file) {
            violations.push({
              type: "context-package-references-current-sources",
              leftId: package.id,
              leftType: "context-package",
              rightId: item.sourceReference.filePath,
              rightType: "source-file",
              message: `Context package ${package.id} references file ${item.sourceReference.filePath} that no longer exists.`,
              severity: "warning",
            });
          }
        }
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: packages.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check QA cycle references change set.
   */
  private async checkQaChangeSet(): Promise<ConsistencyCheckResult> {
    const sessions = this.execution.snapshot.sessions;
    const violations: RelationshipViolation[] = [];

    for (const session of sessions) {
      if (!session.workflowId) continue;
      const changeSet = this.delivery.snapshot.changeSets.find((cs) => cs.workflowId === session.workflowId);
      if (!changeSet && session.workflowId) {
        violations.push({
          type: "qa-cycle-references-change-set",
          leftId: session.validationPlanId,
          leftType: "validation-plan",
          rightId: session.workflowId,
          rightType: "change-set",
          message: `QA plan ${session.validationPlanId} references workflow ${session.workflowId} without a change set.`,
          severity: "warning",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: sessions.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check review references current evidence.
   */
  private async checkReviewEvidence(): Promise<ConsistencyCheckResult> {
    const workflows = this.workflows.list();
    const violations: RelationshipViolation[] = [];

    for (const workflow of workflows) {
      for (const finding of this.review.getState(workflow.id)?.findings ?? []) {
        if (!finding.evidenceIds?.length) continue;
        for (const evidenceId of finding.evidenceIds) {
          if (!this.review.getPersistentEvidence(evidenceId)) {
            violations.push({
              type: "review-references-current-evidence",
              leftId: finding.id,
              leftType: "review-finding",
              rightId: evidenceId,
              rightType: "evidence",
              message: `Review finding ${finding.id} references non-existent evidence ${evidenceId}.`,
              severity: "warning",
            });
          }
        }
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: workflows.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check handoff references existing records.
   */
  private async checkHandoffReferences(): Promise<ConsistencyCheckResult> {
    const imports = this.team.snapshot.imports;
    const violations: RelationshipViolation[] = [];

    for (const importRecord of imports) {
      if (!importRecord.workflowId) continue;
      const workflow = this.workflows.list().find((w) => w.id === importRecord.workflowId);
      if (!workflow) {
        violations.push({
          type: "handoff-references-existing-records",
          leftId: importRecord.id,
          leftType: "handoff-import",
          rightId: importRecord.workflowId,
          rightType: "workflow",
          message: `Handoff import ${importRecord.id} references non-existent workflow ${importRecord.workflowId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: imports.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check change set references workflow.
   */
  private async checkChangeSetWorkflow(): Promise<ConsistencyCheckResult> {
    const changeSets = this.delivery.snapshot.changeSets;
    const violations: RelationshipViolation[] = [];

    for (const changeSet of changeSets) {
      if (!changeSet.workflowId) continue;
      const workflow = this.workflows.list().find((w) => w.id === changeSet.workflowId);
      if (!workflow) {
        violations.push({
          type: "change-set-references-workflow",
          leftId: changeSet.id,
          leftType: "change-set",
          rightId: changeSet.workflowId,
          rightType: "workflow",
          message: `Change set ${changeSet.id} references non-existent workflow ${changeSet.workflowId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: changeSets.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check commit plan references change set.
   */
  private async checkCommitPlanChangeSet(): Promise<ConsistencyCheckResult> {
    const plans = this.delivery.snapshot.commitPlans;
    const violations: RelationshipViolation[] = [];

    for (const plan of plans) {
      if (!plan.changeSetId) continue;
      const changeSet = this.delivery.snapshot.changeSets.find((cs) => cs.id === plan.changeSetId);
      if (!changeSet) {
        violations.push({
          type: "commit-plan-references-change-set",
          leftId: plan.id,
          leftType: "commit-plan",
          rightId: plan.changeSetId,
          rightType: "change-set",
          message: `Commit plan ${plan.id} references non-existent change set ${plan.changeSetId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: plans.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check approval references valid state.
   */
  private async checkApprovalState(): Promise<ConsistencyCheckResult> {
    const approvals = this.delegation.snapshot.approvals;
    const violations: RelationshipViolation[] = [];

    for (const approval of approvals) {
      if (!approval.workflowId) continue;
      const workflow = this.workflows.list().find((w) => w.id === approval.workflowId);
      if (!workflow) {
        violations.push({
          type: "approval-references-valid-state",
          leftId: approval.id,
          leftType: "approval",
          rightId: approval.workflowId,
          rightType: "workflow",
          message: `Approval ${approval.id} references non-existent workflow ${approval.workflowId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: approvals.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check activity references valid workflow.
   */
  private async checkActivityWorkflow(): Promise<ConsistencyCheckResult> {
    const activities = this.execution.snapshot.sessions.flatMap((s) => s.validationRunIds ?? []);
    const violations: RelationshipViolation[] = [];

    for (const runId of activities) {
      const run = this.execution.snapshot.runs.find((r) => r.id === runId);
      if (!run) {
        violations.push({
          type: "activity-references-valid-workflow",
          leftId: runId,
          leftType: "validation-run",
          rightId: undefined,
          rightType: undefined,
          message: `Validation run ${runId} does not exist.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: activities.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check freshness record references valid source.
   */
  private async checkFreshnessSource(): Promise<ConsistencyCheckResult> {
    const records = this.native.snapshot.freshnessRecords ?? [];
    const violations: RelationshipViolation[] = [];

    for (const record of records) {
      if (!record.recordId) continue;
      const source = this.native.snapshot.intelligence();
      if (!source || source.status !== "ready") {
        continue;
      }
      // Check if referenced record still exists
      if (record.recordType === "specification") {
        const spec = this.workflows.list().find((w) => w.specificationId === record.recordId);
        if (!spec) {
          violations.push({
            type: "freshness-record-references-valid-source",
            leftId: record.id,
            leftType: "freshness-record",
            rightId: record.recordId,
            rightType: "specification",
            message: `Freshness record ${record.id} references non-existent specification ${record.recordId}.`,
            severity: "warning",
          });
        }
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: records.length,
      checkedAt: new Date().toISOString(),
    });
  }

  /**
   * Check rerun plan references current workflow.
   */
  private async checkRerunPlanWorkflow(): Promise<ConsistencyCheckResult> {
    const plans = this.execution.snapshot.retries ?? [];
    const violations: RelationshipViolation[] = [];

    for (const plan of plans) {
      if (!plan.workflowId) continue;
      const workflow = this.workflows.list().find((w) => w.id === plan.workflowId);
      if (!workflow) {
        violations.push({
          type: "rerun-plan-references-current-workflow",
          leftId: plan.id,
          leftType: "rerun-plan",
          rightId: plan.workflowId,
          rightType: "workflow",
          message: `Rerun plan ${plan.id} references non-existent workflow ${plan.workflowId}.`,
          severity: "error",
        });
      }
    }

    return ConsistencyCheckResultSchema.parse({
      passed: violations.length === 0,
      violations,
      checkedRelationships: plans.length,
      checkedAt: new Date().toISOString(),
    });
  }
}
