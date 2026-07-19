// CopilotToggleService.ts
// Manages the Copilot markdown generation toggle in VS Code globalState.

import type * as vscode from "vscode";

export const COPILOT_TOGGLE_KEY = "keystone.copilot.markdownEnabled";

export class CopilotToggleService {
  constructor(private readonly context: vscode.ExtensionContext) {}

  isEnabled(): boolean {
    return this.context.globalState.get<boolean>(COPILOT_TOGGLE_KEY, false);
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.context.globalState.update(COPILOT_TOGGLE_KEY, enabled);
  }

  async toggle(): Promise<boolean> {
    const current = this.isEnabled();
    const next = !current;
    await this.setEnabled(next);
    return next;
  }
}
