// KeystoneExplorerProvider.ts
// Provides a side‑bar tree view for the new intelligence services.

import * as vscode from "vscode";
import type { IntelligenceSnapshotReader } from "../../core/persistence/IntelligenceStore";

type Node =
  | { kind: "section"; id: string; label: string; icon: string }
  | { kind: "service"; id: string; label: string; icon: string }
  | { kind: "item"; value: IntelligenceItem };

interface IntelligenceItem {
  id: string;
  label: string;
  description: string;
  icon: string;
  contextValue: string;
  command?: {
    command: string;
    title: string;
    arguments: unknown[];
  };
}

export class KeystoneExplorerProvider
  implements vscode.TreeDataProvider<Node>, vscode.Disposable
{
  private readonly changed = new vscode.EventEmitter<Node | undefined | null>();
  readonly onDidChangeTreeData = this.changed.event;

  private sections: Array<{ id: string; label: string; icon: string; items: IntelligenceItem[] }> = [];

  constructor(private readonly store: IntelligenceSnapshotReader) {
    this.buildDefaultSections();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "section") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `section:${node.id}`;
      item.contextValue = `keystone.explorer.section.${node.id}`;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      return item;
    }
    if (node.kind === "service") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.None,
      );
      item.id = `service:${node.id}`;
      item.contextValue = `keystone.explorer.service.${node.id}`;
      item.iconPath = new vscode.ThemeIcon(node.icon);
      item.command = {
        command: `keystone.explorer.open.${node.id}`,
        title: node.label,
      };
      return item;
    }
    const value = node.value;
    const item = new vscode.TreeItem(
      value.label,
      vscode.TreeItemCollapsibleState.None,
    );
    item.id = value.id;
    item.description = value.description;
    item.tooltip = new vscode.MarkdownString(value.description);
    item.iconPath = new vscode.ThemeIcon(value.icon);
    item.contextValue = value.contextValue;
    if (value.command) {
      item.command = value.command;
    }
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return this.sections.map((section) => ({
        kind: "section",
        id: section.id,
        label: section.label,
        icon: section.icon,
      }));
    }
    if (node.kind === "section") {
      const section = this.sections.find((s) => s.id === node.id);
      return (section?.items ?? []).map((item) => ({
        kind: "item",
        value: item,
      }));
    }
    return [];
  }

  private buildDefaultSections(): void {
    this.sections = [
      {
        id: "services",
        label: "Intelligence Services",
        icon: "tools",
        items: [
          {
            id: "exported-symbols",
            label: "Exported Symbols",
            description: "List exported symbols from files",
            icon: "symbol-method",
            contextValue: "keystone.explorer.service.exported-symbols",
            command: {
              command: "keystone.explorer.open.exported-symbols",
              title: "Open Exported Symbols",
              arguments: [],
            },
          },
          {
            id: "wildcard-search",
            label: "Wildcard Search",
            description: "Search using glob patterns",
            icon: "search",
            contextValue: "keystone.explorer.service.wildcard-search",
            command: {
              command: "keystone.explorer.open.wildcard-search",
              title: "Open Wildcard Search",
              arguments: [],
            },
          },
          {
            id: "module-mapping",
            label: "Module Mapping",
            description: "Module-to-module dependency mapping",
            icon: "folder-library",
            contextValue: "keystone.explorer.service.module-mapping",
            command: {
              command: "keystone.explorer.open.module-mapping",
              title: "Open Module Mapping",
              arguments: [],
            },
          },
          {
            id: "circular-dependencies",
            label: "Circular Dependencies",
            description: "Detect circular dependencies",
            icon: "debug-restart",
            contextValue: "keystone.explorer.service.circular-dependencies",
            command: {
              command: "keystone.explorer.open.circular-dependencies",
              title: "Open Circular Dependencies",
              arguments: [],
            },
          },
          {
            id: "node-metrics",
            label: "Node Metrics",
            description: "Centrality, degree, and influence scores",
            icon: "graph",
            contextValue: "keystone.explorer.service.node-metrics",
            command: {
              command: "keystone.explorer.open.node-metrics",
              title: "Open Node Metrics",
              arguments: [],
            },
          },
          {
            id: "dead-code",
            label: "Dead Code",
            description: "Detect potentially unused code",
            icon: "trash",
            contextValue: "keystone.explorer.service.dead-code",
            command: {
              command: "keystone.explorer.open.dead-code",
              title: "Open Dead Code Detection",
              arguments: [],
            },
          },
          {
            id: "filtered-subgraph",
            label: "Filtered Subgraph",
            description: "Extract filtered subgraphs from the graph",
            icon: "filter",
            contextValue: "keystone.explorer.service.filtered-subgraph",
            command: {
              command: "keystone.explorer.open.filtered-subgraph",
              title: "Open Filtered Subgraph",
              arguments: [],
            },
          },
          {
            id: "cyclomatic-complexity",
            label: "Cyclomatic Complexity",
            description: "Analyze cyclomatic complexity of functions",
            icon: "beaker",
            contextValue: "keystone.explorer.service.cyclomatic-complexity",
            command: {
              command: "keystone.explorer.open.cyclomatic-complexity",
              title: "Open Cyclomatic Complexity",
              arguments: [],
            },
          },
        ],
      },
    ];
  }

  dispose(): void {
    this.changed.dispose();
  }
}
