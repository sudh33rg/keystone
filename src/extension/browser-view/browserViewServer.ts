import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ApplicationStore } from "@core/application/applicationStore";
import type { WebviewToExtensionMessage } from "@core/integration/webview/messageRouter";

const SESSION_COOKIE = "keystone-browser";
const BOOTSTRAP_TTL_MS = 60_000;
const SESSION_TTL_SECONDS = 8 * 60 * 60;

interface BrowserSession {
  readonly id: string;
  readonly origin: string;
  readonly expiresAt: number;
}
interface BootstrapToken {
  readonly expiresAt: number;
}

export interface BrowserViewHandle {
  createBootstrapUrl(): string;
  dispose(): Promise<void>;
  broadcast(message: unknown): void;
}

export async function startBrowserViewServer(options: {
  mediaRoot: string;
  store: ApplicationStore;
  dispatch: (message: WebviewToExtensionMessage) => void | Promise<void>;
}): Promise<BrowserViewHandle> {
  const clients = new Map<ServerResponse, BrowserSession>();
  const bootstrapTokens = new Map<string, BootstrapToken>();
  const sessions = new Map<string, BrowserSession>();
  let localOrigin = "";

  const send = (response: ServerResponse, event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (message: unknown): void => {
    const now = Date.now();
    for (const [client, session] of clients) {
      if (session.expiresAt <= now) {
        clients.delete(client);
        client.end();
      } else {
        send(client, "message", message);
      }
    }
  };
  const subscription = options.store.subscribe((state) =>
    broadcast({ type: "APPLICATION_STATE", state })
  );

  const server = createServer(async (request, response) => {
    try {
      setSecurityHeaders(response);
      const requestUrl = new URL(request.url ?? "/", localOrigin || "http://127.0.0.1");
      pruneExpired(bootstrapTokens, sessions);

      if (requestUrl.pathname === "/health") {
        json(response, 200, { ok: true });
        return;
      }

      const bootstrap = requestUrl.searchParams.get("bootstrap");
      if (request.method === "GET" && requestUrl.pathname === "/" && bootstrap) {
        const entry = bootstrapTokens.get(bootstrap);
        if (!entry || entry.expiresAt <= Date.now()) {
          bootstrapTokens.delete(bootstrap);
          json(response, 401, {
            error: "The Browser View link is invalid or expired. Open it again from Keystone."
          });
          return;
        }
        bootstrapTokens.delete(bootstrap);
        const session: BrowserSession = {
          id: randomBytes(32).toString("base64url"),
          origin: requestOrigin(request),
          expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000
        };
        sessions.set(session.id, session);
        response.statusCode = 303;
        response.setHeader("Location", "/");
        response.setHeader(
          "Set-Cookie",
          `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${isSecureRequest(request) ? "; Secure" : ""}`
        );
        response.end();
        return;
      }

      const session = authenticate(request, sessions);
      if (!session) {
        json(response, 401, {
          error: "Unauthorized. Open Browser View from the active Keystone extension."
        });
        return;
      }

      if (requestUrl.pathname === "/events" && request.method === "GET") {
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no"
        });
        clients.set(response, session);
        send(response, "message", { type: "APPLICATION_STATE", state: options.store.snapshot() });
        const timer = setInterval(() => response.write(": keepalive\n\n"), 15_000);
        request.on("close", () => {
          clearInterval(timer);
          clients.delete(response);
        });
        return;
      }

      if (requestUrl.pathname === "/command" && request.method === "POST") {
        const origin = request.headers.origin;
        if (!origin || origin !== session.origin) {
          json(response, 403, { error: "Cross-origin Browser View commands are not allowed." });
          return;
        }
        if (!isJson(request)) {
          json(response, 415, { error: "Browser View commands must use application/json." });
          return;
        }
        const body = await readBody(request, 1_000_000);
        let envelope: unknown;
        try {
          envelope = JSON.parse(body) as unknown;
        } catch {
          json(response, 400, { error: "Browser View command JSON is malformed." });
          return;
        }
        const parsed = parseCommandEnvelope(envelope);
        if (!parsed) {
          json(response, 400, { error: "Browser View command is not recognized." });
          return;
        }
        const currentVersion = options.store.snapshot().version;
        if (parsed.expectedStateVersion !== currentVersion) {
          json(response, 409, {
            error: "The Browser View state is stale. Wait for synchronization and retry.",
            stateVersion: currentVersion
          });
          return;
        }
        await options.dispatch(parsed.message);
        json(response, 202, { accepted: true, stateVersion: options.store.snapshot().version });
        return;
      }

      if (requestUrl.pathname === "/state" && request.method === "GET") {
        json(response, 200, options.store.snapshot());
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: "Method not allowed." });
        return;
      }
      serveAsset(options.mediaRoot, requestUrl.pathname, response, request.method === "HEAD");
    } catch (error) {
      json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Could not start Keystone Browser View.");
  localOrigin = `http://127.0.0.1:${address.port}`;

  return {
    createBootstrapUrl(): string {
      const token = randomBytes(32).toString("base64url");
      bootstrapTokens.set(token, { expiresAt: Date.now() + BOOTSTRAP_TTL_MS });
      return `${localOrigin}/?bootstrap=${encodeURIComponent(token)}`;
    },
    broadcast,
    dispose: async () => {
      subscription.dispose();
      bootstrapTokens.clear();
      sessions.clear();
      for (const client of clients.keys()) client.end();
      clients.clear();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        // Node/undici clients keep HTTP/1.1 sockets alive after a response. A
        // Browser View dispose must be terminal: otherwise those idle sockets
        // can keep verification, extension deactivation, or workspace shutdown
        // pending indefinitely. These calls are intentionally made only during
        // disposal, after the listener has begun closing.
        server.closeIdleConnections();
        server.closeAllConnections();
      });
    }
  };
}

const WEBVIEW_COMMAND_TYPES = new Set<string>([
  "WEBVIEW_READY",
  "INDEX_REPO",
  "LOAD_INTELLIGENCE",
  "LOAD_RESTORED_TASK_HANDOFF",
  "CLEAR_CONTEXT_CACHE",
  "ENHANCE_INTENT",
  "LOAD_ENHANCEMENT_SESSIONS",
  "DELETE_ENHANCEMENT_SESSION",
  "RETRIEVE_CONTEXT_ORIGINAL",
  "LOAD_CONTEXT_PACKET",
  "EXPAND_CONTEXT",
  "RECORD_CONTEXT_FEEDBACK",
  "REQUEST_CORRECTION_PACKET",
  "REINDEX_AFFECTED_AND_VALIDATE",
  "CANCEL_INGESTION",
  "CANCEL_ANALYSIS",
  "ANALYZE_INTENT",
  "APPROVE_INTENT_RESEARCH",
  "RUN_VALIDATION",
  "COMPLETE_TASK",
  "ANALYZE_MODERNIZATION",
  "ACCEPT_MODERNIZATION",
  "APPROVE_DELEGATION",
  "COPY_COPILOT_PROMPT",
  "COPY_PR_MARKDOWN",
  "SAVE_SETTINGS",
  "OPEN_BROWSER_VIEW",
  "CREATE_TASK_HANDOFF",
  "RESTORE_TASK_HANDOFF",
  "CREATE_SDLC_PLAN",
  "SDLC_TRANSITION",
  "APPROVE_SPECIFICATION",
  "QUERY_INTELLIGENCE",
  "EXPLORE_INTELLIGENCE",
  "LOAD_INTELLIGENCE_GRAPH",
  "LOAD_CPG_VIEW",
  "OPEN_SOURCE_LOCATION",
  "RESOLVE_SDLC_FINDING",
  "RECORD_DECISION",
  "CONFIGURE_VALUEEDGE",
  "IMPORT_VALUEEDGE_FEATURE",
  "PUBLISH_VALUEEDGE_STORIES"
]);

function parseCommandEnvelope(
  value: unknown
): { message: WebviewToExtensionMessage; expectedStateVersion: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.expectedStateVersion) || Number(record.expectedStateVersion) < 1)
    return undefined;
  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) return undefined;
  const type = (message as Record<string, unknown>).type;
  if (typeof type !== "string" || !WEBVIEW_COMMAND_TYPES.has(type)) return undefined;
  return {
    message: message as WebviewToExtensionMessage,
    expectedStateVersion: Number(record.expectedStateVersion)
  };
}

function authenticate(
  request: IncomingMessage,
  sessions: ReadonlyMap<string, BrowserSession>
): BrowserSession | undefined {
  const value = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!value) return undefined;
  for (const session of sessions.values()) {
    if (session.expiresAt > Date.now() && safeEqual(value, session.id)) return session;
  }
  return undefined;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const pair of (header ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    cookies[pair.slice(0, separator).trim()] = pair.slice(separator + 1).trim();
  }
  return cookies;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestOrigin(request: IncomingMessage): string {
  const forwardedProto = String(request.headers["x-forwarded-proto"] ?? "")
    .split(",")[0]
    ?.trim();
  const protocol = forwardedProto === "https" ? "https" : "http";
  const host = request.headers.host;
  if (!host) throw new Error("Browser View request is missing a host header.");
  return `${protocol}://${host}`;
}

function isSecureRequest(request: IncomingMessage): boolean {
  return (
    String(request.headers["x-forwarded-proto"] ?? "")
      .split(",")[0]
      ?.trim() === "https"
  );
}

function isJson(request: IncomingMessage): boolean {
  return (
    String(request.headers["content-type"] ?? "")
      .toLowerCase()
      .split(";")[0]
      ?.trim() === "application/json"
  );
}

function pruneExpired(
  bootstrapTokens: Map<string, BootstrapToken>,
  sessions: Map<string, BrowserSession>
): void {
  const now = Date.now();
  for (const [token, entry] of bootstrapTokens)
    if (entry.expiresAt <= now) bootstrapTokens.delete(token);
  for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id);
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
  );
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()"
  );
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-store");
}

function json(response: ServerResponse, status: number, value: unknown): void {
  if (response.headersSent) return;
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage, max: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (settled) return;
      value += chunk;
      if (Buffer.byteLength(value, "utf8") > max) {
        settled = true;
        reject(new Error("Request too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!settled) resolve(value);
    });
    request.on("error", reject);
  });
}

function serveAsset(
  root: string,
  pathname: string,
  response: ServerResponse,
  headOnly = false
): void {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const target = path.resolve(root, relative);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    json(response, 403, { error: "Forbidden" });
    return;
  }
  const fallback = path.join(root, "index.html");
  const selected = fs.existsSync(target) && fs.statSync(target).isFile() ? target : fallback;
  if (!fs.existsSync(selected)) {
    response.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Keystone webview assets are not built. Run npm run build:webview.");
    return;
  }
  const ext = path.extname(selected);
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8"
  };
  response.writeHead(200, { "Content-Type": types[ext] ?? "application/octet-stream" });
  if (headOnly) {
    response.end();
    return;
  }
  fs.createReadStream(selected).pipe(response);
}
