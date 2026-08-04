import type { GeneratedStory } from "./storyGenerator";

export interface ValueEdgeFeature {
  id: string;
  name: string;
  description?: string;
}

export interface ValueEdgeConfig {
  baseUrl: string;
  sharedSpaceId: string;
  workspaceId: string;
  authorization: string;
}

export class ValueEdgeRestClient {
  private readonly config: ValueEdgeConfig;
  constructor(config: ValueEdgeConfig) { this.config = config; }

  async fetchFeature(id: string): Promise<ValueEdgeFeature> {
    const url = `${this.workspaceUrl(`features/${encodeURIComponent(id)}`)}?fields=id,name,description`;
    const response = await fetch(url, { headers: this.headers() });
    if (!response.ok) throw new Error(`ValueEdge feature request failed (${response.status} ${response.statusText}).`);
    const raw = await response.json() as Record<string, unknown>;
    const entity = Array.isArray(raw.data) ? raw.data[0] as Record<string, unknown> | undefined : raw;
    if (!entity || !entity.id) throw new Error(`ValueEdge feature ${id} was not found.`);
    return {
      id: String(entity.id),
      name: String(entity.name ?? `Feature ${id}`),
      description: plainText(String(entity.description ?? "")),
    };
  }

  async publish(featureId: string, stories: GeneratedStory[]): Promise<void> {
    const groups = new Map<GeneratedStory["kind"], GeneratedStory[]>();
    for (const story of stories) groups.set(story.kind, [...(groups.get(story.kind) ?? []), story]);
    for (const [kind, items] of groups) {
      const resource = kind === "story" ? "stories" : "quality_stories";
      const payload = { data: items.map((item) => ({
        name: item.name.slice(0, 255),
        description: item.description,
        parent: { type: "feature", id: featureId },
        is_draft: true,
      })) };
      const response = await fetch(this.workspaceUrl(resource), {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`ValueEdge ${resource} publish failed (${response.status}): ${detail.slice(0, 600)}`);
      }
    }
  }

  private workspaceUrl(resource: string): string {
    const c = this.config;
    return `${c.baseUrl.replace(/\/$/, "")}/api/shared_spaces/${encodeURIComponent(c.sharedSpaceId)}/workspaces/${encodeURIComponent(c.workspaceId)}/${resource}`;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: this.config.authorization,
    };
  }
}

function plainText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
