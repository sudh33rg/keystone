import * as vscode from "vscode";

import type { VscodeProvider } from "../ui/vscodeProvider";

/**
 * Registers all extension commands with VS Code.
 * Called once during extension activation.
 */
export function indexCommands(context: vscode.ExtensionContext, provider: VscodeProvider): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("keystone.focusVscode", () => provider.showHome()),
    vscode.commands.registerCommand("keystone.indexRepo", () => provider.indexWorkspace()),
    vscode.commands.registerCommand("keystone.openBrowserView", () => provider.openBrowserView()),
    vscode.commands.registerCommand("keystone.configureValueEdge", () =>
      provider.configureValueEdge()
    ),
    vscode.commands.registerCommand("keystone.importValueEdgeFeature", async () => {
      const featureId = await vscode.window.showInputBox({
        title: "Import ValueEdge feature",
        prompt: "Feature ID",
        ignoreFocusOut: true
      });
      if (featureId?.trim()) await provider.importValueEdgeFeature(featureId);
    }),
    vscode.commands.registerCommand("keystone.publishValueEdgeStories", () =>
      provider.publishValueEdgeStories()
    ),
    vscode.commands.registerCommand("keystone.analyzeTask", async () => {
      const text = await vscode.window.showInputBox({
        title: "Analyze task with Keystone",
        prompt: "Describe the change you want to make",
        ignoreFocusOut: true
      });
      if (text?.trim()) await provider.analyzeIntent(text);
    })
  );
}
