import type { SDLCBacklogStory } from "../../workflow/sdlc/engine";

export interface ValueEdgeConnection {
  baseUrl: string;
  sharedSpaceId: string;
  workspaceId: string;
  clientId: string;
}

export interface ValueEdgeFeature {
  id: string;
  name: string;
  description?: string;
  phase?: string;
  release?: string;
  sprint?: string;
  owner?: string;
  webUrl?: string;
}

export interface ValueEdgePublishResult {
  localId: string;
  externalId: string;
  kind: SDLCBacklogStory["kind"];
  title: string;
}

export interface FetchLikeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null; getSetCookie?(): string[] };
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<FetchLikeResponse>;
