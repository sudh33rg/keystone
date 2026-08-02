import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "../../../support/testkit";
import { ApplicationStore } from "@core/application/applicationStore";
import {
  startBrowserViewServer,
  type BrowserViewHandle
} from "../../../../src/extension/browser-view/browserViewServer";

const roots: string[] = [];
const handles: BrowserViewHandle[] = [];
afterEach(async () => {
  while (handles.length) await handles.pop()!.dispose();
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function assets(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-browser-"));
  roots.push(root);
  fs.writeFileSync(
    path.join(root, "index.html"),
    '<!doctype html><title>Keystone</title><script src="/webview.js"></script>'
  );
  fs.writeFileSync(path.join(root, "webview.js"), 'console.log("keystone")');
  return root;
}

async function bootstrap(
  handle: BrowserViewHandle
): Promise<{ origin: string; cookie: string; url: string; setCookie: string }> {
  const url = handle.createBootstrapUrl();
  const response = await fetch(url, { redirect: "manual" });
  expect(response.status).toBe(303);
  const setCookie = String(response.headers.get("set-cookie"));
  const cookie = setCookie.split(";")[0]!;
  return { origin: new URL(url).origin, cookie, url, setCookie };
}

async function command(
  session: { origin: string; cookie: string },
  message: unknown,
  expectedStateVersion: number,
  origin = session.origin
): Promise<Response> {
  return fetch(`${session.origin}/command`, {
    method: "POST",
    headers: { cookie: session.cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ message, expectedStateVersion })
  });
}

describe("Browser View server", () => {
  it("uses a one-time bootstrap and an HttpOnly same-origin session", async () => {
    const store = new ApplicationStore({ workspace: { name: "fixture", root: "/fixture" } });
    const dispatched: unknown[] = [];
    const handle = await startBrowserViewServer({
      mediaRoot: assets(),
      store,
      dispatch: (message) => {
        dispatched.push(message);
      }
    });
    handles.push(handle);

    const unauthenticated = await fetch(new URL("/state", handle.createBootstrapUrl()));
    expect(unauthenticated.status).toBe(401);

    const session = await bootstrap(handle);
    expect(session.setCookie).toMatch(/HttpOnly/);
    expect(session.setCookie).toMatch(/SameSite=Strict/);
    const replay = await fetch(session.url, { redirect: "manual" });
    expect(replay.status).toBe(401);
    expect(
      String(
        (await fetch(`${session.origin}/`, { headers: { cookie: session.cookie } })).headers.get(
          "content-security-policy"
        )
      )
    ).toMatch(/frame-ancestors 'none'/);

    const state = await fetch(`${session.origin}/state`, { headers: { cookie: session.cookie } });
    expect(state.status).toBe(200);
    const snapshot = (await state.json()) as { version: number; workspace: { name: string } };
    expect(snapshot.workspace.name).toBe("fixture");

    const crossOrigin = await command(
      session,
      { type: "LOAD_INTELLIGENCE" },
      snapshot.version,
      "https://attacker.invalid"
    );
    expect(crossOrigin.status).toBe(403);

    const unknown = await command(session, { type: "RUN_ARBITRARY_CODE" }, snapshot.version);
    expect(unknown.status).toBe(400);

    store.update({ status: "ready" });
    const stale = await command(session, { type: "LOAD_INTELLIGENCE" }, snapshot.version);
    expect(stale.status).toBe(409);

    const accepted = await command(
      session,
      { type: "LOAD_INTELLIGENCE" },
      store.snapshot().version
    );
    expect(accepted.status).toBe(202);
    expect(dispatched).toHaveLength(1);
  });

  it("sends current and subsequent shared state to reconnecting clients", async () => {
    const store = new ApplicationStore({ status: "ready" });
    const handle = await startBrowserViewServer({
      mediaRoot: assets(),
      store,
      dispatch: () => undefined
    });
    handles.push(handle);
    const session = await bootstrap(handle);

    for (let connection = 0; connection < 2; connection += 1) {
      const controller = new AbortController();
      const response = await fetch(`${session.origin}/events`, {
        headers: { cookie: session.cookie },
        signal: controller.signal
      });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const first = new TextDecoder().decode((await reader.read()).value);
      expect(first).toMatch(/APPLICATION_STATE/);
      expect(first).toMatch(new RegExp(`\"status\":\"${store.snapshot().status}\"`));
      if (connection === 0) {
        store.update({ status: "analyzing" });
        const second = new TextDecoder().decode((await reader.read()).value);
        expect(second).toMatch(/"status":"analyzing"/);
      }
      controller.abort();
    }
  });
});
