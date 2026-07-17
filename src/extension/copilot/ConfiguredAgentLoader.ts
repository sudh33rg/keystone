import type { AgentSelectionRule, CopilotAgentRegistry } from "../../core/copilot/AgentRegistry";
import { AgentCapabilitySchema, DelegationTaskCategorySchema } from "../../shared/contracts/delegation";
import type { CopilotAgentDescriptor } from "../../shared/contracts/delegation";
import type { WorkspaceAdapter } from "../adapters/WorkspaceAdapter";

/** Loads inert metadata only. Profile files are JSON and are never imported or executed. */
export class ConfiguredAgentLoader {
  constructor(private readonly workspace: WorkspaceAdapter, private readonly registry: CopilotAgentRegistry) {}

  async load(): Promise<CopilotAgentDescriptor[]> {
    const configured = this.workspace.getConfiguration("keystone.agents");
    const profiles = this.registry.discovery.parseConfigured(configured.get<unknown[]>("profiles", []), "workspace-configured");
    const aliases = this.registry.discovery.parseConfigured(configured.get<unknown[]>("aliases", []), "user-alias");
    this.registry.setSelectionRules(parseRules(configured.get<unknown[]>("rules", [])));
    const repository: CopilotAgentDescriptor[] = [];
    for (const root of this.workspace.getRoots().slice(0, 20)) {
      try {
        const uri = this.workspace.fileReference(root, ".keystone/agents.json").uri;
        const value: unknown = JSON.parse((await this.workspace.readTextFile(uri)).slice(0, 200_000));
        const entries = Array.isArray(value) ? value : value && typeof value === "object" && "profiles" in value ? value.profiles : [];
        repository.push(...this.registry.discovery.parseConfigured(entries, "repository-configured"));
      } catch {
        // Missing or malformed optional configuration never fabricates an agent.
      }
    }
    const result = [...profiles, ...repository, ...aliases].slice(0, 200);
    this.registry.setConfiguredProfiles(result);
    return result;
  }
}

function parseRules(values: unknown[]): AgentSelectionRule[] {
  return values.slice(0, 100).flatMap((value) => {
    if (!value || typeof value !== "object") return []; const item = value as Record<string, unknown>;
    if (typeof item.id !== "string" || typeof item.agentId !== "string") return [];
    const category = DelegationTaskCategorySchema.safeParse(item.category); const capability = AgentCapabilitySchema.safeParse(item.requiredCapability);
    return [{ id: item.id.slice(0, 200), agentId: item.agentId.slice(0, 200), ...(category.success ? { category: category.data } : {}), ...(capability.success ? { requiredCapability: capability.data } : {}) }];
  });
}
