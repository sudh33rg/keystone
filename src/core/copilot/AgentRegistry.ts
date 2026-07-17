import type { CopilotAdapter } from "./CopilotAdapter";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import {
  AgentRecommendationSchema,
  CopilotAgentDescriptorSchema,
  type AgentCapability,
  type AgentRecommendation,
  type CopilotAgentDescriptor,
  type DevelopmentTask
} from "../../shared/contracts/delegation";

export type AgentSelectionMode = "manual" | "recommended" | "rule-based" | "fixed-workflow";
export interface AgentSelectionRule { id: string; category?: DevelopmentTask["category"]; requiredCapability?: AgentCapability; agentId: string }

export class CopilotAgentDiscoveryService {
  constructor(private readonly adapter: CopilotAdapter) {}
  discover(signal?: AbortSignal): Promise<CopilotAgentDescriptor[]> { return this.adapter.discoverAgents(signal); }

  parseConfigured(value: unknown, source: "workspace-configured" | "repository-configured" | "keystone-profile" | "user-alias"): CopilotAgentDescriptor[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 100).flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const candidate = raw as Record<string, unknown>;
      const parsed = CopilotAgentDescriptorSchema.safeParse({
        id: candidate.id, displayName: candidate.displayName, description: candidate.description, source,
        availability: "unknown", capabilities: candidate.capabilities ?? [], taskCategories: candidate.taskCategories ?? [],
        invocationMethod: candidate.invocationMethod, restrictions: candidate.restrictions ?? [{ kind: "invocation", description: "Configured metadata does not prove runtime invocation availability.", blocking: false }],
        confidence: typeof candidate.confidence === "number" ? Math.min(candidate.confidence, 0.8) : 0.6,
        evidence: [{ kind: source === "user-alias" ? "alias" : "configuration", source, statement: "Loaded as inert, schema-validated configuration; no code or commands were executed." }],
        aliasFor: candidate.aliasFor
      });
      return parsed.success ? [parsed.data] : [];
    });
  }
}

export class AgentProfileService {
  merge(discovered: CopilotAgentDescriptor[], configured: CopilotAgentDescriptor[]): CopilotAgentDescriptor[] {
    const result = new Map<string, CopilotAgentDescriptor>();
    for (const agent of configured) result.set(agent.id, agent);
    for (const agent of discovered) result.set(agent.id, agent);
    for (const agent of [...result.values()]) if (agent.source === "user-alias" && agent.aliasFor) {
      const target = result.get(agent.aliasFor);
      result.set(agent.id, { ...agent, availability: target?.availability ?? "unknown", capabilities: agent.capabilities.length ? agent.capabilities : target?.capabilities ?? [], taskCategories: agent.taskCategories.length ? agent.taskCategories : target?.taskCategories ?? [], invocationMethod: target?.invocationMethod, evidence: [...agent.evidence, ...(target ? [{ kind: "alias" as const, source: target.id, statement: "Availability is inherited from the explicitly referenced agent." }] : [])] });
    }
    return [...result.values()].sort((left, right) => availabilityRank(right.availability) - availabilityRank(left.availability) || left.displayName.localeCompare(right.displayName));
  }
}

export const AGENT_RECOMMENDATION_WEIGHTS = Object.freeze({ available: 100, unknown: 10, capability: 45, category: 30, userRule: 80, priorSelection: 20, restriction: -60, missingCapability: -100 });

export class AgentRecommendationService {
  recommend(task: DevelopmentTask, agents: CopilotAgentDescriptor[], mode: AgentSelectionMode = "recommended", rules: AgentSelectionRule[] = [], priorAgentId?: string): AgentRecommendation {
    const rule = rules.find((item) => (!item.category || item.category === task.category) && (!item.requiredCapability || task.requiredCapabilities.includes(item.requiredCapability)));
    const candidates = agents.map((agent) => {
      const matching = task.requiredCapabilities.filter((item) => agent.capabilities.includes(item));
      const missing = task.requiredCapabilities.filter((item) => !agent.capabilities.includes(item));
      const blocking = agent.restrictions.filter((item) => item.blocking);
      let score = agent.availability === "available" ? AGENT_RECOMMENDATION_WEIGHTS.available : agent.availability === "unknown" ? AGENT_RECOMMENDATION_WEIGHTS.unknown : -1000;
      score += matching.length * AGENT_RECOMMENDATION_WEIGHTS.capability + (agent.taskCategories.includes(task.category) ? AGENT_RECOMMENDATION_WEIGHTS.category : 0) + missing.length * AGENT_RECOMMENDATION_WEIGHTS.missingCapability + blocking.length * AGENT_RECOMMENDATION_WEIGHTS.restriction;
      if (rule?.agentId === agent.id) score += AGENT_RECOMMENDATION_WEIGHTS.userRule;
      if (priorAgentId === agent.id) score += AGENT_RECOMMENDATION_WEIGHTS.priorSelection;
      const reasons = [`availability=${agent.availability}`, `${matching.length}/${task.requiredCapabilities.length} required capabilities match`, ...(agent.taskCategories.includes(task.category) ? [`task category ${task.category} matches`] : []), ...(rule?.agentId === agent.id ? [`explicit rule ${rule.id} matches`] : []), ...(blocking.length ? [`${blocking.length} blocking restriction(s)`] : []), ...(missing.length ? [`missing: ${missing.join(", ")}`] : [])];
      return { agent, score, matchingCapabilities: matching, missingCapabilities: missing, restrictions: agent.restrictions, reasons };
    }).sort((left, right) => right.score - left.score || left.agent.id.localeCompare(right.agent.id)).map((item, index) => ({ ...item, rank: index + 1 }));
    const selectedAgentId = (mode === "rule-based" || mode === "fixed-workflow") && rule && candidates.some((item) => item.agent.id === rule.agentId && item.agent.availability !== "unavailable") ? rule.agentId : undefined;
    return AgentRecommendationSchema.parse({ taskId: task.id, candidates, ...(selectedAgentId ? { selectedAgentId } : {}), selectionMode: mode });
  }
}

export class AgentSelectionService {
  constructor(private readonly persistence?: DelegationPersistenceStore) {}
  get(taskId: string): string | undefined { return this.persistence?.snapshot.selections[taskId]; }
  async select(taskId: string, agent: CopilotAgentDescriptor, confirmed: boolean): Promise<string> {
    if (!confirmed) throw new Error("Agent selection requires explicit user confirmation.");
    if (agent.availability === "unavailable") throw new Error(`Agent ${agent.displayName} is unavailable.`);
    if (this.persistence) await this.persistence.update((state) => ({ ...state, selections: { ...state.selections, [taskId]: agent.id } }));
    return agent.id;
  }
}

export class CopilotAgentRegistry {
  private agents: CopilotAgentDescriptor[] = [];
  private configured: CopilotAgentDescriptor[] = [];
  private rules: AgentSelectionRule[] = [];
  readonly discovery: CopilotAgentDiscoveryService;
  readonly profiles = new AgentProfileService();
  readonly recommendations = new AgentRecommendationService();
  readonly selections: AgentSelectionService;
  constructor(private readonly adapter: CopilotAdapter, private readonly persistence?: DelegationPersistenceStore) { this.discovery = new CopilotAgentDiscoveryService(adapter); this.selections = new AgentSelectionService(persistence); }

  setConfiguredProfiles(configured: CopilotAgentDescriptor[]): void { this.configured = structuredClone(configured).slice(0, 200); }
  setSelectionRules(rules: AgentSelectionRule[]): void { this.rules = structuredClone(rules).slice(0, 100); }
  async refresh(configured: CopilotAgentDescriptor[] = this.configured, signal?: AbortSignal): Promise<CopilotAgentDescriptor[]> {
    this.setConfiguredProfiles(configured); const discovered = await this.discovery.discover(signal); this.agents = this.profiles.merge(discovered, this.configured);
    if (this.persistence) await this.persistence.update((state) => ({ ...state, agents: this.agents }));
    return this.getProfiles();
  }
  restore(): void { this.agents = this.persistence?.snapshot.agents ?? []; }
  getProfiles(): CopilotAgentDescriptor[] { return structuredClone(this.agents); }
  getProfile(agentId: string): CopilotAgentDescriptor | undefined { return this.agents.find((item) => item.id === agentId); }
  recommend(task: DevelopmentTask, mode?: AgentSelectionMode, rules: AgentSelectionRule[] = this.rules): AgentRecommendation { return this.recommendations.recommend(task, this.agents, mode, rules, this.selections.get(task.id)); }
}

/** Backward-compatible name retained while the production registry moves to evidence-backed descriptors. */
export class AgentRegistry extends CopilotAgentRegistry {}
function availabilityRank(value: CopilotAgentDescriptor["availability"]): number { return value === "available" ? 3 : value === "unknown" ? 2 : 1; }
