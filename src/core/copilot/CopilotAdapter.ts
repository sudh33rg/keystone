import * as vscode from "vscode";

export type CopilotCapability =
  | "code-action"
  | "inline-completion"
  | "chat"
  | "terminal"
  | "edit"
  | "explain"
  | "test"
  | "review"
  | "debug";

export interface CopilotCapabilityFingerprint {
  capabilities: CopilotCapability[];
  version: string;
  model?: string;
  contextWindow?: number;
}

export interface CopilotAdapter {
  discoverCapabilities(): Promise<CopilotCapabilityFingerprint>;
  isAvailable(): boolean;
  getCapabilityFingerprint(): CopilotCapabilityFingerprint | undefined;
  isCapable(capability: CopilotCapability): boolean;
  listAgents(): Promise<AgentInfo[]>;
  getAgentInfo(agentId: string): Promise<AgentInfo | undefined>;
  delegate(task: DelegationRequest): Promise<DelegationResult>;
  getAgentContextRestrictions(agentId: string): ContextRestrictions;
  detectDegradation(): boolean;
}

export interface AgentInfo {
  id: string;
  displayName: string;
  description: string;
  capabilities: CopilotCapability[];
  contextRestrictions: ContextRestrictions;
}

export interface ContextRestrictions {
  maxEstimatedTokens: number;
  includeTests: boolean;
  allowedFilePatterns: string[];
  excludedFilePatterns: string[];
}

export interface DelegationRequest {
  taskId: string;
  objective: string;
  description: string;
  contextPackage: {
    items: ContextItem[];
    fingerprint: string;
    estimatedTokens: number;
  };
  expectedOutput: string;
  acceptanceCriteria: string[];
  validationSteps: { command?: string; manualCheck?: string }[];
}

export interface ContextItem {
  kind: string;
  content: string;
  sourceReference: string;
  selectionReason: string;
}

export interface DelegationResult {
  method: "direct" | "assisted";
  success: boolean;
  externalHandle?: string;
  error?: string;
  observedChanges?: { files: string[]; commits: string[] };
}

export class VsCodeCopilotAdapter implements CopilotAdapter {
  private capabilityFingerprint: CopilotCapabilityFingerprint | undefined;
  private agents: AgentInfo[] = [];

  async discoverCapabilities(): Promise<CopilotCapabilityFingerprint> {
    if (this.capabilityFingerprint) return this.capabilityFingerprint;

    const extensions = vscode.extensions.all;
    const copilotExtension = extensions.find((ext) => ext.id === "github.copilot");
    const copilotChatExtension = extensions.find((ext) => ext.id === "github.copilot-chat");

    const capabilities: CopilotCapability[] = [];
    let version = "unknown";
    let model: string | undefined;
    let contextWindow: number | undefined;

    if (copilotExtension?.isActive) {
      capabilities.push("inline-completion");
      const packageVersion: unknown = (copilotExtension.packageJSON as { version?: unknown }).version;
      version = typeof packageVersion === "string" ? packageVersion : "unknown";
    }

    if (copilotChatExtension?.isActive) {
      capabilities.push("chat");
      capabilities.push("edit");
      capabilities.push("explain");
      capabilities.push("test");
      capabilities.push("review");
      capabilities.push("debug");
    }

    if (capabilities.length === 0) {
      this.capabilityFingerprint = { capabilities, version };
      return this.capabilityFingerprint;
    }

    try {
      const agentInfo = await vscode.commands.executeCommand<unknown>(
        "copilot.agent.list",
        undefined,
        undefined,
        undefined,
        undefined
      );
      if (agentInfo && typeof agentInfo === "object") {
        const info = agentInfo as Record<string, unknown>;
        if (typeof info.model === "string") model = info.model;
        if (typeof info.contextWindow === "number") contextWindow = info.contextWindow;
      }
    } catch {
      // Agent list not available; proceed without it
    }

    this.capabilityFingerprint = { capabilities, version, model, contextWindow };
    return this.capabilityFingerprint;
  }

  isAvailable(): boolean {
    return (this.capabilityFingerprint?.capabilities.length ?? 0) > 0;
  }

  getCapabilityFingerprint(): CopilotCapabilityFingerprint | undefined {
    return this.capabilityFingerprint;
  }

  isCapable(capability: CopilotCapability): boolean {
    return this.capabilityFingerprint?.capabilities.includes(capability) ?? false;
  }

  async listAgents(): Promise<AgentInfo[]> {
    if (this.agents.length > 0) return this.agents;

    const fingerprint = await this.discoverCapabilities();
    if (!fingerprint.capabilities.includes("chat")) return [];

    try {
      const agents = await vscode.commands.executeCommand<AgentInfo[]>("copilot.agent.list", undefined, undefined, undefined, undefined);
      if (agents && Array.isArray(agents)) {
        this.agents = agents.map((agent) => ({
          ...agent,
          contextRestrictions: {
            maxEstimatedTokens: 12000,
            includeTests: true,
            allowedFilePatterns: [],
            excludedFilePatterns: []
          }
        }));
      }
    } catch {
      // Fallback: create a default agent
      this.agents = [
        {
          id: "default",
          displayName: "Default",
          description: "Default Copilot agent.",
          capabilities: fingerprint.capabilities,
          contextRestrictions: {
            maxEstimatedTokens: 12000,
            includeTests: true,
            allowedFilePatterns: [],
            excludedFilePatterns: []
          }
        }
      ];
    }

    return this.agents;
  }

  async getAgentInfo(agentId: string): Promise<AgentInfo | undefined> {
    const agents = await this.listAgents();
    return agents.find((a) => a.id === agentId);
  }

  async delegate(request: DelegationRequest): Promise<DelegationResult> {
    const fingerprint = await this.discoverCapabilities();

    if (!fingerprint.capabilities.includes("chat")) {
      return {
        method: "assisted",
        success: false,
        error: "Copilot chat is not available. Use assisted delegation."
      };
    }

    try {
      const result = await vscode.commands.executeCommand<DelegationResult>(
        "copilot.agent.delegate",
        request.objective,
        request.contextPackage.items.map((item) => item.content).join("\n"),
        request.expectedOutput,
        request.validationSteps
      );

      if (result) {
        return {
          method: "direct",
          success: true,
          externalHandle: result.externalHandle,
          observedChanges: result.observedChanges
        };
      }
    } catch (error) {
      return {
        method: "assisted",
        success: false,
        error: error instanceof Error ? error.message : "Delegation failed."
      };
    }

    return {
      method: "assisted",
      success: true,
      error: "Copilot agent returned no result. Use assisted delegation."
    };
  }

  getAgentContextRestrictions(): ContextRestrictions {
    return {
      maxEstimatedTokens: 12000,
      includeTests: true,
      allowedFilePatterns: [],
      excludedFilePatterns: []
    };
  }

  detectDegradation(): boolean {
    return false;
  }
}
