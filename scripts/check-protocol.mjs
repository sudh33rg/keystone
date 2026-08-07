import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const source = fs.readFileSync(
  path.join(root, "src/core/integration/webview/messageRouter.ts"),
  "utf8"
);
const union = between(source, "export type WebviewToExtensionMessage =", "export const WEBVIEW_COMMAND_TYPES");
const runtime = between(source, "export const WEBVIEW_COMMAND_TYPES =", "export const WEBVIEW_COMMAND_TYPE_SET");
const declared = typesIn(union);
const allowed = typesIn(runtime);
const missing = declared.filter((type) => !allowed.includes(type));
const unknown = allowed.filter((type) => !declared.includes(type));
if (missing.length || unknown.length) {
  throw new Error(
    `Webview protocol runtime set diverges from its TypeScript union. Missing: ${missing.join(", ") || "none"}; unknown: ${unknown.join(", ") || "none"}.`
  );
}
const browser = fs.readFileSync(
  path.join(root, "src/extension/browser-view/browserViewServer.ts"),
  "utf8"
);
if (!browser.includes("WEBVIEW_COMMAND_TYPE_SET"))
  throw new Error("Browser View must use the canonical Webview command allowlist.");
if (/const\s+WEBVIEW_COMMAND_TYPES\s*=/.test(browser))
  throw new Error("Browser View must not maintain an independent command allowlist.");
console.log(`Protocol verified: ${declared.length} Webview command type(s) share one runtime allowlist.`);

function between(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error(`Protocol marker missing: ${start}`);
  return text.slice(from, to);
}

function typesIn(text) {
  return [...text.matchAll(/(?:type:\s*|^\s*)"([A-Z_]+)"/gm)].map((match) => match[1]);
}
