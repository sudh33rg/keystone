import * as vscode from "vscode";
import type { KeystoneDashboardViewModelService } from "../../core/integration/NativeShellServices";

type Node = { id: string; label: string; description?: string; command?: string };

/**
 * Minimal activity-bar launcher. Shows the Keystone name, Open Keystone,
 * Start New Work, and a compact indication of the active workflow and current
 * stage. It intentionally does not duplicate product navigation or repository
 * tools — the product lives in the editor webview.
 */
export class KeystoneLauncherProvider implements vscode.TreeDataProvider<Node>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Node | undefined | null>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly viewModels: KeystoneDashboardViewModelService) {}

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.id = node.id;
    item.description = node.description;
    if (node.command) item.command = { command: node.command, title: node.label };
    item.iconPath = new vscode.ThemeIcon(
      node.id === "open" ? "window" : node.id === "new-work" ? "add" : "tools",
    );
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (node) return [];
    const state = this.viewModels.project();
    const workflowSection = state.sections.find((section) => section.id === "workflow");
    const workflow = workflowSection?.items.find(
      (item) => item.contextValue === "keystone.workflow",
    );
    const stage = workflowSection?.items.find((item) => item.contextValue === "keystone.task");
    const nodes: Node[] = [
      { id: "open", label: "Open Keystone", command: "keystone.open" },
      { id: "new-work", label: "Start New Work", command: "keystone.startWorkflow" },
    ];
    if (workflow)
      nodes.push({
        id: "active",
        label: workflow.label,
        description: stage?.label,
        command: "keystone.resumeWorkflow",
      });
    return nodes;
  }

  dispose(): void {
    this.changed.dispose();
  }
}
