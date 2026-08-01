import * as vscode from "vscode";

/**
 * Creates the status bar item for the Keystone extension.
 * Configured with an icon, tooltip, and the focus cockpit command.
 */
export function createStatusBar(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.name = "Keystone";
  item.command = "keystone.focusVscode";
  item.tooltip = "Keystone SDLC vscode";
  item.text = "Keystone: Ready";
  return item;
}
