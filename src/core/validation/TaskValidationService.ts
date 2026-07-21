import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";
import type { ExecutionPersistenceStore } from "../persistence/ExecutionPersistenceStore";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { TaskExecutionService } from "../execution/TaskExecutionService";
import {
  CommandDescriptorSchema,
  CriterionResultSchema,
  OverrideAuditSchema,
  ValidationEvidenceSchema,
  ValidationPlanSchema,
  ValidationRunSchemaV2,
  ValidationStepResultSchema,
  ValidationStepSchema,
  type CommandDescriptor,
  type TaskExecutionSession,
  type ValidationEvidence,
  type ValidationFinding,
  type ValidationPlan,
  type ValidationRunV2,
  type ValidationStep,
  type ValidationStepType,
} from "../../shared/contracts/execution";
import type { DevelopmentSpecification } from "../../shared/contracts/delegation";
import {
  BuildValidationProvider,
  LintValidationProvider,
  PerformanceValidationProvider,
  SecurityValidationProvider,
  SpecificationConformanceService,
  StaticValidationProvider,
  TestImpactService,
  TestValidationProvider,
  TypeCheckValidationProvider,
  ValidationEvidenceService,
  ValidationFindingService,
  type ProviderResult,
  type RepositoryCommandValidationProvider,
} from "./ValidationProviders";
import { commandFingerprint, failureFingerprint } from "../execution/ExecutionAnalysisServices";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";

export interface CommandExecutionResult {
  exitCode: number;
  outputTail: string;
  errorTail: string;
  outputTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
  cancelled: boolean;
}

const terminationTimers = new WeakMap<ChildProcess, NodeJS.Timeout>();

export class CommandExecutionService {
  private readonly active = new Map<string, ChildProcess>();
  constructor(private readonly allowedWorkingDirectories: string[] = []) {}

  async execute(
    id: string,
    descriptor: CommandDescriptor,
    signal?: AbortSignal,
    progress?: (message: string) => void,
  ): Promise<CommandExecutionResult> {
    const command = CommandDescriptorSchema.parse(descriptor);
    this.validate(command);
    const started = performance.now();
    let timedOut = false;
    let cancelled = false;
    const stdout = new BoundedSanitizedOutput(progress);
    const stderr = new BoundedSanitizedOutput(progress);
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command.executable, command.args, {
        cwd: command.workingDirectory,
        env: safeEnvironment(),
        shell: false,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.active.set(id, child);
      child.stdout?.on("data", (chunk: Buffer) => stdout.append(chunk));
      child.stderr?.on("data", (chunk: Buffer) => stderr.append(chunk));
      const terminate = (): void => terminateTree(child);
      const abort = (): void => {
        cancelled = true;
        terminate();
      };
      signal?.addEventListener("abort", abort, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, command.timeoutMs);
      child.once("error", (cause) => {
        clearTimeout(timeout);
        clearTermination(child);
        signal?.removeEventListener("abort", abort);
        this.active.delete(id);
        reject(cause);
      });
      child.once("close", (code) => {
        clearTimeout(timeout);
        clearTermination(child);
        signal?.removeEventListener("abort", abort);
        this.active.delete(id);
        const output = stdout.finish();
        const error = stderr.finish();
        resolvePromise({
          exitCode: code ?? -1,
          outputTail: output.value,
          errorTail: error.value,
          outputTruncated: output.truncated || error.truncated,
          durationMs: performance.now() - started,
          timedOut,
          cancelled,
        });
      });
    });
  }

  cancel(id: string): void {
    const child = this.active.get(id);
    if (child) terminateTree(child);
  }

  private validate(command: CommandDescriptor): void {
    if (command.safety === "prohibited")
      throw new Error("Prohibited validation commands cannot execute.");
    if (command.safety === "potentially-mutating" && !command.approved)
      throw new Error("Potentially mutating command requires explicit approval.");
    const normalized = `${command.executable} ${command.args.join(" ")}`.toLowerCase();
    if (
      /(?:^|\s)(?:publish|deploy|push|login)(?:\s|$)|migrate\s+deploy|production/.test(normalized)
    )
      throw new Error(
        "Deployment, publishing, remote push, login, and production migration commands are prohibited.",
      );
    if (command.args.some((item) => /[\0\r\n]/.test(item)))
      throw new Error("Command arguments may not contain control separators.");
    if (this.allowedWorkingDirectories.length) {
      const cwd = resolve(command.workingDirectory);
      if (
        !this.allowedWorkingDirectories.some((root) => {
          const boundary = resolve(root);
          return cwd === boundary || cwd.startsWith(`${boundary}${sep}`);
        })
      )
        throw new Error("Validation working directory is outside the workspace.");
    }
  }
}

export interface ValidationPlanOptions {
  testMode?: ValidationPlan["testMode"];
  excludedTestEntityIds?: string[];
}

export class ValidationPlanner {
  readonly testImpact: TestImpactService;
  private readonly commandProviders: RepositoryCommandValidationProvider[] = [
    new TypeCheckValidationProvider(),
    new LintValidationProvider(),
    new TestValidationProvider(),
    new BuildValidationProvider(),
  ];

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly workflows: DevelopmentWorkflowService,
  ) {
    this.testImpact = new TestImpactService(snapshots);
  }

  async plan(
    session: TaskExecutionSession,
    options: ValidationPlanOptions = {},
  ): Promise<ValidationPlan> {
    const snapshot = this.snapshots.getSnapshot();
    if (!snapshot) throw new Error("Current intelligence is required for validation planning.");
    const workflow = this.workflows.get(session.workflowId);
    const task = workflow?.tasks.find((item) => item.id === session.taskId);
    const specification = workflow?.specification;
    if (!workflow || !task || !specification) throw new Error("Task/specification unavailable.");
    if (specification.revision !== session.specificationRevision)
      throw new Error(
        "Specification changed during execution; validation requires explicit migration or a new execution.",
      );
    const root = this.workspace.getRoots()[0];
    if (!root) throw new Error("A workspace root is required.");
    const cwd = root.uri.startsWith("file:") ? fileURLToPath(root.uri) : root.uri;
    const scopePaths = unique([
      ...session.expectedFiles,
      ...session.observedChanges.map((item) => item.relativePath),
    ]).slice(0, 5000);
    const criteria = specification.acceptanceCriteria
      .filter((item) => task.acceptanceCriterionIds.includes(item.id))
      .map((item) => item.id);
    const steps: ValidationStep[] = [];
    const add = (
      type: ValidationStepType,
      description: string,
      required: boolean,
      criterionIds: string[],
      provider: string,
      command?: CommandDescriptor,
      paths: string[] = scopePaths,
    ): string => {
      const id = crypto.randomUUID();
      const effectivePaths = command ? ["*"] : paths;
      steps.push(
        ValidationStepSchema.parse({
          id,
          type,
          description,
          provider,
          ...(command ? { command } : {}),
          dependencies: [],
          required,
          expectedEvidence: command
            ? "Bounded sanitized process output and exit status."
            : "Canonical repository/change evidence.",
          acceptanceCriterionIds: criterionIds,
          scopePaths: effectivePaths,
          inputFingerprint: validationFingerprint(snapshot, effectivePaths),
          status: command?.safety === "potentially-mutating" ? "pending" : "approved",
        }),
      );
      return id;
    };
    add(
      "repository-diff",
      "Review attributed repository changes against the baseline.",
      true,
      criteria,
      "RepositoryChangeDetector",
    );
    add(
      "expected-file-change",
      "Confirm approved expected changes or explicit task evidence exists.",
      true,
      criteria,
      "SpecificationConformanceService",
    );
    add(
      "unexpected-file-change",
      "Block unresolved unexpected changes.",
      true,
      criteria,
      "SpecificationConformanceService",
    );
    const discovered = await discoverCommands(this.workspace, snapshot, cwd, this.commandProviders);
    for (const item of discovered.filter((item) => item.type !== "unit-test"))
      add(
        item.type,
        item.description,
        item.required,
        criteriaForType(specification, criteria, item.type),
        item.provider,
        item.command,
      );
    const testMode = options.testMode ?? "impacted";
    const testSelections = this.testImpact.select(session, options.excludedTestEntityIds);
    const selectedPaths = unique(
      testSelections.filter((item) => item.selected).map((item) => item.relativePath),
    );
    const unit = discovered.find((item) => item.type === "unit-test");
    if (unit && testMode === "impacted" && selectedPaths.length) {
      const command = CommandDescriptorSchema.parse({
        ...unit.command,
        args: [...unit.command.args, "--", ...selectedPaths.slice(0, 30)],
      });
      add(
        "impacted-test",
        `Run ${selectedPaths.length} evidence-selected impacted test file(s).`,
        true,
        criteriaForType(specification, criteria, "impacted-test"),
        "TestImpactService",
        command,
      );
    } else if (unit) {
      add(
        "unit-test",
        testMode === "affected-suite"
          ? "Run the repository unit-test suite because no framework-safe affected-suite selector is declared."
          : testMode === "impacted"
            ? "Run the repository unit-test suite because no precise impacted-test selection is available."
            : unit.description,
        true,
        criteriaForType(specification, criteria, "unit-test"),
        unit.provider,
        unit.command,
      );
    }
    add(
      "changed-symbol",
      "Resolve changed symbols, signatures, routes, contracts, schemas, configuration, tests, build, and infrastructure entities.",
      true,
      criteria,
      "ChangedEntityResolver",
    );
    add(
      "static-analysis",
      "Inspect introduced changed-scope canonical diagnostics.",
      true,
      criteria,
      "StaticValidationProvider",
    );
    add(
      "specification-conformance",
      "Compare attributed changes with approved scope, exclusions, constraints, and required evidence.",
      true,
      criteria,
      "SpecificationConformanceService",
    );
    if (session.changedEntities.some((item) => item.changeKind === "contract-change"))
      add(
        "contract-validation",
        "Validate changed contract entities and unresolved contract diagnostics.",
        true,
        criteria,
        "StaticValidationProvider",
      );
    if (session.changedEntities.some((item) => item.changeKind === "schema-change"))
      add(
        "schema-validation",
        "Validate changed schema/ORM entities and unresolved mappings.",
        true,
        criteria,
        "StaticValidationProvider",
      );
    add(
      "architecture-rule",
      "Check changed scope for evidence-backed architecture violations.",
      false,
      criteriaForType(specification, criteria, "architecture-rule"),
      "StaticValidationProvider",
    );
    const securityRequired =
      workflow.intent.category === "security" || workflow.intent.risk === "critical";
    add(
      "security-check",
      "Run bounded deterministic changed-scope CPG security checks when supported.",
      securityRequired,
      securityRequired ? criteria : [],
      "SecurityValidationProvider",
    );
    const performanceRequired =
      workflow.intent.category === "performance" ||
      specification.testStrategy.risks.some((item) => /performance/i.test(item));
    add(
      "performance-check",
      "Report deterministic complexity candidates without claiming runtime performance.",
      performanceRequired,
      performanceRequired ? criteria : [],
      "PerformanceValidationProvider",
    );
    for (const criterion of specification.acceptanceCriteria.filter((item) =>
      criteria.includes(item.id),
    )) {
      if (
        !steps.some((step) => step.required && step.acceptanceCriterionIds.includes(criterion.id))
      )
        add(
          "manual-review",
          `Manual verification required for ${criterion.id}: ${criterion.validationMethod}`,
          true,
          [criterion.id],
          "AcceptanceCriteriaValidator",
        );
    }
    if (!steps.some((step) => step.command))
      add(
        "manual-review",
        "No repository validation command was discovered; explicit manual evidence is required.",
        true,
        criteria,
        "AcceptanceCriteriaValidator",
      );
    const mappings = criteria.map((criterionId) => ({
      criterionId,
      stepIds: steps
        .filter((step) => step.required && step.acceptanceCriterionIds.includes(criterionId))
        .map((step) => step.id),
    }));
    return ValidationPlanSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      taskId: task.id,
      executionSessionId: session.id,
      testMode,
      testSelections,
      steps,
      acceptanceCriteriaMappings: mappings,
      repositoryGeneration: snapshot.manifest.generation,
      repositoryFingerprint: validationFingerprint(snapshot, scopePaths),
      createdAt: new Date().toISOString(),
      diagnostics: [
        ...(discovered.length
          ? []
          : [
              "No safe repository validation commands were discovered; required criteria need manual evidence.",
            ]),
        ...(testSelections.some((item) => item.tier === "naming-candidate")
          ? [
              "Naming-only test candidates remain unselected unless the user explicitly includes them.",
            ]
          : []),
        ...(testMode === "affected-suite" && unit
          ? [
              "No framework-declared affected-suite selector was available; the configured repository unit-test suite is used without claiming narrower selection.",
            ]
          : []),
        ...(testMode === "impacted" && unit && !selectedPaths.length
          ? [
              "No precise impacted-test mapping was available; the configured repository unit-test suite is used as a conservative fallback.",
            ]
          : []),
      ],
    });
  }
}

export class AcceptanceCriteriaValidator {
  evaluate(
    plan: ValidationPlan,
    results: ValidationRunV2["stepResults"],
    evidence: ValidationEvidence[],
  ): ValidationRunV2["acceptanceCriteriaResults"] {
    return plan.acceptanceCriteriaMappings.map((mapping) => {
      const mapped = mapping.stepIds.map((id) => results.find((result) => result.stepId === id));
      const manual = plan.steps.some(
        (step) => mapping.stepIds.includes(step.id) && step.type === "manual-review",
      );
      const status = mapped.some((result) => result?.status === "failed")
        ? "failed"
        : mapped.some((result) => result?.status === "stale")
          ? "not-verifiable"
          : manual && mapped.some((result) => result?.status !== "passed")
            ? "requires-manual-review"
            : mapped.some(
                  (result) =>
                    !result || result.status === "skipped" || result.status === "cancelled",
                )
              ? "not-run"
              : mapped.length && mapped.every((result) => result?.status === "passed")
                ? "passed"
                : "not-verifiable";
      return CriterionResultSchema.parse({
        criterionId: mapping.criterionId,
        status,
        stepIds: mapping.stepIds,
        evidenceIds: evidence
          .filter(
            (item) =>
              item.source.includes(mapping.criterionId) ||
              mapping.stepIds.some((id) => item.source.includes(id)),
          )
          .map((item) => item.id),
        explanation:
          status === "passed"
            ? "All mapped required validation steps passed with evidence."
            : status === "failed"
              ? "At least one mapped required step failed."
              : status === "requires-manual-review"
                ? "The approved validation method requires explicit manual evidence."
                : status === "not-verifiable"
                  ? "Mapped evidence is stale or insufficient for verification."
                  : "Required validation evidence was not run.",
      });
    });
  }
}

export class ValidationStepExecutor {
  readonly staticValidation: StaticValidationProvider;
  readonly security: SecurityValidationProvider;
  readonly performance: PerformanceValidationProvider;
  readonly conformance: SpecificationConformanceService;
  readonly evidence = new ValidationEvidenceService();
  readonly findings = new ValidationFindingService();

  constructor(
    readonly commands: CommandExecutionService,
    private readonly snapshots: IntelligenceSnapshotReader,
  ) {
    this.staticValidation = new StaticValidationProvider(snapshots);
    this.security = new SecurityValidationProvider(snapshots);
    this.performance = new PerformanceValidationProvider(snapshots);
    this.conformance = new SpecificationConformanceService();
  }

  async execute(
    step: ValidationStep,
    session: TaskExecutionSession,
    specification: DevelopmentSpecification,
    signal: AbortSignal,
    progress: (output: string) => void,
  ): Promise<{
    result: ValidationRunV2["stepResults"][number];
    evidence: ValidationEvidence[];
    findings: ValidationFinding[];
  }> {
    const started = new Date();
    let status: ValidationRunV2["stepResults"][number]["status"];
    let exitCode: number | undefined;
    let outputTail = "";
    let errorTail = "";
    let outputTruncated = false;
    let evidence: ValidationEvidence[] = [];
    let findings: ValidationFinding[] = [];
    if (step.command) {
      if (step.command.safety === "potentially-mutating" && !step.command.approved) {
        status = "skipped";
        errorTail = "Explicit approval required.";
      } else {
        const value = await this.commands.execute(step.id, step.command, signal, progress);
        exitCode = value.exitCode;
        outputTail = value.outputTail;
        errorTail = value.errorTail;
        outputTruncated = value.outputTruncated;
        status = value.cancelled
          ? "cancelled"
          : value.exitCode === 0 && !value.timedOut
            ? "passed"
            : "failed";
        if (value.timedOut)
          errorTail = `${errorTail}\nCommand exceeded ${step.command.timeoutMs} ms.`.trim();
      }
    } else {
      const providerResult = await this.executeProvider(step, session, specification);
      status = providerResult.status;
      outputTail = providerResult.output;
      evidence = providerResult.evidence;
      findings = providerResult.findings;
    }
    if (!evidence.length) {
      evidence = [
        this.evidence.create({
          kind: step.command
            ? step.type.includes("test")
              ? "test-output"
              : "build-output"
            : step.type === "manual-review"
              ? "user-verification"
              : "git-diff",
          source: `validation-step:${step.id}:${step.acceptanceCriterionIds.join(",")}`,
          reliability: step.command
            ? "observed"
            : step.type === "manual-review"
              ? "manual"
              : "exact",
          summary: step.command
            ? `${step.description}: exit ${exitCode ?? "not-run"}; ${outputTail.slice(-1000)} ${errorTail.slice(-1000)}`
            : `${step.description}: ${status}; ${outputTail.slice(-2000)}`,
        }),
      ];
    }
    if (status === "failed" && !findings.length) {
      findings.push(
        this.findings.create({
          title: `${step.description} failed`,
          description:
            errorTail || outputTail || "Required deterministic evidence was not satisfied.",
          severity: step.required ? "blocking" : "warning",
          category: category(step.type),
          relatedEntityIds: session.expectedEntityIds,
          acceptanceCriterionIds: step.acceptanceCriterionIds,
          evidenceIds: evidence.map((item) => item.id),
          suggestedAction: "Review the evidence, repair the scoped issue, and rerun validation.",
          retryRelevant: true,
        }),
      );
    }
    const completed = new Date();
    return {
      result: ValidationStepResultSchema.parse({
        stepId: step.id,
        status,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: completed.getTime() - started.getTime(),
        ...(exitCode !== undefined ? { exitCode } : {}),
        outputTail,
        errorTail,
        outputTruncated,
        evidenceIds: evidence.map((item) => item.id),
        baselineClassification: classifyBaseline(session, step, status, outputTail, errorTail),
      }),
      evidence,
      findings,
    };
  }

  private async executeProvider(
    step: ValidationStep,
    session: TaskExecutionSession,
    specification: DevelopmentSpecification,
  ): Promise<ProviderResult> {
    if (step.type === "repository-diff")
      return simpleProvider(
        session.observedChanges.length > 0,
        `${session.observedChanges.length} repository change(s) observed.`,
      );
    if (step.type === "expected-file-change")
      return simpleProvider(
        session.observedChanges.some((item) =>
          ["expected", "related"].includes(item.classification),
        ) ||
          session.expectedEntityIds.some((id) =>
            session.changedEntities.some((item) => item.entityId === id),
          ),
        "Expected file/entity change evidence checked.",
      );
    if (step.type === "unexpected-file-change") {
      const invalid = session.observedChanges.some(
        (item) => ["unexpected", "ambiguous"].includes(item.classification) && !item.userOverride,
      );
      return simpleProvider(!invalid, "Unexpected change attribution checked.");
    }
    if (step.type === "changed-symbol")
      return simpleProvider(
        session.changedEntities.length > 0 || !session.observedChanges.length,
        session.changedEntities
          .slice(0, 500)
          .map((item) => `${item.changeKind} ${item.entityType} ${item.qualifiedName}`)
          .join("\n") || "No repository change required semantic mapping.",
      );
    if (
      ["static-analysis", "architecture-rule", "contract-validation", "schema-validation"].includes(
        step.type,
      )
    )
      return this.staticValidation.validate(session, step);
    if (step.type === "specification-conformance")
      return this.conformance.validate(session, specification, step);
    if (step.type === "security-check") return this.security.validate(session, step);
    if (step.type === "performance-check") return this.performance.validate(session, step);
    if (step.type === "manual-review" || step.type === "runtime-verification")
      return {
        status: "skipped",
        output: "Explicit user evidence is required.",
        evidence: [],
        findings: [],
      };
    return {
      status: "skipped",
      output: `No deterministic provider is available for ${step.type}.`,
      evidence: [],
      findings: [],
    };
  }
}

export class ValidationOrchestrator {
  readonly planner: ValidationPlanner;
  readonly commands: CommandExecutionService;
  readonly criteria = new AcceptanceCriteriaValidator();
  readonly executor: ValidationStepExecutor;
  private readonly controllers = new Map<string, AbortController>();

  constructor(
    private readonly persistence: ExecutionPersistenceStore,
    private readonly executions: TaskExecutionService,
    workspace: WorkspaceAdapter,
    private readonly snapshots: IntelligenceSnapshotReader,
    private readonly workflows: DevelopmentWorkflowService,
  ) {
    this.planner = new ValidationPlanner(workspace, snapshots, workflows);
    this.commands = new CommandExecutionService(
      workspace.getRoots().flatMap((item) => {
        try {
          return [item.uri.startsWith("file:") ? fileURLToPath(item.uri) : item.uri];
        } catch {
          return [];
        }
      }),
    );
    this.executor = new ValidationStepExecutor(this.commands, snapshots);
  }

  getPlan(id: string): ValidationPlan | undefined {
    return this.persistence.snapshot.plans.find((item) => item.id === id);
  }

  getRun(id: string): ValidationRunV2 | undefined {
    return this.persistence.snapshot.runs.find((item) => item.id === id);
  }

  async plan(sessionId: string, options: ValidationPlanOptions = {}): Promise<ValidationPlan> {
    const session = this.executions.get(sessionId);
    if (!session || session.status !== "result-captured")
      throw new Error("Result capture is required before validation planning.");
    await this.executions.sessions.transition(sessionId, "planning-validation");
    const plan = await this.planner.plan(session, options);
    await this.persistence.update((state) => ({
      ...state,
      plans: [...state.plans.filter((item) => item.executionSessionId !== sessionId), plan].slice(
        -500,
      ),
    }));
    await this.executions.sessions.replace(sessionId, {
      validationPlanId: plan.id,
      metrics: {
        ...session.metrics,
        testsSelected: plan.testSelections.filter((item) => item.selected).length,
      },
    });
    return plan;
  }

  async approveCommand(planId: string, stepId: string): Promise<ValidationPlan> {
    let output: ValidationPlan | undefined;
    await this.persistence.update((state) => ({
      ...state,
      plans: state.plans.map((plan) => {
        if (plan.id !== planId) return plan;
        output = ValidationPlanSchema.parse({
          ...plan,
          steps: plan.steps.map((step) =>
            step.id === stepId && step.command
              ? {
                  ...step,
                  command: { ...step.command, approved: true },
                  status: "approved",
                }
              : step,
          ),
        });
        return output;
      }),
    }));
    if (!output) throw new Error("Validation plan not found.");
    return output;
  }

  async updatePlan(planId: string, options: ValidationPlanOptions): Promise<ValidationPlan> {
    const current = this.getPlan(planId);
    const session = current && this.executions.get(current.executionSessionId);
    if (!current || !session) throw new Error("Validation plan not found.");
    const rebuilt = await this.planner.plan(session, options);
    const output = ValidationPlanSchema.parse({ ...rebuilt, id: current.id });
    await this.persistence.update((state) => ({
      ...state,
      plans: state.plans.map((item) => (item.id === planId ? output : item)),
    }));
    return output;
  }

  async run(
    planId: string,
    progress?: (step: ValidationStep, index: number, total: number, output?: string) => void,
    onStarted?: (runId: string) => void,
    onlyStepId?: string,
  ): Promise<ValidationRunV2> {
    const plan = this.getPlan(planId);
    if (!plan) throw new Error("Validation plan not found.");
    const session = this.executions.get(plan.executionSessionId);
    if (!session) throw new Error("Execution session not found.");
    const workflow = this.workflows.get(session.workflowId);
    const specification = workflow?.specification;
    if (!specification || specification.revision !== session.specificationRevision)
      throw new Error("Specification revision changed during execution.");
    const controller = new AbortController();
    const runId = crypto.randomUUID();
    this.controllers.set(runId, controller);
    onStarted?.(runId);
    await this.executions.sessions.transition(session.id, "validating");
    const startedAt = new Date().toISOString();
    const stepResults: ValidationRunV2["stepResults"] = [];
    const evidence: ValidationEvidence[] = [];
    const findings: ValidationFinding[] = [];
    await this.saveRun(
      ValidationRunSchemaV2.parse({
        schemaVersion: 1,
        id: runId,
        executionSessionId: session.id,
        taskId: session.taskId,
        status: "running",
        startedAt,
        stepResults: [],
        acceptanceCriteriaResults: [],
        findings: [],
        evidence: [],
        summary: emptySummary(plan),
        repositoryGeneration: plan.repositoryGeneration,
        repositoryFingerprint: plan.repositoryFingerprint,
        diagnostics: [],
      }),
    );
    try {
      const prior = this.latestReusableRun(plan, runId);
      for (let index = 0; index < plan.steps.length; index++) {
        const step = plan.steps[index]!;
        controller.signal.throwIfAborted();
        const current = this.snapshots.getSnapshot();
        const currentFingerprint = current
          ? validationFingerprint(current, step.scopePaths)
          : "intelligence-unavailable";
        const cached = prior?.stepResults.find(
          (item) => item.stepId === step.id && item.status === "passed",
        );
        if (step.id !== onlyStepId && cached && currentFingerprint === step.inputFingerprint) {
          stepResults.push(ValidationStepResultSchema.parse({ ...cached, reused: true }));
          evidence.push(...prior!.evidence.filter((item) => cached.evidenceIds.includes(item.id)));
          progress?.(step, index + 1, plan.steps.length, "Reused current fingerprint evidence.");
          continue;
        }
        if (onlyStepId && step.id !== onlyStepId) {
          const previous = prior?.stepResults.find((item) => item.stepId === step.id);
          if (previous && currentFingerprint === step.inputFingerprint) {
            stepResults.push(ValidationStepResultSchema.parse({ ...previous, reused: true }));
            evidence.push(
              ...(prior?.evidence.filter((item) => previous.evidenceIds.includes(item.id)) ?? []),
            );
            continue;
          }
        }
        progress?.(step, index, plan.steps.length);
        const executed = await this.executor.execute(
          step,
          session,
          specification,
          controller.signal,
          (output) => progress?.(step, index, plan.steps.length, output),
        );
        const after = this.snapshots.getSnapshot();
        const afterFingerprint = after
          ? validationFingerprint(after, step.scopePaths)
          : "intelligence-unavailable";
        const result =
          afterFingerprint === step.inputFingerprint
            ? executed.result
            : ValidationStepResultSchema.parse({
                ...executed.result,
                status: "stale",
              });
        stepResults.push(result);
        evidence.push(...executed.evidence);
        findings.push(...executed.findings);
        await this.saveRun(
          ValidationRunSchemaV2.parse({
            schemaVersion: 1,
            id: runId,
            executionSessionId: session.id,
            taskId: session.taskId,
            status: "running",
            startedAt,
            stepResults,
            acceptanceCriteriaResults: this.criteria.evaluate(plan, stepResults, evidence),
            findings,
            evidence,
            summary: summary(plan, stepResults, [], findings, session),
            repositoryGeneration: plan.repositoryGeneration,
            repositoryFingerprint: plan.repositoryFingerprint,
            diagnostics: [],
          }),
        );
        progress?.(step, index + 1, plan.steps.length);
      }
      const criterionResults = this.criteria.evaluate(plan, stepResults, evidence);
      const required = new Set(plan.steps.filter((item) => item.required).map((item) => item.id));
      const requiredFailed = stepResults.some(
        (item) => required.has(item.stepId) && item.status === "failed",
      );
      const requiredStale = stepResults.some(
        (item) => required.has(item.stepId) && item.status === "stale",
      );
      const review = criterionResults.some((item) =>
        ["requires-manual-review", "not-run", "not-verifiable"].includes(item.status),
      );
      const blocking = findings.some((item) => item.severity === "blocking" && !item.override);
      const status: ValidationRunV2["status"] = requiredStale
        ? "stale"
        : requiredFailed || blocking || criterionResults.some((item) => item.status === "failed")
          ? "failed"
          : review
            ? "awaiting-user-review"
            : "passed";
      const run = ValidationRunSchemaV2.parse({
        schemaVersion: 1,
        id: runId,
        executionSessionId: session.id,
        taskId: session.taskId,
        status,
        startedAt,
        completedAt: new Date().toISOString(),
        stepResults,
        acceptanceCriteriaResults: criterionResults,
        findings,
        evidence,
        summary: summary(plan, stepResults, criterionResults, findings, session),
        repositoryGeneration: plan.repositoryGeneration,
        repositoryFingerprint: plan.repositoryFingerprint,
        diagnostics: requiredStale
          ? [
              "Affected validation steps became stale because their scoped repository fingerprint changed.",
            ]
          : [],
      });
      await this.saveRun(run);
      const latestSession = this.executions.get(session.id) ?? session;
      const validationDurationMs = Math.max(
        0,
        Date.parse(run.completedAt!) - Date.parse(run.startedAt),
      );
      await this.executions.sessions.transition(
        session.id,
        status === "passed"
          ? "validation-passed"
          : status === "failed"
            ? "validation-failed"
            : status === "stale"
              ? "stale"
              : "awaiting-user-review",
        {
          validationRunIds: [...latestSession.validationRunIds, run.id],
          metrics: {
            ...latestSession.metrics,
            validationDurationMs,
            cacheReuseCount: run.summary.cacheReuseCount,
            cancelledSteps: run.summary.cancelledSteps,
            outputTruncations: run.summary.outputTruncations,
            staleInvalidations: run.summary.staleInvalidations,
          },
        },
      );
      return run;
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        const run = ValidationRunSchemaV2.parse({
          schemaVersion: 1,
          id: runId,
          executionSessionId: session.id,
          taskId: session.taskId,
          status: "cancelled",
          startedAt,
          completedAt: new Date().toISOString(),
          stepResults,
          acceptanceCriteriaResults: this.criteria.evaluate(plan, stepResults, evidence),
          findings,
          evidence,
          summary: summary(plan, stepResults, [], findings, session),
          repositoryGeneration: plan.repositoryGeneration,
          repositoryFingerprint: plan.repositoryFingerprint,
          diagnostics: ["Validation was cancelled; incomplete passes cannot support completion."],
        });
        await this.saveRun(run);
        const latest = this.executions.get(session.id) ?? session;
        await this.executions.sessions.transition(session.id, "cancelled", {
          validationRunIds: [...latest.validationRunIds, run.id],
        });
        return run;
      }
      throw cause;
    } finally {
      this.controllers.delete(runId);
    }
  }

  cancel(runId: string): void {
    this.controllers.get(runId)?.abort();
  }

  rerunStep(runId: string, stepId: string): Promise<ValidationRunV2> {
    const prior = this.getRun(runId);
    const session = prior && this.executions.get(prior.executionSessionId);
    const plan = session?.validationPlanId ? this.getPlan(session.validationPlanId) : undefined;
    if (!plan || !plan.steps.some((item) => item.id === stepId))
      throw new Error("Validation step was not found in the current plan.");
    return this.run(plan.id, undefined, undefined, stepId);
  }

  async addManualEvidence(
    runId: string,
    criterionId: string,
    statement: string,
  ): Promise<ValidationRunV2> {
    let output: ValidationRunV2 | undefined;
    await this.persistence.update((state) => ({
      ...state,
      runs: state.runs.map((run) => {
        if (run.id !== runId) return run;
        const criterion = run.acceptanceCriteriaResults.find(
          (item) => item.criterionId === criterionId,
        );
        if (!criterion) throw new Error("Manual-evidence criterion was not found.");
        if (
          !["requires-manual-review", "not-verifiable", "not-run", "partially-passed"].includes(
            criterion.status,
          )
        )
          throw new Error(
            `Manual evidence cannot replace a criterion in ${criterion.status} state; repair, rerun, or use an explicit audited override.`,
          );
        const evidence = ValidationEvidenceSchema.parse({
          id: crypto.randomUUID(),
          kind: "user-verification",
          source: `manual:${criterionId}`,
          reliability: "manual",
          summary: sanitize(statement).slice(0, 5000),
          createdAt: new Date().toISOString(),
        });
        output = ValidationRunSchemaV2.parse({
          ...run,
          evidence: [...run.evidence, evidence].slice(-1000),
          acceptanceCriteriaResults: run.acceptanceCriteriaResults.map((item) =>
            item.criterionId === criterionId
              ? {
                  ...item,
                  status: "passed",
                  evidenceIds: [...item.evidenceIds, evidence.id].slice(-100),
                  explanation: `${item.explanation} Explicit user verification was recorded as manual evidence.`,
                }
              : item,
          ),
          diagnostics: [
            ...run.diagnostics,
            `Manual evidence recorded for ${criterionId}; it is not command or repository evidence.`,
          ].slice(-100),
        });
        return output;
      }),
    }));
    if (!output) throw new Error("Validation run not found.");
    return output;
  }

  async override(
    runId: string,
    targetType: "criterion" | "finding" | "step",
    targetId: string,
    reason: string,
  ): Promise<ValidationRunV2> {
    let output: ValidationRunV2 | undefined;
    let audit: ReturnType<typeof OverrideAuditSchema.parse> | undefined;
    await this.persistence.update((state) => ({
      ...state,
      runs: state.runs.map((run) => {
        if (run.id !== runId) return run;
        const at = new Date().toISOString();
        const criterion = run.acceptanceCriteriaResults.find(
          (item) => item.criterionId === targetId,
        );
        const finding = run.findings.find((item) => item.id === targetId);
        const step = run.stepResults.find((item) => item.stepId === targetId);
        const priorStatus = criterion?.status ?? finding?.severity ?? step?.status;
        if (!priorStatus) throw new Error("Override target was not found.");
        audit = OverrideAuditSchema.parse({
          id: crypto.randomUUID(),
          executionSessionId: run.executionSessionId,
          validationRunId: run.id,
          targetType,
          targetId,
          reason,
          userId: "user",
          priorStatus,
          resultingStatus: "overridden",
          riskAcknowledgement:
            "The user accepted that this validation evidence is bypassed and remains visible in completion reporting.",
          createdAt: at,
        });
        output = ValidationRunSchemaV2.parse({
          ...run,
          acceptanceCriteriaResults:
            targetType === "criterion"
              ? run.acceptanceCriteriaResults.map((item) =>
                  item.criterionId === targetId
                    ? {
                        ...item,
                        status: "overridden",
                        override: { reason, at },
                        explanation: `${item.explanation} Explicit override: ${reason}`,
                      }
                    : item,
                )
              : run.acceptanceCriteriaResults,
          findings:
            targetType === "finding"
              ? run.findings.map((item) =>
                  item.id === targetId ? { ...item, override: { reason, at } } : item,
                )
              : run.findings,
          diagnostics: [
            ...run.diagnostics,
            `User override (${targetType}:${targetId}): ${reason}`,
          ].slice(-100),
        });
        return output;
      }),
      overrides: audit ? [...state.overrides, audit].slice(-1000) : state.overrides,
    }));
    if (!output) throw new Error("Validation run not found.");
    return output;
  }

  private latestReusableRun(
    plan: ValidationPlan,
    excludingId: string,
  ): ValidationRunV2 | undefined {
    return this.persistence.snapshot.runs
      .filter(
        (item) =>
          item.id !== excludingId &&
          item.executionSessionId === plan.executionSessionId &&
          item.status !== "running",
      )
      .at(-1);
  }

  private saveRun(run: ValidationRunV2): Promise<unknown> {
    return this.persistence.update((state) => ({
      ...state,
      runs: [...state.runs.filter((item) => item.id !== run.id), run].slice(-1000),
    }));
  }
}

interface DiscoveredCommand {
  type: ValidationStepType;
  description: string;
  required: boolean;
  provider: string;
  command: CommandDescriptor;
}

async function discoverCommands(
  workspace: WorkspaceAdapter,
  snapshot: IntelligenceSnapshot,
  cwd: string,
  providers: RepositoryCommandValidationProvider[],
): Promise<DiscoveredCommand[]> {
  const output: DiscoveredCommand[] = [];
  const root = workspace.getRoots()[0]!;
  try {
    const raw = JSON.parse(
      (await workspace.readTextFile(workspace.fileReference(root, "package.json").uri)).slice(
        0,
        1_000_000,
      ),
    ) as { scripts?: Record<string, unknown>; packageManager?: unknown };
    const scripts = raw.scripts ?? {};
    const executable =
      typeof raw.packageManager === "string" && raw.packageManager.startsWith("pnpm")
        ? "pnpm"
        : typeof raw.packageManager === "string" && raw.packageManager.startsWith("yarn")
          ? "yarn"
          : "npm";
    for (const provider of providers) {
      for (const name of provider.scriptNames) {
        if (typeof scripts[name] !== "string") continue;
        output.push({
          type: provider.type,
          description: provider.describe(name),
          required: provider.requiredByDefault,
          provider: provider.constructor.name,
          command: CommandDescriptorSchema.parse({
            executable,
            args: executable === "yarn" ? [name] : ["run", name],
            workingDirectory: cwd,
            safety: "project-validation",
            provenance: "repository-script",
            approved: true,
            timeoutMs: provider.timeoutMs,
          }),
        });
        break;
      }
    }
    for (const [name, type] of [
      ["test:integration", "integration-test"],
      ["test:e2e", "end-to-end-test"],
    ] as const) {
      if (typeof scripts[name] !== "string") continue;
      output.push({
        type,
        description: `Run repository script ${name}.`,
        required: false,
        provider: "TestValidationProvider",
        command: CommandDescriptorSchema.parse({
          executable,
          args: executable === "yarn" ? [name] : ["run", name],
          workingDirectory: cwd,
          safety: "project-validation",
          provenance: "repository-script",
          approved: true,
          timeoutMs: 10 * 60_000,
        }),
      });
    }
  } catch {
    // Other repository adapters below remain available.
  }
  const paths = new Set(snapshot.files.map((item) => item.relativePath));
  const add = (
    path: string,
    type: ValidationStepType,
    provider: string,
    executable: CommandDescriptor["executable"],
    args: string[],
  ): void => {
    if (!paths.has(path)) return;
    output.push({
      type,
      description: `Run ${type} discovered from ${path}.`,
      required: false,
      provider,
      command: CommandDescriptorSchema.parse({
        executable,
        args,
        workingDirectory: cwd,
        safety: "project-validation",
        provenance: "repository-config",
        approved: true,
        timeoutMs: 10 * 60_000,
      }),
    });
  };
  add("pom.xml", "unit-test", "TestValidationProvider", "mvn", ["test"]);
  add("build.gradle", "unit-test", "TestValidationProvider", "gradle", ["test"]);
  add("build.gradle.kts", "unit-test", "TestValidationProvider", "gradle", ["test"]);
  add("go.mod", "unit-test", "TestValidationProvider", "go", ["test", "./..."]);
  add("Cargo.toml", "unit-test", "TestValidationProvider", "cargo", ["test"]);
  add("pyproject.toml", "unit-test", "TestValidationProvider", "pytest", []);
  const project = [...paths].find((item) => /\.csproj$/i.test(item));
  if (project) add(project, "unit-test", "TestValidationProvider", "dotnet", ["test", project]);
  return deduplicateCommands(output).slice(0, 50);
}

export function validationFingerprint(
  snapshot: IntelligenceSnapshot,
  scopePaths: readonly string[],
): string {
  const all = scopePaths.includes("*");
  const paths = new Set(scopePaths);
  const files = snapshot.files
    .filter((item) => all || paths.has(item.relativePath))
    .map((item) => `${item.relativePath}:${item.contentHash ?? item.structuralHash ?? "unhashed"}`)
    .sort();
  const relationships = snapshot.relationships
    .filter((item) => {
      if (all) return true;
      const owner = snapshot.files.find((file) => file.id === item.ownerFileId);
      return Boolean(owner && paths.has(owner.relativePath));
    })
    .map((item) => `${item.id}:${item.confidence}:${item.type}`)
    .sort();
  return stableFingerprint([
    snapshot.repository.id,
    snapshot.repository.branch ?? "unknown",
    snapshot.repository.headCommit ?? "unknown",
    files,
    relationships,
  ]);
}

function classifyBaseline(
  session: TaskExecutionSession,
  step: ValidationStep,
  status: ValidationRunV2["stepResults"][number]["status"],
  output: string,
  error: string,
): ValidationRunV2["stepResults"][number]["baselineClassification"] {
  if (!step.command || !["passed", "failed"].includes(status)) return "unknown";
  const command = commandFingerprint(step.command);
  const baseline = session.repositoryBaseline.knownValidationOutcomes.find(
    (item) => item.commandFingerprint === command,
  );
  if (!baseline) return status === "failed" ? "new" : "unknown";
  if (status === "passed" && baseline.status === "failed") return "fixed";
  if (
    status === "failed" &&
    baseline.status === "failed" &&
    baseline.failureFingerprint === failureFingerprint(output, error)
  )
    return "pre-existing";
  return status === "failed" ? "new" : "unknown";
}

function summary(
  plan: ValidationPlan,
  results: ValidationRunV2["stepResults"],
  criteria: ValidationRunV2["acceptanceCriteriaResults"],
  findings: ValidationFinding[],
  session: TaskExecutionSession,
): ValidationRunV2["summary"] {
  const required = new Set(plan.steps.filter((item) => item.required).map((item) => item.id));
  return {
    requiredStepsPassed: results.filter(
      (item) => required.has(item.stepId) && item.status === "passed",
    ).length,
    requiredStepsFailed: results.filter(
      (item) => required.has(item.stepId) && item.status === "failed",
    ).length,
    optionalStepsPassed: results.filter(
      (item) => !required.has(item.stepId) && item.status === "passed",
    ).length,
    criteriaPassed: criteria.filter((item) => item.status === "passed").length,
    criteriaFailed: criteria.filter((item) => item.status === "failed").length,
    criteriaRequiringReview: criteria.filter((item) =>
      ["requires-manual-review", "not-run", "not-verifiable"].includes(item.status),
    ).length,
    newRegressions: results.filter(
      (item) => item.status === "failed" && item.baselineClassification === "new",
    ).length,
    preExistingFailures: results.filter(
      (item) => item.status === "failed" && item.baselineClassification === "pre-existing",
    ).length,
    unexpectedChanges: session.observedChanges.filter(
      (item) => ["unexpected", "ambiguous"].includes(item.classification) && !item.userOverride,
    ).length,
    blockingFindings: findings.filter((item) => item.severity === "blocking" && !item.override)
      .length,
    testsSelected: plan.testSelections.filter((item) => item.selected).length,
    cacheReuseCount: results.filter((item) => item.reused).length,
    cancelledSteps: results.filter((item) => item.status === "cancelled").length,
    outputTruncations: results.filter((item) => item.outputTruncated).length,
    staleInvalidations: results.filter((item) => item.status === "stale").length,
  };
}

function emptySummary(plan: ValidationPlan): ValidationRunV2["summary"] {
  return summary(plan, [], [], [], TaskExecutionSessionPlaceholder);
}

const TaskExecutionSessionPlaceholder = {
  observedChanges: [],
} as unknown as TaskExecutionSession;

function criteriaForType(
  specification: DevelopmentSpecification,
  allowed: string[],
  type: ValidationStepType,
): string[] {
  const aliases: Record<string, RegExp> = {
    build: /build|compile|artifact/i,
    "type-check": /type|compile/i,
    lint: /lint|static|quality/i,
    "unit-test": /unit|test/i,
    "integration-test": /integration/i,
    "end-to-end-test": /e2e|end.to.end/i,
    "impacted-test": /test|regression|coverage/i,
    "security-check": /security|authorization|authentication|taint/i,
    "performance-check": /performance|latency|throughput|complexity/i,
    "architecture-rule": /architecture|layer|dependency|cycle/i,
  };
  const matcher = aliases[type];
  if (!matcher) return allowed;
  const matched = specification.acceptanceCriteria
    .filter(
      (item) =>
        allowed.includes(item.id) && matcher.test(`${item.validationMethod} ${item.description}`),
    )
    .map((item) => item.id);
  return matched.length ? matched : allowed;
}

function simpleProvider(passed: boolean, output: string): ProviderResult {
  return {
    status: passed ? "passed" : "failed",
    output,
    evidence: [],
    findings: [],
  };
}

function category(type: ValidationStepType): ValidationFinding["category"] {
  if (type === "build") return "build";
  if (type === "type-check") return "type-check";
  if (type === "lint") return "lint";
  if (type.includes("test")) return "test";
  if (type.includes("architecture")) return "architecture";
  if (type.includes("security")) return "security";
  if (type.includes("performance")) return "performance";
  if (type.includes("contract")) return "API";
  if (type.includes("schema")) return "data";
  return type.includes("unexpected") ? "unexpected-change" : "acceptance-criterion";
}

class BoundedSanitizedOutput {
  private pending = "";
  private tail = "";
  private total = 0;
  constructor(private readonly progress?: (message: string) => void) {}
  append(chunk: Buffer): void {
    const combined = this.pending + chunk.toString();
    const boundary = Math.max(0, combined.length - 512);
    const ready = combined.slice(0, boundary);
    this.pending = combined.slice(boundary);
    if (ready) this.commit(ready);
  }
  finish(): { value: string; truncated: boolean } {
    this.commit(this.pending);
    this.pending = "";
    return { value: this.tail, truncated: this.total > 20_000 };
  }
  private commit(value: string): void {
    const clean = sanitize(value);
    this.total += clean.length;
    this.tail = (this.tail + clean).slice(-20_000);
    if (clean) this.progress?.(clean.slice(-500));
  }
}

function safeEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {
    CI: "1",
    NODE_ENV: "test",
    FORCE_COLOR: "0",
  };
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot"])
    if (process.env[key]) output[key] = process.env[key];
  return output;
}

function terminateTree(child: ChildProcess): void {
  if (!child.pid) return;
  clearTermination(child);
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    const timer = setTimeout(() => {
      try {
        process.kill(-child.pid!, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 1000);
    timer.unref();
    terminationTimers.set(child, timer);
  } else {
    child.kill("SIGTERM");
  }
}

function clearTermination(child: ChildProcess): void {
  const timer = terminationTimers.get(child);
  if (timer) clearTimeout(timer);
  terminationTimers.delete(child);
}

function sanitize(value: string): string {
  const printable = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return character === "\n" || character === "\t" || (code >= 32 && code !== 127);
    })
    .join("");
  return printable
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g"), "")
    .replace(
      /(?:gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:password|token|secret|api[_-]?key)\s*[:=]\s*[^\s]+)/gi,
      "[REDACTED]",
    );
}

function stableFingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function deduplicateCommands(values: DiscoveredCommand[]): DiscoveredCommand[] {
  const output = new Map<string, DiscoveredCommand>();
  for (const value of values)
    output.set(`${value.command.executable}:${value.command.args.join("\u001f")}`, value);
  return [...output.values()];
}
