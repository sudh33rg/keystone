import * as vscode from "vscode";
import { COPILOT_COMMAND_ALLOWLIST, type CopilotEnvironment, type CopilotExtensionEvidence, type SupportedCopilotCommand } from "../../core/copilot/CopilotAdapter";

export class VsCodeCopilotEnvironment implements CopilotEnvironment {
  listExtensions(): Promise<CopilotExtensionEvidence[]> { return Promise.resolve(vscode.extensions.all.filter((item) => item.id === "github.copilot" || item.id === "github.copilot-chat").map((item) => ({ id: item.id, version: readVersion(item.packageJSON), active: item.isActive }))); }
  listCommands(): Promise<string[]> { return Promise.resolve(vscode.commands.getCommands(true)); }
  async integrationMethods(): Promise<string[]> {
    const commands = await this.listCommands();
    return [
      ...(commands.includes("workbench.action.chat.open") ? ["open-chat-v1"] : []),
      ...(typeof vscode.lm?.registerTool === "function" ? ["language-model-tools-v1"] : []),
      ...(typeof vscode.chat?.createChatParticipant === "function" ? ["chat-participant-v1"] : []),
      "clipboard-v1",
    ];
  }
  async executeAllowedCommand(command: SupportedCopilotCommand): Promise<void> {
    if (!(COPILOT_COMMAND_ALLOWLIST as readonly string[]).includes(command)) throw new Error(`Rejected non-allowlisted Copilot command: ${command}`);
    await vscode.commands.executeCommand(command);
  }
  writeClipboard(prompt: string): Promise<void> { return Promise.resolve(vscode.env.clipboard.writeText(prompt)); }
}

function readVersion(packageJson: unknown): string { if (!packageJson || typeof packageJson !== "object") return "unknown"; const version = (packageJson as Record<string, unknown>).version; return typeof version === "string" ? version : "unknown"; }
