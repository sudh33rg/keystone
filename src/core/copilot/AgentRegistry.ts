import type { CopilotAdapter } from "./CopilotAdapter";
import {
  type AgentProfile,
  type AgentAssignment,
  AgentProfileSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export type AgentSelectionMode = "manual" | "recommended" | "automatic" | "fixed";

export interface AgentSelectionResult {
  agentId: string;
  mode: AgentSelectionMode;
  candidates: { agentId: string; reason: string; score: number }[];
  confidence: number;
}

export class AgentRegistry {
  private profiles = new Map<string, AgentProfile>();
  private assignments = new Map<string, AgentAssignment>();
  private selectionMode: AgentSelectionMode = "recommended";

  constructor(
    private readonly copilotAdapter: CopilotAdapter,
    private readonly configuration: { read(): { agents: { selectionMode: AgentSelectionMode } } }
  ) {
    this.selectionMode = configuration.read().agents.selectionMode;
  }

  async discover(): Promise<AgentProfile[]> {
    const agents = await this.copilotAdapter.listAgents();
    const fingerprint = this.copilotAdapter.getCapabilityFingerprint();

    for (const agent of agents) {
      const profile: AgentProfile = {
        id: agent.id,
        displayName: agent.displayName,
        description: agent.description,
        source: "copilot",
        availability: "available",
        supportedTaskCategories: this.inferTaskCategories(agent.capabilities),
        toolsAndActions: agent.capabilities,
        repositoryAccessExpectations: [],
        strengths: this.inferStrengths(agent.capabilities),
        restrictions: [],
        defaultContextPolicy: {
          maxEstimatedTokens: agent.contextRestrictions.maxEstimatedTokens,
          includeTests: agent.contextRestrictions.includeTests
        },
        discoveredAt: new Date().toISOString(),
        capabilityFingerprint: fingerprint ? JSON.stringify(fingerprint) : ""
      };

      const validated = AgentProfileSchema.safeParse(profile);
      if (validated.success) {
        this.profiles.set(profile.id, validated.data);
      }
    }

    return Array.from(this.profiles.values());
  }

  getProfiles(): AgentProfile[] {
    return Array.from(this.profiles.values());
  }

  getProfile(agentId: string): AgentProfile | undefined {
    return this.profiles.get(agentId);
  }

  setSelectionMode(mode: AgentSelectionMode): void {
    this.selectionMode = mode;
  }

  getSelectionMode(): AgentSelectionMode {
    return this.selectionMode;
  }

  assign(taskId: string, workflowId: string, agentId: string): AgentAssignment {
    const profile = this.profiles.get(agentId);
    if (!profile) {
      throw new KeystoneError({
        code: "AGENT_NOT_FOUND",
        category: "AGENT",
        message: `Agent ${agentId} not found.`,
        operation: "agent.assign",
        recoverable: false,
        recommendedAction: "Discover available agents and retry."
      });
    }

    const assignment: AgentAssignment = {
      selectionMode: this.selectionMode,
      taskId,
      workflowId,
      agentId,
      recommendationCandidates: [],
      userConfirmed: true,
      assignedAt: new Date().toISOString(),
      capabilityFingerprint: profile.capabilityFingerprint
    };

    this.assignments.set(taskId, assignment);
    return assignment;
  }

  getAssignment(taskId: string): AgentAssignment | undefined {
    return this.assignments.get(taskId);
  }

  select(taskId: string): AgentSelectionResult {
    const mode = this.selectionMode;
    const profiles = this.getProfiles();

    if (mode === "manual") {
      return {
        agentId: profiles[0]?.id ?? "",
        mode: "manual",
        candidates: profiles.map((p) => ({ agentId: p.id, reason: p.description, score: 1 })),
        confidence: profiles.length > 0 ? 0.5 : 0
      };
    }

    if (mode === "fixed") {
      const fixed = profiles.find((p) => p.id === "default") ?? profiles[0];
      return {
        agentId: fixed?.id ?? "",
        mode: "fixed",
        candidates: fixed ? [{ agentId: fixed.id, reason: fixed.description, score: 1 }] : [],
        confidence: fixed ? 0.9 : 0
      };
    }

    // Automatic or recommended: pick the best agent for the task
    const candidates = this.rankCandidates(taskId, profiles);
    const best = candidates[0];

    return {
      agentId: best?.agentId ?? "",
      mode: mode,
      candidates: candidates.map((c) => ({ agentId: c.agentId, reason: c.reason, score: c.score })),
      confidence: best?.score ?? 0
    };
  }

  private rankCandidates(taskId: string, profiles: AgentProfile[]): { agentId: string; reason: string; score: number }[] {
    const candidates: { agentId: string; reason: string; score: number }[] = [];

    for (const profile of profiles) {
      let score = 0;

      // Higher availability score
      if (profile.availability === "available") score += 10;
      else if (profile.availability === "configured") score += 5;
      else if (profile.availability === "unknown") score += 2;

      // Task category match
      if (profile.supportedTaskCategories.includes("implementation")) score += 5;
      if (profile.supportedTaskCategories.includes("testing")) score += 3;
      if (profile.supportedTaskCategories.includes("review")) score += 3;

      candidates.push({
        agentId: profile.id,
        reason: profile.description,
        score
      });
    }

    return candidates.sort((a, b) => b.score - a.score);
  }

  private inferTaskCategories(capabilities: string[]): string[] {
    const categories: string[] = [];

    if (capabilities.includes("chat") || capabilities.includes("edit")) categories.push("implementation");
    if (capabilities.includes("test")) categories.push("testing");
    if (capabilities.includes("review")) categories.push("review");
    if (capabilities.includes("debug")) categories.push("debugging");
    if (capabilities.includes("explain")) categories.push("documentation");

    return categories;
  }

  private inferStrengths(capabilities: string[]): string[] {
    const strengths: string[] = [];
    if (capabilities.includes("chat")) strengths.push("Conversational reasoning");
    if (capabilities.includes("edit")) strengths.push("Code editing");
    if (capabilities.includes("inline-completion")) strengths.push("Inline completion");
    if (capabilities.includes("test")) strengths.push("Test generation");
    if (capabilities.includes("review")) strengths.push("Code review");
    if (capabilities.includes("debug")) strengths.push("Debugging");
    if (capabilities.includes("explain")) strengths.push("Explanation");
    return strengths;
  }
}
