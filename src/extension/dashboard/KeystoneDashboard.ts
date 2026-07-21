import * as vscode from "vscode";
import type {
  KeystoneDashboardViewModelService,
  KeystoneDashboardRefreshService,
  KeystoneNavigationService,
} from "../../core/integration/NativeShellServices";
import type {
  DashboardItem,
  KeystoneDashboardState,
  OpenKeystoneRequest,
} from "../../shared/contracts/nativeShell";

type Node = { kind: "section"; id: string; label: string } | { kind: "item"; value: DashboardItem };
export class KeystoneDashboardProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined | null>();
  private state: KeystoneDashboardState;
  private items = new Map<string, DashboardItem>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    private readonly viewModels: KeystoneDashboardViewModelService,
    private readonly open: (id: string) => Promise<void>,
  ) {
    this.state = viewModels.project();
    this.index();
  }
  get snapshot(): KeystoneDashboardState {
    return this.state;
  }
  refresh(): void {
    this.state = this.viewModels.project();
    this.index();
    this.changed.fire(undefined);
  }
  async openItem(id: string): Promise<void> {
    if (!this.items.has(id))
      throw new Error("Dashboard action is no longer available; refresh the Keystone dashboard.");
    await this.open(id);
  }
  destination(id: string): DashboardItem["destination"] {
    return this.items.get(id)?.destination;
  }
  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "section") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.Expanded);
      item.id = `section:${node.id}`;
      item.contextValue = `keystone.dashboard.section.${node.id}`;
      item.iconPath = new vscode.ThemeIcon(sectionIcon(node.id));
      item.accessibilityInformation = {
        label: `${node.label} section`,
        role: "treeitem",
      };
      return item;
    }
    const value = node.value;
    const item = new vscode.TreeItem(value.label, vscode.TreeItemCollapsibleState.None);
    item.id = value.id;
    item.description = value.description;
    item.tooltip = new vscode.MarkdownString(escapeMarkdown(value.tooltip));
    item.iconPath = new vscode.ThemeIcon(value.icon);
    item.contextValue = value.contextValue;
    item.accessibilityInformation = {
      label: value.accessibilityLabel,
      role: "treeitem",
    };
    if (value.destination)
      item.command = {
        command: "keystone.dashboard.openAction",
        title: value.label,
        arguments: [value.id],
      };
    return item;
  }
  getChildren(node?: Node): Node[] {
    if (!node)
      return this.state.sections.map((section) => ({
        kind: "section",
        id: section.id,
        label: section.label,
      }));
    if (node.kind === "section")
      return (this.state.sections.find((section) => section.id === node.id)?.items ?? []).map(
        (value) => ({ kind: "item", value }),
      );
    return [];
  }
  dispose(): void {
    this.changed.dispose();
  }
  private index(): void {
    this.items = new Map(
      this.state.sections.flatMap((section) =>
        section.items.map((item) => [item.id, item] as const),
      ),
    );
  }
}

export class KeystoneStatusBarService implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  constructor(private readonly visible: () => boolean) {
    this.item.command = "keystone.open";
    this.item.name = "Keystone";
  }
  update(state: KeystoneDashboardState): void {
    if (!this.visible()) {
      this.item.hide();
      return;
    }
    const validation = state.sections
      .find((section) => section.id === "attention")
      ?.items.find((item) => item.contextValue === "keystone.attention.validation");
    const attention = state.sections
      .find((section) => section.id === "attention")
      ?.items.some((item) => item.severity !== "info");
    if (validation) {
      this.item.text = "$(error) Keystone: Validation failed";
      this.item.command = "keystone.resumeWorkflow";
    } else if (state.status === "intelligence-indexing") {
      this.item.text = "$(database) Keystone: Indexing";
      this.item.command = "keystone.askRepository";
    } else if (attention) {
      this.item.text = "$(warning) Keystone: Action needed";
      this.item.command = "keystone.resumeWorkflow";
    } else if (
      state.sections
        .find((section) => section.id === "workflow")
        ?.items.some((entry) => entry.contextValue === "keystone.task")
    ) {
      this.item.text = "$(tools) Keystone: Task active";
      this.item.command = "keystone.openCurrentTask";
    } else {
      this.item.text = "$(check) Keystone: Ready";
      this.item.command = "keystone.open";
    }
    this.item.tooltip = tooltip(state);
    this.item.show();
  }
  dispose(): void {
    this.item.dispose();
  }
}

export class KeystoneContextKeyService implements vscode.Disposable {
  private disposed = false;
  async update(
    state: KeystoneDashboardState,
    panelVisible: boolean,
    copilotAvailable: boolean,
  ): Promise<void> {
    if (this.disposed) return;
    const attention = state.sections.find((section) => section.id === "attention")?.items ?? [];
    const values: Record<string, boolean> = {
      "keystone.workspaceAvailable": state.status !== "no-workspace",
      "keystone.repositoryAvailable": Boolean(state.repositoryId),
      "keystone.intelligenceReady": ["ready", "no-workflow"].includes(state.status),
      "keystone.workflowActive": state.sections.some((section) =>
        section.items.some((item) => item.contextValue === "keystone.workflow"),
      ),
      "keystone.taskActive": state.sections.some((section) =>
        section.items.some((item) => item.contextValue === "keystone.task"),
      ),
      "keystone.validationFailed": attention.some(
        (item) => item.contextValue === "keystone.attention.validation",
      ),
      "keystone.copilotAvailable": copilotAvailable,
      "keystone.workspaceTrusted": state.trusted,
      "keystone.panelVisible": panelVisible,
    };
    await Promise.all(
      Object.entries(values).map(([key, value]) =>
        vscode.commands.executeCommand("setContext", key, value),
      ),
    );
  }
  dispose(): void {
    this.disposed = true;
  }
}

export class KeystoneNotificationService implements vscode.Disposable {
  private previous?: KeystoneDashboardState;
  private disposed = false;
  async update(next: KeystoneDashboardState): Promise<void> {
    if (this.disposed) return;
    if (!this.previous) {
      this.previous = next;
      return;
    }
    const previousIds = new Set(
      this.previous.sections.flatMap((section) => section.items).map((item) => item.id),
    );
    const attention = next.sections
      .flatMap((section) => section.items)
      .find(
        (item) =>
          item.section === "attention" &&
          item.destination &&
          item.severity !== "info" &&
          !previousIds.has(item.id),
      );
    this.previous = next;
    if (!attention) return;
    const label =
      attention.contextValue === "keystone.attention.validation"
        ? "Open Validation"
        : attention.contextValue === "keystone.attention.handoff"
          ? "Review Handoff"
          : attention.contextValue === "keystone.attention.stale"
            ? "Open Task"
            : "Open Keystone";
    const action =
      attention.severity === "error"
        ? await vscode.window.showErrorMessage(attention.label, label)
        : await vscode.window.showWarningMessage(attention.label, label);
    if (action) await vscode.commands.executeCommand("keystone.dashboard.openAction", attention.id);
  }
  dispose(): void {
    this.disposed = true;
  }
}

export class KeystoneCommandService implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  constructor(
    private readonly navigation: KeystoneNavigationService,
    private readonly dashboard: KeystoneDashboardProvider,
    private readonly current: () => {
      repositoryId?: string;
      workflowId?: string;
      taskId?: string;
      entityId?: string;
    },
    private readonly refresh: KeystoneDashboardRefreshService,
  ) {}
  register(): vscode.Disposable[] {
    const open = (
      destination: OpenKeystoneRequest["destination"],
      source: OpenKeystoneRequest["source"] = "command-palette",
    ) =>
      this.navigation.open({
        schemaVersion: 1,
        destination,
        source,
        requestedAt: new Date().toISOString(),
      });
    const command = (id: string, handler: (...args: unknown[]) => unknown) => {
      const value = vscode.commands.registerCommand(id, handler);
      this.disposables.push(value);
      return value;
    };
    const entity = (repositoryId?: unknown, entityId?: unknown) => {
      const value = this.current();
      const repository = typeof repositoryId === "string" ? repositoryId : value.repositoryId;
      const selected = typeof entityId === "string" ? entityId : value.entityId;
      if (!repository || !selected)
        throw new Error(
          "Keystone could not resolve an intelligence entity at the active editor position.",
        );
      return { repository, selected };
    };
    command("keystone.dashboard.openAction", async (id) => this.dashboard.openItem(String(id)));
    command("keystone.open", () => open({ type: "home" }));
    command("keystone.startWorkflow", () => open({ type: "new-workflow" }));
    command("keystone.resumeWorkflow", () => {
      const value = this.current();
      return value.workflowId
        ? open({ type: "workflow", workflowId: value.workflowId })
        : open({ type: "new-workflow" });
    });
    command("keystone.openCurrentTask", () => {
      const value = this.current();
      return value.workflowId && value.taskId
        ? open(
            {
              type: "task",
              workflowId: value.workflowId,
              taskId: value.taskId,
            },
            "task-action",
          )
        : open({ type: "home" });
    });
    command("keystone.askRepository", () => open({ type: "intelligence-query" }));
    command("keystone.openEntity", (repositoryId, entityId) => {
      const value = entity(repositoryId, entityId);
      return open(
        {
          type: "entity",
          repositoryId: value.repository,
          entityId: value.selected,
        },
        "editor-context",
      );
    });
    command("keystone.showUsages", (repositoryId, entityId) => {
      const value = entity(repositoryId, entityId);
      return open(
        {
          type: "intelligence-query",
          query: `where is ${value.selected} used`,
        },
        "editor-context",
      );
    });
    command("keystone.showFlow", (repositoryId, entityId) => {
      const value = entity(repositoryId, entityId);
      return open(
        {
          type: "flow",
          repositoryId: value.repository,
          seedEntityId: value.selected,
        },
        "editor-context",
      );
    });
    command("keystone.analyzeImpact", (repositoryId, entityId) => {
      const value = entity(repositoryId, entityId);
      return open(
        {
          type: "impact",
          repositoryId: value.repository,
          entityId: value.selected,
        },
        "editor-context",
      );
    });
    command("keystone.importHandoff", () => open({ type: "import-handoff" }, "handoff-import"));
    command("keystone.openDiagnostics", () => open({ type: "diagnostics" }, "diagnostics"));
    command("keystone.openSettings", () => open({ type: "settings" }));
    command("keystone.dashboard.refresh", () => this.refresh.request());
    command("keystone.openFolder", () => vscode.commands.executeCommand("vscode.openFolder"));
    return this.disposables;
  }
  dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
    this.disposables.length = 0;
  }
}

export { KeystoneExplorerProvider } from "./KeystoneExplorerProvider";
export class KeystoneCodeLensProvider implements vscode.CodeLensProvider {
  constructor(
    private readonly resolve: (
      uri: vscode.Uri,
    ) => Array<{ repositoryId: string; entityId: string; line: number }>,
  ) {}
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (
      !vscode.workspace.isTrusted ||
      !vscode.workspace.getConfiguration("keystone.shell").get<boolean>("enableCodeLens", false)
    )
      return [];
    return this.resolve(document.uri)
      .slice(0, 20)
      .flatMap((entry) => {
        const range = new vscode.Range(entry.line, 0, entry.line, 0);
        const args = [entry.repositoryId, entry.entityId];
        return [
          new vscode.CodeLens(range, {
            command: "keystone.showUsages",
            title: "Keystone: usages",
            arguments: args,
          }),
          new vscode.CodeLens(range, {
            command: "keystone.analyzeImpact",
            title: "impact",
            arguments: args,
          }),
        ];
      });
  }
}

function sectionIcon(id: string): string {
  return id === "repository"
    ? "repo"
    : id === "workflow"
      ? "tools"
      : id === "attention"
        ? "warning"
        : "play";
}
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&");
}
function tooltip(state: KeystoneDashboardState): vscode.MarkdownString {
  const repository = state.repositoryName ?? "No repository";
  const workflow =
    state.sections.find((section) => section.id === "workflow")?.items[0]?.label ??
    "No active workflow";
  const task =
    state.sections
      .find((section) => section.id === "workflow")
      ?.items.find((item) => item.contextValue === "keystone.task")?.label ?? "No current task";
  return new vscode.MarkdownString(
    `**${repository}**\n\n${state.status}\n\nWorkflow: ${workflow}\n\nTask: ${task}`,
  );
}
