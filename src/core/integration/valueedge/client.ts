import type { SDLCBacklogStory } from "../../workflow/sdlc/engine";
import type {
  FetchLike,
  FetchLikeResponse,
  ValueEdgeConnection,
  ValueEdgeFeature,
  ValueEdgePublishResult
} from "./types";

export class ValueEdgeClient {
  private cookie = "";
  private readonly baseUrl: string;

  constructor(
    private readonly connection: ValueEdgeConnection,
    private readonly clientSecret: string,
    private readonly fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike
  ) {
    this.baseUrl = connection.baseUrl.replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(this.baseUrl))
      throw new Error("ValueEdge base URL must use HTTP or HTTPS.");
    if (
      !connection.sharedSpaceId.trim() ||
      !connection.workspaceId.trim() ||
      !connection.clientId.trim() ||
      !clientSecret.trim()
    ) {
      throw new Error(
        "ValueEdge base URL, shared space, workspace, client ID, and client secret are required."
      );
    }
  }

  async fetchFeature(featureId: string): Promise<ValueEdgeFeature> {
    return this.withSession(async () => {
      const raw = await this.requestJson(
        `${this.contextPath}/features/${encodeURIComponent(featureId)}?fields=id,name,description,phase,release,sprint,owner`
      );
      const item = unwrapSingle(raw);
      return {
        id: stringValue(item.id, featureId),
        name: stringValue(item.name, `Feature ${featureId}`),
        description: optionalString(item.description),
        phase: referenceLabel(item.phase),
        release: referenceLabel(item.release),
        sprint: referenceLabel(item.sprint),
        owner: referenceLabel(item.owner),
        webUrl: `${this.baseUrl}/ui/?p=${encodeURIComponent(this.connection.sharedSpaceId)}/${encodeURIComponent(this.connection.workspaceId)}#/entity-navigation?entityType=feature&id=${encodeURIComponent(featureId)}`
      };
    });
  }

  async publishBacklogStories(
    featureId: string,
    stories: readonly SDLCBacklogStory[]
  ): Promise<ValueEdgePublishResult[]> {
    const publishable = stories.filter((story) => story.status === "approved");
    if (!publishable.length) return [];
    return this.withSession(async () => {
      const results: ValueEdgePublishResult[] = [];
      for (const story of publishable) {
        const resource = story.kind === "quality-story" ? "quality_stories" : "stories";
        const payload = {
          data: [
            {
              name: story.title,
              description: formatDescription(story),
              parent: { type: "feature", id: featureId },
              is_draft: true
            }
          ]
        };
        const raw = await this.requestJson(`${this.contextPath}/${resource}`, {
          method: "POST",
          headers: { "content-type": "application/json", "ALM-OCTANE-TECH-PREVIEW": "true" },
          body: JSON.stringify(payload)
        });
        const created = unwrapCreated(raw);
        results.push({
          localId: story.id,
          externalId: stringValue(created.id, ""),
          kind: story.kind,
          title: story.title
        });
      }
      return results;
    });
  }

  private get contextPath(): string {
    return `${this.baseUrl}/api/shared_spaces/${encodeURIComponent(this.connection.sharedSpaceId)}/workspaces/${encodeURIComponent(this.connection.workspaceId)}`;
  }

  private async withSession<T>(operation: () => Promise<T>): Promise<T> {
    await this.signIn();
    try {
      return await operation();
    } finally {
      await this.signOut();
    }
  }

  private async signIn(): Promise<void> {
    const response = await this.fetchImpl(`${this.baseUrl}/authentication/sign_in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_id: this.connection.clientId,
        client_secret: this.clientSecret
      })
    });
    await assertOk(response, "ValueEdge sign-in");
    const cookies =
      response.headers.getSetCookie?.() ?? splitSetCookie(response.headers.get("set-cookie"));
    this.cookie = cookies
      .map((value) => value.split(";", 1)[0])
      .filter(Boolean)
      .join("; ");
  }

  private async signOut(): Promise<void> {
    try {
      await this.fetchImpl(`${this.baseUrl}/authentication/sign_out`, {
        method: "POST",
        headers: this.cookie ? { cookie: this.cookie } : undefined
      });
    } finally {
      this.cookie = "";
    }
  }

  private async requestJson(url: string, init: RequestInit = {}): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (this.cookie) headers.set("cookie", this.cookie);
    const response = await this.fetchImpl(url, { ...init, headers });
    await assertOk(response, "ValueEdge request");
    return response.json();
  }
}

async function assertOk(response: FetchLikeResponse, operation: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  throw new Error(
    `${operation} failed (${response.status} ${response.statusText})${body ? `: ${body.slice(0, 500)}` : ""}`
  );
}
function unwrapSingle(raw: unknown): Record<string, unknown> {
  const object = asObject(raw);
  const data = Array.isArray(object.data) ? object.data : [];
  return asObject(data[0] ?? object);
}
function unwrapCreated(raw: unknown): Record<string, unknown> {
  const object = asObject(raw);
  const data = Array.isArray(object.data) ? object.data : [];
  return asObject(data[0] ?? object);
}
function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value
    : typeof value === "number"
      ? String(value)
      : fallback;
}
function optionalString(value: unknown): string | undefined {
  const result = stringValue(value, "");
  return result || undefined;
}
function referenceLabel(value: unknown): string | undefined {
  const object = asObject(value);
  return optionalString(object.name ?? object.label ?? value);
}
function splitSetCookie(value: string | null): string[] {
  return value ? value.split(/,(?=\s*[^;,]+=)/) : [];
}
function formatDescription(story: SDLCBacklogStory): string {
  return `${story.description}\n\nAcceptance criteria:\n${story.acceptanceCriteria.map((item) => `- ${item}`).join("\n")}\n\nGenerated by Keystone from approved repository intelligence and SDLC research.`;
}
