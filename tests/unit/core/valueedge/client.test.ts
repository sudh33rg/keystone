import { describe, expect, it } from "../../../support/testkit";
import { ValueEdgeClient } from "@core/integration/valueedge/client";
import type { FetchLikeResponse } from "@core/integration/valueedge/types";

function response(body: unknown, status = 200, setCookie?: string): FetchLikeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: {
      get: (name) => (name.toLowerCase() === "set-cookie" ? (setCookie ?? null) : null),
      getSetCookie: () => (setCookie ? [setCookie] : [])
    },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

describe("ValueEdgeClient", () => {
  it("imports a feature and publishes approved draft user and quality stories without persisting a secret", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let created = 100;
    const client = new ValueEdgeClient(
      {
        baseUrl: "https://valueedge.example",
        sharedSpaceId: "1",
        workspaceId: "2",
        clientId: "client"
      },
      "secret",
      async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/authentication/sign_in"))
          return response({}, 200, "LWSSO_COOKIE_KEY=abc; Path=/; HttpOnly");
        if (url.endsWith("/authentication/sign_out")) return response({});
        if (url.includes("/features/42"))
          return response({
            data: [{ id: "42", name: "Audit feature", description: "Add auditing" }]
          });
        if (init?.method === "POST") return response({ data: [{ id: String(created++) }] });
        return response({}, 404);
      }
    );
    const feature = await client.fetchFeature("42");
    expect(feature.name).toBe("Audit feature");
    const result = await client.publishBacklogStories("42", [
      {
        id: "u",
        kind: "user-story",
        title: "User",
        description: "Do it",
        acceptanceCriteria: ["Works"],
        linkedSdlcStoryTypes: ["development"],
        status: "approved"
      },
      {
        id: "q",
        kind: "quality-story",
        title: "Quality",
        description: "Test it",
        acceptanceCriteria: ["Passes"],
        linkedSdlcStoryTypes: ["new-test-creation"],
        status: "approved"
      },
      {
        id: "d",
        kind: "user-story",
        title: "Draft",
        description: "No",
        acceptanceCriteria: [],
        linkedSdlcStoryTypes: [],
        status: "draft"
      }
    ]);
    expect(result.map((item) => item.kind)).toEqual(["user-story", "quality-story"]);
    expect(calls.some((call) => call.url.includes("/stories"))).toBe(true);
    expect(calls.some((call) => call.url.includes("/quality_stories"))).toBe(true);
    expect(
      calls
        .filter((call) => call.url.includes("/workspaces/"))
        .some((call) => String(call.init?.body).includes("secret"))
    ).toBe(false);
  });
});
