import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { ApplicationStore } from "@core/application/applicationStore";
import { startBrowserViewServer } from "@vscode/browser-view/browserViewServer";

test("Browser View accepts a newly added canonical protocol command", async () => {
  const mediaRoot = await mkdtemp(path.join(os.tmpdir(), "keystone-browser-view-"));
  const received: string[] = [];
  const handle = await startBrowserViewServer({
    mediaRoot,
    store: new ApplicationStore(),
    dispatch: async (message) => received.push(message.type)
  });
  try {
    const bootstrap = new URL(handle.createBootstrapUrl());
    const authenticated = await fetch(bootstrap, { redirect: "manual" });
    assert.equal(authenticated.status, 303);
    const cookie = authenticated.headers.get("set-cookie");
    assert.ok(cookie, "expected authenticated Browser View cookie");

    const accepted = await fetch(new URL("/command", bootstrap.origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        origin: bootstrap.origin
      },
      body: JSON.stringify({
        expectedStateVersion: 1,
        message: { type: "LOAD_ACTIVITY_HISTORY" }
      })
    });
    assert.equal(accepted.status, 202);
    assert.deepEqual(received, ["LOAD_ACTIVITY_HISTORY"]);

    const rejected = await fetch(new URL("/command", bootstrap.origin), {
      method: "POST",
      headers: { "content-type": "application/json", cookie, origin: bootstrap.origin },
      body: JSON.stringify({ expectedStateVersion: 1, message: { type: "NOT_A_KEYSTONE_COMMAND" } })
    });
    assert.equal(rejected.status, 400);
  } finally {
    await handle.dispose();
    await rm(mediaRoot, { recursive: true, force: true });
  }
});
