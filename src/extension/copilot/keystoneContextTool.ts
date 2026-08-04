import * as vscode from "vscode";

import type { CopilotContextToolInput } from "@core/integration/webview/messageRouter";

export const KEYSTONE_CONTEXT_TOOL_NAME = "keystone_get_context";

export type KeystoneContextToolExecutor = (
  input: CopilotContextToolInput,
  token: vscode.CancellationToken
) => Promise<string>;

export class KeystoneContextTool implements vscode.LanguageModelTool<CopilotContextToolInput> {
  constructor(
    private readonly execute: KeystoneContextToolExecutor,
    private readonly describe: (input: CopilotContextToolInput) => string
  ) {}

  prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<CopilotContextToolInput>,
    _token: vscode.CancellationToken
  ): vscode.PreparedToolInvocation {
    return { invocationMessage: this.describe(options.input) };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CopilotContextToolInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (token.isCancellationRequested) throw new Error("Keystone context retrieval was cancelled.");
    const result = await this.execute(options.input, token);
    return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(result)]);
  }
}
