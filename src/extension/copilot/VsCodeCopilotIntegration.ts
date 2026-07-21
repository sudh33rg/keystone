import * as vscode from "vscode";
import type { KeystoneToolName } from "../../shared/contracts/copilotIntegration";
import type {
  CopilotToolExecutionService,
  CopilotToolRegistry,
} from "../../core/copilot/CopilotIntegrationService";
import type { KeystoneChatParticipantService } from "../../core/copilot/KeystoneChatAndLaunchService";

export class VsCodeCopilotIntegration {
  constructor(
    private readonly registry: CopilotToolRegistry,
    private readonly execution: CopilotToolExecutionService,
    private readonly participant: KeystoneChatParticipantService,
    private readonly enabled: () => { tools: boolean; participant: boolean },
  ) {}
  runtimeSurface(): { tools: boolean; participant: boolean } {
    const setting = this.enabled();
    return {
      tools: setting.tools && typeof vscode.lm?.registerTool === "function",
      participant: setting.participant && typeof vscode.chat?.createChatParticipant === "function",
    };
  }
  register(
    subscriptions: { push(...items: vscode.Disposable[]): unknown },
    currentScope: () => { workflowId?: string; taskId?: string; generation?: number },
  ): void {
    const surface = this.runtimeSurface();
    if (surface.tools)
      for (const descriptor of this.registry.list().filter((item) => item.available))
        subscriptions.push(
          vscode.lm.registerTool(descriptor.name, {
            invoke: async (options, token) => {
              const controller = cancellation(token);
              try {
                const result = await this.execution.execute(
                  descriptor.name,
                  options.input,
                  controller.signal,
                );
                return new vscode.LanguageModelToolResult([
                  vscode.LanguageModelDataPart.json(result),
                  new vscode.LanguageModelTextPart(JSON.stringify(result)),
                ]);
              } finally {
                controller.abort();
              }
            },
            prepareInvocation: () => ({
              invocationMessage: `Querying Keystone: ${descriptor.name}`,
            }),
          }),
        );
    if (surface.participant) {
      const participant = vscode.chat.createChatParticipant(
        "keystone.chat",
        async (request, _context, response, token) => {
          const controller = cancellation(token);
          try {
            const answer = await this.participant.answer(
              request.prompt,
              currentScope(),
              controller.signal,
            );
            response.markdown(new vscode.MarkdownString(answer.markdown));
            for (const action of answer.actions)
              if (action.command === "open-keystone")
                response.button({ command: "keystone.open", title: action.title });
            return { metadata: { deterministic: true, toolName: answer.toolName } };
          } catch (cause) {
            response.markdown(
              `Keystone could not complete the deterministic query: ${cause instanceof Error ? cause.message : String(cause)}`,
            );
            return { metadata: { deterministic: true, failed: true } };
          } finally {
            controller.abort();
          }
        },
      );
      participant.iconPath = new vscode.ThemeIcon("inspect");
      subscriptions.push(participant);
    }
  }
}
function cancellation(token: vscode.CancellationToken): AbortController {
  const controller = new AbortController();
  if (token.isCancellationRequested) controller.abort();
  const disposable = token.onCancellationRequested(() => {
    controller.abort();
    disposable.dispose();
  });
  return controller;
}
export function keystoneToolNames(): KeystoneToolName[] {
  return [
    "keystone_search_repository",
    "keystone_get_entity",
    "keystone_find_usages",
    "keystone_find_callers",
    "keystone_find_callees",
    "keystone_find_implementations",
    "keystone_find_tests",
    "keystone_find_impacted_tests",
    "keystone_show_path",
    "keystone_show_flow",
    "keystone_analyze_impact",
    "keystone_get_task",
    "keystone_get_specification",
    "keystone_get_acceptance_criteria",
    "keystone_get_task_context",
    "keystone_get_validation_state",
    "keystone_get_workflow_state",
  ];
}
