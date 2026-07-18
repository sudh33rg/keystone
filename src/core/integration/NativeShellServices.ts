import {
  DashboardItemSchema,
  KeystoneDashboardStateSchema,
  OpenKeystoneRequestSchema,
  ValidatedNavigationSchema,
  type DashboardItem,
  type KeystoneDashboardState,
  type OpenKeystoneRequest,
  type ValidatedNavigation,
} from "../../shared/contracts/nativeShell";
import type { IntelligenceSnapshot } from "../../shared/contracts/intelligence";
import type { DevelopmentWorkflowSnapshot } from "../../shared/contracts/delegation";
import type { WorkflowReviewState } from "../../shared/contracts/review";
import type { CopilotIntegrationCapabilities } from "../../shared/contracts/copilotIntegration";
import type { NativeShellPersistenceStore } from "../persistence/NativeShellPersistenceStore";
import { workbenchRoute } from "../../shared/navigation";

export interface NativeShellStateSource {
  workspace(): {
    available: boolean;
    name: string;
    trusted: boolean;
    roots: Array<{ id: string; name: string }>;
  };
  intelligence(): {
    status: string;
    pendingUpdate: boolean;
    health?: string;
    error?: string;
  };
  snapshot(): IntelligenceSnapshot | undefined;
  workflows(): DevelopmentWorkflowSnapshot[];
  review(workflowId: string): WorkflowReviewState | undefined;
  validation(workflowId: string): { passed: number; failed: number };
  copilot(): CopilotIntegrationCapabilities | undefined;
  handoffAttention(): number;
  persistenceWarnings(): string[];
}

export class KeystoneDashboardViewModelService {
  constructor(private readonly source: NativeShellStateSource) {}
  project(): KeystoneDashboardState {
    const started = performance.now();
    const workspace = this.source.workspace();
    if (!workspace.available)
      return KeystoneDashboardStateSchema.parse({
        schemaVersion: 1,
        status: "no-workspace",
        trusted: workspace.trusted,
        sections: [
          {
            id: "repository",
            label: "Repository",
            items: [
              item(
                "repository:no-workspace",
                "repository",
                "Open a folder or repository",
                "Keystone requires a workspace folder.",
                "folder-opened",
                "keystone.repository.missing",
                { type: "home" },
              ),
            ],
          },
          {
            id: "actions",
            label: "Actions",
            items: [
              item(
                "action:open-folder",
                "actions",
                "Open Folder",
                "Open a folder in VS Code.",
                "folder-opened",
                "keystone.action.openFolder",
              ),
              item(
                "action:open",
                "actions",
                "Open Keystone",
                "Open the Keystone Home screen.",
                "inspect",
                "keystone.action.open",
                { type: "home" },
              ),
            ],
          },
        ],
        generatedAt: new Date().toISOString(),
        refreshDurationMs: performance.now() - started,
        diagnostics: [],
      });
    const snapshot = this.source.snapshot();
    const runtime = this.source.intelligence();
    const workflows = this.source
      .workflows()
      .filter(
        (workflow) =>
          !snapshot || workflow.repositoryId === snapshot.repository.id,
      );
    const workflow = workflows.at(-1);
    const task =
      workflow?.tasks.find((entry) =>
        ["ready", "executing", "blocked", "stale"].includes(entry.status),
      ) ?? workflow?.tasks.find((entry) => entry.status !== "completed");
    const review = workflow ? this.source.review(workflow.id) : undefined;
    const validation = workflow
      ? this.source.validation(workflow.id)
      : { passed: 0, failed: 0 };
    const status = !snapshot
      ? "intelligence-unavailable"
      : runtime.pendingUpdate
        ? "intelligence-indexing"
        : runtime.error ||
            runtime.health === "missing" ||
            runtime.health === "degraded"
          ? "degraded"
          : !workflow
            ? "no-workflow"
            : "ready";
    const repositoryItems = [
      item(
        "repository:active",
        "repository",
        snapshot?.repository.displayName ?? workspace.name,
        snapshot?.repository.branch ?? "Repository detected",
        "repo",
        "keystone.repository",
        { type: "intelligence-query" },
      ),
      item(
        "repository:intelligence",
        "repository",
        runtime.pendingUpdate
          ? "Intelligence indexing"
          : snapshot
            ? "Intelligence ready"
            : "Intelligence unavailable",
        runtime.error ??
          `Trust: ${workspace.trusted ? "trusted" : "restricted"}`,
        runtime.pendingUpdate ? "sync~spin" : snapshot ? "database" : "warning",
        "keystone.intelligence",
        { type: "intelligence-query" },
        runtime.error ? "error" : runtime.pendingUpdate ? "warning" : "info",
      ),
    ];
    const workflowItems: DashboardItem[] = workflow
      ? [
          item(
            `workflow:${workflow.id}`,
            "workflow",
            workflow.specification?.title ??
              workflow.intent.normalizedObjective,
            `${workflow.intent.workType ?? workflow.intent.category} · ${workflow.status}`,
            "issue-opened",
            "keystone.workflow",
            { type: "workflow", workflowId: workflow.id },
          ),
          ...(task
            ? [
                item(
                  `task:${task.id}`,
                  "workflow",
                  task.title,
                  `${task.status} · ${validation.passed} validation passed, ${validation.failed} failed`,
                  "tools",
                  "keystone.task",
                  { type: "task", workflowId: workflow.id, taskId: task.id },
                ),
              ]
            : []),
          item(
            `workflow:progress:${workflow.id}`,
            "workflow",
            `${workflow.tasks.filter((entry) => entry.status === "completed").length} of ${workflow.tasks.length} tasks complete`,
            `${review?.summary.blockingFindings ?? 0} blocking findings · ${review?.summary.warnings ?? 0} warnings`,
            "graph",
            "keystone.workflow.progress",
            {
              type: "workflow",
              workflowId: workflow.id,
              stage: review?.summary.blockingFindings ? "review" : undefined,
            },
          ),
        ]
      : [
          item(
            "workflow:none",
            "workflow",
            "No active workflow",
            "Start new work or import a Task Handoff.",
            "circle-outline",
            "keystone.workflow.none",
            { type: "new-workflow" },
          ),
        ];
    const attention: DashboardItem[] = [];
    if (validation.failed && workflow)
      attention.push(
        item(
          `attention:validation:${workflow.id}`,
          "attention",
          `${validation.failed} failed validation run${validation.failed === 1 ? "" : "s"}`,
          "Open Validation and review current evidence.",
          "error",
          "keystone.attention.validation",
          { type: "workflow", workflowId: workflow.id, stage: "validate" },
          "error",
        ),
      );
    if (task?.staleReasons.length && workflow)
      attention.push(
        item(
          `attention:stale:${task.id}`,
          "attention",
          "Task or context is stale",
          task.staleReasons[0]!,
          "warning",
          "keystone.attention.stale",
          { type: "task", workflowId: workflow.id, taskId: task.id },
          "warning",
        ),
      );
    for (const finding of review?.findings
      .filter(
        (entry) => entry.finding.severity === "blocking" && !entry.disposition,
      )
      .slice(0, 5) ?? [])
      attention.push(
        item(
          `attention:finding:${finding.finding.id}`,
          "attention",
          `${finding.source} review required`,
          finding.finding.title,
          "warning",
          "keystone.attention.finding",
          {
            type: "finding",
            workflowId: workflow!.id,
            findingId: finding.finding.id,
          },
          "error",
        ),
      );
    const copilot = this.source.copilot();
    if (task?.executionRoute === "github-copilot" && !copilot?.chatAvailable)
      attention.push(
        item(
          `attention:copilot:${task.id}`,
          "attention",
          "Copilot capability unavailable",
          copilot?.limitations[0] ?? "Use assisted or clipboard fallback.",
          "warning",
          "keystone.attention.copilot",
          { type: "task", workflowId: workflow!.id, taskId: task.id },
          "warning",
        ),
      );
    if (this.source.handoffAttention())
      attention.push(
        item(
          "attention:handoff",
          "attention",
          "Task Handoff awaiting review",
          `${this.source.handoffAttention()} Handoff item(s) require attention.`,
          "git-pull-request",
          "keystone.attention.handoff",
          { type: "import-handoff" },
          "warning",
        ),
      );
    for (const [index, warning] of this.source
      .persistenceWarnings()
      .slice(0, 3)
      .entries())
      attention.push(
        item(
          `attention:persistence:${index}`,
          "attention",
          "Persistence recovery warning",
          warning,
          "warning",
          "keystone.attention.persistence",
          { type: "diagnostics" },
          "warning",
        ),
      );
    const actions = [
      item(
        "action:open",
        "actions",
        "Open Keystone",
        "Open the full Keystone Home experience.",
        "inspect",
        "keystone.action.open",
        { type: "home" },
      ),
      item(
        "action:new",
        "actions",
        "Start New Work",
        "Open the reviewed workflow creation screen.",
        "add",
        "keystone.action.new",
        { type: "new-workflow" },
      ),
      ...(workflow && task
        ? [
            item(
              "action:resume",
              "actions",
              "Resume Current Task",
              task.title,
              "debug-continue",
              "keystone.action.resume",
              { type: "task", workflowId: workflow.id, taskId: task.id },
            ),
          ]
        : []),
      item(
        "action:ask",
        "actions",
        "Ask Repository",
        "Open deterministic Repository Intelligence queries.",
        "search",
        "keystone.action.ask",
        { type: "intelligence-query" },
      ),
      item(
        "action:handoff",
        "actions",
        "Import Task Handoff",
        "Open the bounded Handoff import review.",
        "cloud-download",
        "keystone.action.handoff",
        { type: "import-handoff" },
      ),
      item(
        "action:diagnostics",
        "actions",
        "Open Diagnostics",
        "Inspect bounded extension and repository health.",
        "pulse",
        "keystone.action.diagnostics",
        { type: "diagnostics" },
      ),
    ];
    return KeystoneDashboardStateSchema.parse({
      schemaVersion: 1,
      status,
      ...(snapshot
        ? {
            repositoryId: snapshot.repository.id,
            repositoryName: snapshot.repository.displayName,
            branch: snapshot.repository.branch,
          }
        : {}),
      trusted: workspace.trusted,
      sections: [
        { id: "repository", label: "Repository", items: repositoryItems },
        { id: "workflow", label: "Current work", items: workflowItems },
        {
          id: "attention",
          label: "Needs attention",
          items: attention.length
            ? attention
            : [
                item(
                  "attention:none",
                  "attention",
                  "No action required",
                  "No current blocking or stale state was found.",
                  "check",
                  "keystone.attention.none",
                ),
              ],
        },
        { id: "actions", label: "Actions", items: actions },
      ],
      generatedAt: new Date().toISOString(),
      refreshDurationMs: performance.now() - started,
      diagnostics: [],
    });
  }
}

export class KeystoneLaunchValidationService {
  constructor(private readonly source: NativeShellStateSource) {}
  validate(raw: unknown): ValidatedNavigation {
    const started = performance.now();
    const request = OpenKeystoneRequestSchema.parse(raw);
    const snapshot = this.source.snapshot();
    const workflows = this.source.workflows();
    const destination = request.destination;
    let route: ValidatedNavigation["route"] = "/";
    let recovery: ValidatedNavigation["recovery"];
    let workflowId: string | undefined;
    let taskId: string | undefined;
    let entityId: string | undefined;
    let query: string | undefined;
    if (
      !this.source.workspace().available &&
      destination.type !== "home" &&
      destination.type !== "settings"
    )
      recovery = recover(
        "workspace-missing",
        "Workspace unavailable",
        "Open a compatible repository before opening this target.",
        "/",
      );
    else if (destination.type === "home") route = "/";
    else if (destination.type === "new-workflow") route = "/workbench/new";
    else if (destination.type === "history") route = "/history";
    else if (destination.type === "diagnostics") route = "/support/diagnostics";
    else if (destination.type === "settings") route = "/settings";
    else if (
      destination.type === "intelligence-query" ||
      destination.type === "flow" ||
      destination.type === "impact" ||
      destination.type === "entity"
    ) {
      route = "/intelligence";
      query =
        destination.type === "intelligence-query"
          ? destination.query
          : destination.type === "flow"
            ? `show ${destination.seedEntityId ?? destination.flowId ?? "selected"} flow`
            : destination.type === "impact"
              ? `what is impacted by ${destination.entityId}`
              : undefined;
      entityId =
        "entityId" in destination
          ? destination.entityId
          : destination.type === "flow"
            ? destination.seedEntityId
            : undefined;
      const requestedRepository =
        "repositoryId" in destination
          ? destination.repositoryId
          : request.repositoryId;
      if (
        requestedRepository &&
        snapshot?.repository.id !== requestedRepository
      )
        recovery = recover(
          "repository-mismatch",
          "Repository mismatch",
          "The requested item belongs to another repository. Select a compatible workspace before continuing.",
          "/intelligence",
        );
      else if (
        entityId &&
        !snapshot?.files.some((entry) => entry.id === entityId) &&
        !snapshot?.symbols.some((entry) => entry.id === entityId)
      )
        recovery = recover(
          "entity-missing",
          "Entity no longer exists",
          "The entity may have been renamed, deleted, or invalidated by a branch change.",
          "/intelligence",
        );
    } else if (destination.type === "import-handoff") route = "/";
    else {
      workflowId = destination.workflowId;
      const workflow = workflows.find(
        (entry) => entry.id === destination.workflowId,
      );
      if (!workflow)
        recovery = recover(
          "workflow-missing",
          "Workflow no longer exists",
          "The workflow cannot be restored from current canonical state.",
          "/history",
        );
      else if (snapshot && workflow.repositoryId !== snapshot.repository.id)
        recovery = recover(
          "repository-mismatch",
          "Workflow belongs to another repository",
          "Open the workflow's compatible repository before continuing.",
          "/history",
        );
      else if (destination.type === "task") {
        taskId = destination.taskId;
        if (!workflow.tasks.some((entry) => entry.id === destination.taskId))
          recovery = recover(
            "task-missing",
            "Task was removed or superseded",
            "Open the current workflow or task plan to choose a current task.",
            workbenchRoute(workflow.id, "plan"),
          );
        else
          route = workbenchRoute(
            workflow.id,
            stageForTask(workflow, destination.taskId),
          );
      } else if (destination.type === "finding") {
        const found = this.source
          .review(workflow.id)
          ?.findings.some(
            (entry) => entry.finding.id === destination.findingId,
          );
        if (!found)
          recovery = recover(
            "target-unavailable",
            "Finding no longer exists",
            "The finding was resolved, removed, or superseded.",
            workbenchRoute(workflow.id, "review"),
          );
        else route = workbenchRoute(workflow.id, "review");
      } else if (destination.type === "approval")
        route = workbenchRoute(workflow.id, approvalStage(workflow));
      else
        route = workbenchRoute(
          workflow.id,
          destination.stage ?? currentStage(workflow),
        );
    }
    if (recovery) route = recovery.fallbackRoute;
    return ValidatedNavigationSchema.parse({
      request,
      valid: !recovery,
      route,
      ...(snapshot ? { repositoryId: snapshot.repository.id } : {}),
      ...(workflowId ? { workflowId } : {}),
      ...(taskId ? { taskId } : {}),
      ...(query ? { query } : {}),
      ...(entityId ? { entityId } : {}),
      focusTarget: recovery ? "recovery-heading" : "main-heading",
      ...(recovery ? { recovery } : {}),
      validationDurationMs: performance.now() - started,
    });
  }
}

export class KeystonePanelStateService {
  constructor(private readonly store: NativeShellPersistenceStore) {}
  get snapshot() {
    return this.store.snapshot;
  }
  async opened(column: number) {
    return this.store.update({
      wasOpen: true,
      visible: true,
      ready: false,
      column,
    });
  }
  async revealed(column: number, visible = true) {
    return this.store.update({ wasOpen: true, visible, column });
  }
  async ready() {
    return this.store.update({ ready: true });
  }
  async disposed() {
    return this.store.update({
      wasOpen: false,
      visible: false,
      ready: false,
      pendingNavigation: undefined,
    });
  }
  async pending(value: ValidatedNavigation) {
    return this.store.update({
      pendingNavigation: value,
      navigationSequence: this.store.snapshot.navigationSequence + 1,
    });
  }
  async acknowledged(sequence: number, route: ValidatedNavigation["route"]) {
    if (sequence !== this.store.snapshot.navigationSequence)
      return this.store.snapshot;
    const pending = this.store.snapshot.pendingNavigation;
    return this.store.update({
      pendingNavigation: undefined,
      lastRoute: route,
      lastWorkflowId: pending?.workflowId,
      lastTaskId: pending?.taskId,
      lastIntelligenceQuery: pending?.query,
      lastEntityId: pending?.entityId,
    });
  }
  async route(
    route: ValidatedNavigation["route"],
    extras: {
      workflowId?: string;
      taskId?: string;
      query?: string;
      entityId?: string;
      drawer?: string;
    } = {},
  ) {
    return this.store.update({
      lastRoute: route,
      lastWorkflowId: extras.workflowId,
      lastTaskId: extras.taskId,
      lastIntelligenceQuery: extras.query,
      lastEntityId: extras.entityId,
      lastDrawer: extras.drawer,
    });
  }
}

export class KeystoneRouteRecoveryService {
  constructor(private readonly validator: KeystoneLaunchValidationService) {}
  restore(routeRequest: OpenKeystoneRequest): ValidatedNavigation {
    return this.validator.validate({ ...routeRequest, source: "restore" });
  }
}
export class KeystoneNavigationService {
  constructor(
    private readonly validator: KeystoneLaunchValidationService,
    private readonly panel: {
      open(request: OpenKeystoneRequest): Promise<ValidatedNavigation>;
    },
  ) {}
  open(request: OpenKeystoneRequest): Promise<ValidatedNavigation> {
    return this.panel.open(OpenKeystoneRequestSchema.parse(request));
  }
  validate(request: OpenKeystoneRequest): ValidatedNavigation {
    return this.validator.validate(request);
  }
}
export class KeystoneDashboardRefreshService {
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(
    private readonly refresh: () => void,
    private readonly debounceMs = 150,
  ) {}
  request(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.disposed) this.refresh();
    }, this.debounceMs);
  }
  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}

function item(
  id: string,
  section: DashboardItem["section"],
  label: string,
  tooltip: string,
  icon: string,
  contextValue: string,
  destination?: DashboardItem["destination"],
  severity: DashboardItem["severity"] = "info",
): DashboardItem {
  return DashboardItemSchema.parse({
    id,
    section,
    label,
    description: destination ? tooltip.slice(0, 200) : undefined,
    tooltip,
    icon,
    contextValue,
    accessibilityLabel: `${label}. ${tooltip}`,
    ...(destination ? { destination } : {}),
    severity,
  });
}
function recover(
  code:
    | "workflow-missing"
    | "task-missing"
    | "entity-missing"
    | "repository-mismatch"
    | "invalid-stage"
    | "workspace-missing"
    | "target-unavailable",
  title: string,
  message: string,
  fallbackRoute: ValidatedNavigation["route"],
): NonNullable<ValidatedNavigation["recovery"]> {
  return {
    code,
    title,
    message,
    fallbackRoute,
    actions: [
      { label: "Return Home", destination: { type: "home" } },
      { label: "Open Diagnostics", destination: { type: "diagnostics" } },
    ],
  };
}
function stageForTask(
  workflow: DevelopmentWorkflowSnapshot,
  taskId: string,
): "plan" | "build" | "validate" | "review" {
  const task = workflow.tasks.find((entry) => entry.id === taskId);
  if (!task || task.status === "pending") return "plan";
  if (task.status === "completed") return "review";
  return "build";
}
function currentStage(
  workflow: DevelopmentWorkflowSnapshot,
): "define" | "plan" | "build" | "validate" | "review" | "complete" {
  if (workflow.specification?.status !== "approved") return "define";
  if (!workflow.taskGraph?.ready) return "plan";
  if (
    workflow.tasks.some(
      (entry) => !["completed", "cancelled"].includes(entry.status),
    )
  )
    return "build";
  return "review";
}
function approvalStage(
  workflow: DevelopmentWorkflowSnapshot,
): "define" | "plan" | "review" {
  if (workflow.specification?.status !== "approved") return "define";
  if (!workflow.taskGraph?.ready) return "plan";
  return "review";
}
