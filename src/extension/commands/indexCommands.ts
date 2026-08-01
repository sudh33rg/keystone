import * as vscode from "vscode";

import type { VscodeProvider } from "../ui/vscodeProvider";
import type { QaService } from "../core/qaService";

/**
 * Registers all extension commands with VS Code.
 * Called once during extension activation.
 */
export function indexCommands(
  context: vscode.ExtensionContext,
  provider: VscodeProvider,
  qaService?: QaService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("keystone.focusVscode", () => provider.showHome()),
    vscode.commands.registerCommand("keystone.indexRepo", () => provider.indexWorkspace()),
    vscode.commands.registerCommand("keystone.openBrowserView", () => provider.openBrowserView()),
    vscode.commands.registerCommand("keystone.configureValueEdge", () => provider.configureValueEdge()),
    vscode.commands.registerCommand("keystone.importValueEdgeFeature", async () => { const featureId = await vscode.window.showInputBox({ title: "Import ValueEdge feature", prompt: "Feature ID", ignoreFocusOut: true }); if (featureId?.trim()) await provider.importValueEdgeFeature(featureId); }),
    vscode.commands.registerCommand("keystone.publishValueEdgeStories", () => provider.publishValueEdgeStories()),
    vscode.commands.registerCommand("keystone.analyzeTask", async () => {
      const text = await vscode.window.showInputBox({ title: "Analyze task with Keystone", prompt: "Describe the change you want to make", ignoreFocusOut: true });
      if (text?.trim()) await provider.analyzeIntent(text);
    }),
    vscode.commands.registerCommand("keystone.__viewDiagnostics", () => provider.getDiagnostics()),
    vscode.commands.registerCommand("keystone.__flowDiagnostics", async () => {
      const active = vscode.window.activeTextEditor?.document.uri;
      const folder = (active ? vscode.workspace.getWorkspaceFolder(active) : undefined) ?? vscode.workspace.workspaceFolders?.[0];
      if (!folder || !qaService) throw new Error("Flow diagnostics require an open workspace and QA service.");
      const qa = await qaService.runAnalysis(folder.uri.fsPath, "quick");
      const modernization = await provider.runModernizationDiagnostics();
      return { qa: { mode: qa.scanMode, sources: qa.metrics.sourcesAnalyzed, tests: qa.metrics.testsDiscovered, gaps: qa.metrics.gapsFound }, modernization };
    }),
    vscode.commands.registerCommand("keystone.__lifecycleDiagnostics", (intent?: string, currentFile?: string) => provider.runLifecycleDiagnostics(intent, currentFile)),
  );
}
