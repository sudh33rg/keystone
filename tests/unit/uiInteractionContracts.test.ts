import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const UI_ROOT = join(process.cwd(), "src", "ui");

describe("Webview interaction contracts", () => {
  const sources = sourceFiles(UI_ROOT);

  it("registers every UI host request in the contract, router, and response validator", () => {
    const requests = new Set<string>();
    for (const path of sources) {
      const source = parse(path);
      walk(source, (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "request") return;
        const first = node.arguments[0]; if (first) collectStrings(first, requests);
      });
    }
    const contracts = readFileSync(join(process.cwd(), "src", "shared", "contracts", "messages.ts"), "utf8");
    const router = readFileSync(join(process.cwd(), "src", "extension", "webview", "WebviewMessageRouter.ts"), "utf8") + readFileSync(join(process.cwd(), "src", "extension", "webview", "KeystonePanelService.ts"), "utf8");
    const bridge = readFileSync(join(UI_ROOT, "services", "HostBridge.ts"), "utf8");
    const missing = [...requests].sort().filter((type) => !contracts.includes(`"${type}"`) || !router.includes(`"${type}"`) || !bridge.includes(`case "${type}"`));
    expect(missing, "Each clickable/queryable host action needs a typed request, host route, and response validator").toEqual([]);
    expect(requests.size).toBeGreaterThan(100);
  });

  it("does not render inert buttons", () => {
    const inert: string[] = [];
    for (const path of sources.filter((item) => item.endsWith(".tsx"))) {
      const source = parse(path);
      walk(source, (node) => {
        if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
        if (node.tagName.getText(source) !== "button") return;
        const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
        const interactive = attributes.some((item) => item.name.getText(source) === "onClick");
        const submit = attributes.some((item) => item.name.getText(source) === "type" && item.initializer?.getText(source).includes("submit"));
        if (!interactive && !submit) inert.push(`${path.slice(process.cwd().length + 1)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      });
    }
    expect(inert, "A visible button must invoke a local state action or a typed host request").toEqual([]);
  });
});

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? sourceFiles(join(root, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(root, entry.name)] : []);
}

function parse(path: string): ts.SourceFile {
  return ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node); node.forEachChild((child) => walk(child, visit));
}

function collectStrings(node: ts.Node, output: Set<string>): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) output.add(node.text);
  if (ts.isConditionalExpression(node)) { collectStrings(node.whenTrue, output); collectStrings(node.whenFalse, output); return; }
  node.forEachChild((child) => collectStrings(child, output));
}
