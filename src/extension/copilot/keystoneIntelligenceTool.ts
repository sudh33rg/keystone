import * as vscode from "vscode";

import type { CopilotIntelligenceToolInput } from "@core/integration/webview/messageRouter";

export const KEYSTONE_INTELLIGENCE_TOOL_NAME = "keystone_intelligence";

export type KeystoneIntelligenceToolExecutor = (
  input: CopilotIntelligenceToolInput,
  token: vscode.CancellationToken
) => Promise<string>;

export class KeystoneIntelligenceTool
  implements vscode.LanguageModelTool<CopilotIntelligenceToolInput>
{
  constructor(
    private readonly execute: KeystoneIntelligenceToolExecutor,
    private readonly describe: (input: CopilotIntelligenceToolInput) => string
  ) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CopilotIntelligenceToolInput>,
    _token: vscode.CancellationToken
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: this.describe(options.input) };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CopilotIntelligenceToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new Error("Keystone intelligence was cancelled.");
    const result = await this.execute(options.input, token);
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)]);
  }
}
