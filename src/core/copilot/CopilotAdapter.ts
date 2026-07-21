import {
  CopilotAgentDescriptorSchema,
  CopilotCapabilitiesSchema,
  type CopilotAgentDescriptor,
  type CopilotCapabilities,
  type PreparedDelegation,
} from "../../shared/contracts/delegation";

export const COPILOT_COMMAND_ALLOWLIST = Object.freeze([
  "workbench.action.chat.open",
  "workbench.action.chat.openEditSession",
] as const);
export type SupportedCopilotCommand = (typeof COPILOT_COMMAND_ALLOWLIST)[number];

export interface CopilotExtensionEvidence {
  id: string;
  version: string;
  active: boolean;
}
export interface DirectInvocationResult {
  handle: string;
  status: "delegating" | "executing";
}

export interface CopilotEnvironment {
  listExtensions(): Promise<CopilotExtensionEvidence[]>;
  listCommands(): Promise<string[]>;
  integrationMethods(): Promise<string[]>;
  discoverAgents?(signal: AbortSignal): Promise<CopilotAgentDescriptor[]>;
  invokeDirect?(prepared: PreparedDelegation, signal: AbortSignal): Promise<DirectInvocationResult>;
  executeAllowedCommand(command: SupportedCopilotCommand): Promise<void>;
  insertPrompt?(prompt: string): Promise<void>;
  writeClipboard(prompt: string): Promise<void>;
}

export interface CopilotAdapter {
  refreshCapabilities(signal?: AbortSignal): Promise<CopilotCapabilities>;
  getCapabilities(): CopilotCapabilities | undefined;
  discoverAgents(signal?: AbortSignal): Promise<CopilotAgentDescriptor[]>;
  invokeDirect(prepared: PreparedDelegation, signal?: AbortSignal): Promise<DirectInvocationResult>;
  openCopilot(): Promise<void>;
  insertPrompt(prompt: string): Promise<void>;
  copyPrompt(prompt: string): Promise<void>;
}

export class CopilotCapabilityDetector {
  constructor(private readonly environment: CopilotEnvironment) {}

  async detect(signal: AbortSignal = new AbortController().signal): Promise<CopilotCapabilities> {
    const started = performance.now();
    signal.throwIfAborted();
    const [extensions, commands, methods] = await Promise.all([
      this.environment.listExtensions(),
      this.environment.listCommands(),
      this.environment.integrationMethods(),
    ]);
    signal.throwIfAborted();
    const copilotExtensions = extensions.filter(
      (item) => item.id === "github.copilot" || item.id === "github.copilot-chat",
    );
    const extensionDetected = copilotExtensions.length > 0;
    const extensionVersions = Object.fromEntries(
      copilotExtensions.map((item) => [item.id, item.version]),
    );
    const activeChat = copilotExtensions.some(
      (item) => item.id === "github.copilot-chat" && item.active,
    );
    const chatAvailable = activeChat && commands.includes("workbench.action.chat.open");
    const agentModeAvailable =
      activeChat &&
      commands.includes("workbench.action.chat.openEditSession") &&
      methods.includes("agent-mode-ui-v1");
    const agentDiscoveryAvailable =
      methods.includes("agent-discovery-v1") &&
      typeof this.environment.discoverAgents === "function";
    const directInvocationAvailable =
      methods.includes("direct-agent-delegation-v1") &&
      typeof this.environment.invokeDirect === "function";
    const promptInsertionAvailable =
      methods.includes("chat-prompt-insertion-v1") &&
      typeof this.environment.insertPrompt === "function";
    const completionEventsAvailable = methods.includes("delegation-completion-events-v1");
    const resultCaptureAvailable = methods.includes("delegation-result-capture-v1");
    const diagnostics = [];
    if (!extensionDetected)
      diagnostics.push({
        code: "copilot-absent",
        severity: "warning" as const,
        message: "No GitHub Copilot extension is installed; context preparation remains available.",
      });
    else if (!activeChat)
      diagnostics.push({
        code: "copilot-chat-inactive",
        severity: "warning" as const,
        message: "GitHub Copilot Chat is not active in this VS Code window.",
      });
    if (!agentDiscoveryAvailable)
      diagnostics.push({
        code: "agent-discovery-unavailable",
        severity: "info" as const,
        message:
          "No supported runtime agent-discovery method is available. Configured profiles remain non-authoritative.",
      });
    if (!directInvocationAvailable)
      diagnostics.push({
        code: "direct-invocation-unavailable",
        severity: "info" as const,
        message:
          "No supported direct agent invocation method is available; Keystone will use an assisted or clipboard workflow.",
      });
    if (!completionEventsAvailable)
      diagnostics.push({
        code: "completion-events-unavailable",
        severity: "info" as const,
        message:
          "Copilot completion events are unavailable, so Keystone will require user confirmation.",
      });
    const fingerprint = await digest(
      JSON.stringify({
        extensionVersions,
        chatAvailable,
        agentModeAvailable,
        agentDiscoveryAvailable,
        directInvocationAvailable,
        promptInsertionAvailable,
        completionEventsAvailable,
        resultCaptureAvailable,
        methods: [...methods].sort(),
      }),
    );
    return CopilotCapabilitiesSchema.parse({
      schemaVersion: 1,
      detectedAt: new Date().toISOString(),
      extensionDetected,
      extensionVersions,
      chatAvailable,
      agentModeAvailable,
      agentDiscoveryAvailable,
      directInvocationAvailable,
      promptInsertionAvailable,
      completionEventsAvailable,
      resultCaptureAvailable,
      supportedInvocationMethods: methods.slice(0, 20),
      diagnostics,
      fingerprint,
      discoveryDurationMs: performance.now() - started,
    });
  }
}

export class CapabilityDrivenCopilotAdapter implements CopilotAdapter {
  private current?: CopilotCapabilities;
  constructor(
    private readonly environment: CopilotEnvironment,
    private readonly detector = new CopilotCapabilityDetector(environment),
  ) {}

  async refreshCapabilities(signal?: AbortSignal): Promise<CopilotCapabilities> {
    this.current = await this.detector.detect(signal);
    return this.current;
  }
  getCapabilities(): CopilotCapabilities | undefined {
    return this.current;
  }

  async discoverAgents(
    signal: AbortSignal = new AbortController().signal,
  ): Promise<CopilotAgentDescriptor[]> {
    const capabilities = this.current ?? (await this.refreshCapabilities(signal));
    if (!capabilities.agentDiscoveryAvailable || !this.environment.discoverAgents) return [];
    const agents = await this.environment.discoverAgents(signal);
    signal.throwIfAborted();
    return agents.slice(0, 100).map((agent) =>
      CopilotAgentDescriptorSchema.parse({
        ...agent,
        source: "copilot-discovered",
        availability: "available",
        evidence: [
          ...agent.evidence,
          {
            kind: "runtime",
            source: "supported-agent-discovery",
            statement:
              "The active Copilot adapter returned this agent through a supported discovery method.",
          },
        ],
      }),
    );
  }

  async invokeDirect(
    prepared: PreparedDelegation,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<DirectInvocationResult> {
    const capabilities = this.current ?? (await this.refreshCapabilities(signal));
    if (!capabilities.directInvocationAvailable || !this.environment.invokeDirect)
      throw unavailable("direct agent invocation");
    const result = await this.environment.invokeDirect(prepared, signal);
    if (!result.handle.trim())
      throw new Error("The supported Copilot invocation returned no execution handle.");
    return result;
  }

  async openCopilot(): Promise<void> {
    const capabilities = this.current ?? (await this.refreshCapabilities());
    if (!capabilities.chatAvailable) throw unavailable("Copilot Chat");
    await this.environment.executeAllowedCommand(
      capabilities.agentModeAvailable
        ? "workbench.action.chat.openEditSession"
        : "workbench.action.chat.open",
    );
  }

  async insertPrompt(prompt: string): Promise<void> {
    const capabilities = this.current ?? (await this.refreshCapabilities());
    if (!capabilities.promptInsertionAvailable || !this.environment.insertPrompt)
      throw unavailable("prompt insertion");
    await this.environment.insertPrompt(prompt);
  }

  copyPrompt(prompt: string): Promise<void> {
    return this.environment.writeClipboard(prompt);
  }
}

function unavailable(capability: string): Error {
  const error = new Error(`Copilot capability unavailable: ${capability}.`);
  error.name = "CopilotCapabilityUnavailableError";
  return error;
}
async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("")}`;
}
