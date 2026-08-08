import assert from "node:assert/strict";
import test from "node:test";

import {
  WEBVIEW_COMMAND_TYPES,
  WEBVIEW_COMMAND_TYPE_SET
} from "@core/integration/webview/messageRouter";

test("canonical Browser View command allowlist includes every supported command", () => {
  assert.equal(WEBVIEW_COMMAND_TYPES.length, 58);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.size, WEBVIEW_COMMAND_TYPES.length);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("LOAD_ACTIVITY_HISTORY"), true);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("CANCEL_COPILOT"), true);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("CREATE_INTENT_FOLLOW_UP"), true);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("GENERATE_DISCOVERY_PRESENTATION"), true);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("APPROVE_BACKLOG_STORIES"), true);
  assert.equal(WEBVIEW_COMMAND_TYPE_SET.has("NOT_A_KEYSTONE_COMMAND"), false);
});
