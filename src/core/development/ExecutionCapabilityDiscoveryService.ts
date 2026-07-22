import type { DiscoveredAgent, ExecutionCapability, ManualAgentConfiguration } from "../../shared/contracts/executionConfiguration";

export interface ExecutionCapabilityAdapter {
  clipboardAvailable(): Promise<boolean>;
  registeredCommands(): Promise<string[]>;
  discoveredAgents(): Promise<DiscoveredAgent[]>;
}

export interface ExecutionCapabilityDiscovery {
  capabilities: ExecutionCapability[];
  agents: DiscoveredAgent[];
  manualAgents: ManualAgentConfiguration[];
  diagnostics: Array<{ code: string; message: string }>;
}

export class ExecutionCapabilityDiscoveryService {
  private cached?: { clipboard: boolean; commands: Set<string>; agents: DiscoveredAgent[]; diagnostics: Array<{ code: string; message: string }> };
  constructor(private readonly adapter: ExecutionCapabilityAdapter) {}

  invalidate(): void { this.cached = undefined; }

  async discover(manualAgents: ManualAgentConfiguration[]): Promise<ExecutionCapabilityDiscovery> {
    const base = this.cached ?? await this.resolve(); this.cached = base;
    const capabilities: ExecutionCapability[] = [
      base.clipboard
        ? { id: "clipboard-handoff", kind: "clipboard-handoff", displayName: "Clipboard Handoff", availability: "available", source: "vscode-api" }
        : { id: "clipboard-handoff", kind: "clipboard-handoff", displayName: "Clipboard Handoff", availability: "unavailable", source: "vscode-api", diagnostic: { code: "clipboard-unavailable", message: "The VS Code clipboard API is unavailable in this host." } },
      { id: "manual-work", kind: "manual-work", displayName: "Manual Work", availability: "available", source: "keystone" },
      { id: "direct-agent-invocation", kind: "direct-agent-invocation", displayName: "Direct Invocation", availability: "unavailable", source: "keystone", diagnostic: { code: "unsupported-direct-invocation", message: "No supported direct agent invocation API is available to Keystone." } },
    ];
    const chatCommand = ["workbench.action.chat.open", "workbench.action.chat.openQuickChat"].find((id) => base.commands.has(id));
    if (chatCommand) capabilities.splice(1, 0, { id: `chat-command:${chatCommand}`, kind: "chat-command-handoff", displayName: "Supported Chat Command", availability: "available", source: "registered-command", commandId: chatCommand });
    return {
      capabilities,
      agents: base.agents.filter((agent) => agent.availability === "available"),
      manualAgents: manualAgents.map((agent) => ({ ...agent, commandAvailable: agent.chatCommandId ? base.commands.has(agent.chatCommandId) : false })),
      diagnostics: base.diagnostics,
    };
  }

  async commandExists(commandId: string): Promise<boolean> { const base = this.cached ?? await this.resolve(); this.cached = base; return base.commands.has(commandId); }

  private async resolve() {
    const diagnostics: Array<{ code: string; message: string }> = [];
    let clipboard = false; let commands = new Set<string>(); let agents: DiscoveredAgent[] = [];
    try { clipboard = await this.adapter.clipboardAvailable(); } catch (cause) { diagnostics.push({ code: "capability-discovery-failed", message: message(cause) }); }
    try { commands = new Set(await this.adapter.registeredCommands()); } catch (cause) { diagnostics.push({ code: "capability-discovery-failed", message: message(cause) }); }
    try { agents = await this.adapter.discoveredAgents(); } catch (cause) { diagnostics.push({ code: "capability-discovery-failed", message: message(cause) }); }
    return { clipboard, commands, agents, diagnostics };
  }
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
