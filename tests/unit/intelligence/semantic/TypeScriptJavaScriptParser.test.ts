import { describe, expect, it } from "vitest";
import { TypeScriptJavaScriptParser } from "../../../../src/core/intelligence/semantic/TypeScriptJavaScriptParser";
import type { SemanticProjectRequest, SemanticSourceFileInput } from "../../../../src/core/intelligence/semantic/SemanticModel";

describe("TypeScriptJavaScriptParser", () => {
  it("extracts evidence-backed compiler, framework, test, package, and configuration intelligence", async () => {
    const parser = new TypeScriptJavaScriptParser();
    const result = await parser.extract(request(1, true, fixtureFiles()));

    expect(types(result.entities)).toEqual(expect.arrayContaining([
      "keystone.core.Package", "keystone.core.ExternalDependency", "keystone.core.Module", "keystone.core.Interface",
      "keystone.core.Class", "keystone.core.Function", "keystone.core.Method", "keystone.core.Constructor",
      "keystone.core.Component", "keystone.core.Hook", "keystone.core.Route", "keystone.core.Command",
      "keystone.core.TestSuite", "keystone.core.TestCase", "keystone.core.ConfigurationKey"
    ]));
    expect(relationshipTypes(result.relationships)).toEqual(expect.arrayContaining([
      "keystone.core.IMPORTS", "keystone.core.RE_EXPORTS", "keystone.core.EXPORTS", "keystone.core.CALLS",
      "keystone.core.INSTANTIATES", "keystone.core.EXTENDS", "keystone.core.IMPLEMENTS", "keystone.core.OVERRIDES",
      "keystone.core.RENDERS", "keystone.core.USES_HOOK", "keystone.core.ROUTES_TO", "keystone.core.USES_MIDDLEWARE",
      "keystone.core.TESTS", "keystone.core.READS_CONFIGURATION", "keystone.core.DEPENDS_ON"
    ]));
    expect(result.relationships.some((item) => item.type === "keystone.core.IMPORTS" && item.properties?.commonJs === true)).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.IMPORTS" && item.properties?.dynamic === true)).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.IMPORTS" && item.properties?.moduleSpecifier === "./base")).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.ALIASES" && item.properties?.alias === "base")).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.IMPORTS" && item.properties?.alias === "base" && item.confidence === 1)).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.REGISTERS_HANDLER" && item.properties?.registration === "on")).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.TESTS" && item.confidence === 1 && item.properties?.evidenceLevel === 1)).toBe(true);
    expect(result.relationships.some((item) => item.type === "keystone.core.TESTS" && item.confidence < 0.5 && item.resolution === "candidate")).toBe(true);
    expect(result.entities.some((item) => item.type === "keystone.core.ConfigurationKey" && item.name === "API_KEY")).toBe(true);
    expect(result.entities.filter((item) => item.type === "keystone.core.Route").every((item) => item.name.startsWith("/") || item.name === "*")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(result.diagnostics.some((item) => item.code === "unresolved-call")).toBe(true);
    expect(result.relationships.every((item) => item.evidenceIds.length > 0 && item.sourceId !== "" && item.targetId !== "")).toBe(true);
    expect(result.evidence.every((item) => item.ownerFileId && item.contentHash && item.extractorVersion)).toBe(true);
    expect(result.contributions.every((item) => item.parserVersion && item.sourceHash)).toBe(true);
    expect(result.fileUpdates.some((item) => item.id === "file:src/legacy-component.jsx" && item.parseStatus === "parsed")).toBe(true);
    expect([...new Set(result.cpg?.scopes.map((item) => item.descriptor.fileId))]).toEqual(expect.arrayContaining(["file:src/base.ts", "file:src/consumer.ts", "file:src/components.tsx", "file:src/legacy.js", "file:src/legacy-component.jsx"]));
    const codeAnalysis = result.entities.find((item) => item.name === "invoke")?.codeAnalysis;
    expect(codeAnalysis?.providerId).toBe("keystone.typescript-cpg");
    expect(codeAnalysis?.calculationMethod).toContain("scope-summary");
    const invokeCpg = result.cpg?.scopes.find((item) => item.descriptor.semanticSymbolId === result.entities.find((entity) => entity.name === "invoke")?.id && item.descriptor.kind === "function");
    expect(invokeCpg?.edges.map((edge) => edge.type)).toContain("ARGUMENT_TO_PARAMETER");
    expect(invokeCpg?.edges.map((edge) => edge.type)).toContain("RETURN_TO_CALL");
    const invokeId = result.entities.find((entity) => entity.name === "invoke")?.id;
    const invokeTargets = result.relationships.filter((item) => item.sourceId === invokeId && item.type === "keystone.core.CALLS").flatMap((item) => { const target = result.entities.find((entity) => entity.id === item.targetId); return target ? [target.name] : []; });
    expect(invokeTargets).toEqual(expect.arrayContaining(["helper", "greet"]));
    expect(invokeTargets).not.toContain("base");
    const deprecated = result.entities.find((item) => item.name === "Base");
    expect(deprecated).toMatchObject({ deprecated: true, decorators: ["sealed"] });
    expect(deprecated?.jsDocRange).toBeDefined();
    expect(result.adapterState?.coverage.find((item) => item.technologyId === "typescript")).toMatchObject({ capabilityLevel: "semantic" });
    expect(result.adapterState?.coverage.find((item) => item.technologyId === "typescript")?.entitiesExtracted).toBeGreaterThan(0);
  });

  it("keeps identities deterministic and removes deleted or changed-signature contributions", async () => {
    const parser = new TypeScriptJavaScriptParser();
    const files = fixtureFiles();
    const first = await parser.extract(request(1, true, files));
    const repeated = await parser.extract(request(2, true, files));
    expect(repeated.entities.map((item) => item.id)).toEqual(first.entities.map((item) => item.id));
    expect(repeated.relationships.map((item) => item.id)).toEqual(first.relationships.map((item) => item.id));

    const base = files.find((item) => item.relativePath === "src/base.ts")!;
    const changed = { ...base, content: base.content.replace("helper(value: string)", "helper(value: number)"), contentHash: "sha256:base-changed" };
    const updated = await parser.extract(request(3, false, [changed]));
    const firstHelper = first.entities.find((item) => item.name === "helper" && item.type === "keystone.core.Function")!;
    const nextHelper = updated.entities.find((item) => item.name === "helper" && item.type === "keystone.core.Function")!;
    expect(nextHelper.id).not.toBe(firstHelper.id);
    expect(updated.relationships.some((item) => item.targetId === firstHelper.id)).toBe(false);

    const deleted = await parser.extract({ ...request(4, false, []), removedPaths: ["src/base.ts"] });
    expect(deleted.entities.some((item) => item.fileId === base.fileId)).toBe(false);
    expect(deleted.relationships.some((item) => item.sourceId === firstHelper.id || item.targetId === firstHelper.id)).toBe(false);
  });

  it("keeps universal adapter relationships and evidence valid in a mixed semantic result", async () => {
    const files = [file("src/index.ts", "typescript", "source", "export const initial = 1;"), file("docs/README.md", "markdown", "documentation", "# Fixture\n## Usage"), file("api/openapi.yaml", "yaml", "schema", "openapi: 3.0.0\npaths:\n  /fixture:\n    get:"), file("db/schema.sql", "sql", "schema", "CREATE TABLE fixture_items (id INTEGER PRIMARY KEY, name TEXT);"), file("db/migrations/002.sql", "sql", "migration", "ALTER TABLE fixture_items ADD COLUMN active INTEGER;")];
    const result = await new TypeScriptJavaScriptParser().extract(request(1, true, files));
    const entityIds = new Set([...files.map((item) => item.fileId), ...result.entities.map((item) => item.id)]); const evidence = new Map(result.evidence.map((item) => [item.id, item]));
    expect(result.relationships.filter((item) => !entityIds.has(item.sourceId) || !entityIds.has(item.targetId))).toEqual([]);
    expect([...result.entities, ...result.relationships].flatMap((item) => item.evidenceIds.filter((id) => evidence.get(id)?.subjectId !== item.id))).toEqual([]);
    expect(result.adapterState?.coverage.map((item) => item.technologyId)).toEqual(expect.arrayContaining(["openapi", "sql", "sql-migration", "documentation"]));
  });

  it("does not report external fluent APIs or configuration getters as routes", async () => {
    const files = [file("src/schema.ts", "typescript", "source", "import { z } from 'zod';\nconst schema = z.object({ name: z.string().min(1) }).strict();\nconst indexing = { get: (_key: string) => true };\nconst enabled = indexing.get('enabled');")];
    const result = await new TypeScriptJavaScriptParser().extract(request(1, true, files));
    expect(result.entities.filter((item) => item.type === "keystone.core.Route")).toEqual([]);
    expect(result.diagnostics.filter((item) => item.code === "unresolved-call" && /z\.|\.strict/.test(item.message))).toEqual([]);
  });
});

function fixtureFiles(): SemanticSourceFileInput[] {
  return [
    file("package.json", "json", "manifest", JSON.stringify({ name: "fixture", dependencies: { express: "1", react: "1" }, devDependencies: { vitest: "1" }, scripts: { build: "tsc", test: "vitest", lint: "eslint ." } })),
    file("tsconfig.json", "json", "configuration", JSON.stringify({ compilerOptions: { paths: { "@/*": ["src/*"] } } })),
    file("src/base.ts", "typescript", "source", `
export interface Runnable { run(): string }
function sealed(_target: Function): void {}
/** @deprecated Use Service directly. */
@sealed
export class Base { greet(): string { return "base" } }
export class Service extends Base implements Runnable {
  constructor() { super(); }
  override greet(): string { return "service" }
  run(): string { return this.greet(); }
}
export function helper(value: string): string { return value }
export default function greet(): string { return helper("hello") }
`),
    file("src/consumer.ts", "typescript", "source", `
import greet, { helper, Service } from "./base";
import type { Runnable } from "./base";
import * as base from "./base";
import "./base";
export { helper as rehelper } from "./base";
const required = require("./base");
export function invoke(): string { const service = new Service(); helper("x"); greet(); base.helper("y"); return service.run(); }
function callback(): void {}
const emitter = { on(_event: string, _handler: () => void): void {} };
emitter.on("ready", callback);
export const loadBase = () => import("./base");
export function unresolved(value: any): unknown { return value.dynamic(); }
const key = process.env.API_KEY ?? "super-secret-value";
void required; void key;
`),
    file("src/components.tsx", "typescriptreact", "source", `
export interface Props { label: string }
export function Child(_props: Props) { return <span/> }
export function useFeature(): boolean { return true }
function handler(): void {}
export const App = (props: Props) => { useFeature(); return <Child label={props.label} onClick={handler}/> }
`),
    file("src/routes.ts", "typescript", "source", `
import express from "express";
declare const vscode: any;
const app = express();
function auth(_request: unknown, _response: unknown, next: () => void): void { next(); }
function handler(_request: unknown, response: any): void { response.send("ok"); }
app.get("/users", auth, handler);
vscode.commands.registerCommand("fixture.run", handler);
const enabled = vscode.workspace.getConfiguration("fixture").get("enabled", true);
void enabled;
`),
    file("src/legacy.js", "javascript", "source", `const base = require("./base"); module.exports = function legacy() { return base.helper("legacy"); };`),
    file("src/legacy-component.jsx", "javascriptreact", "source", `import { Child } from "./components"; export function LegacyComponent() { return <Child label="legacy"/>; }`),
    file("tests/base.test.ts", "typescript", "test", `
import { helper, Service } from "../src/base";
describe("base", () => {
  beforeEach(() => {});
  vi.mock("../src/base");
  test("helper exact", () => { helper("test"); });
  test("Service behavior", () => { expect(true).toBe(true); });
});
`)
  ];
}

function file(relativePath: string, language: string, category: SemanticSourceFileInput["category"], content: string): SemanticSourceFileInput {
  return { uri: `file:///fixture/${relativePath}`, relativePath, workspaceRootId: "root:fixture", fileId: `file:${relativePath}`, language, category, contentHash: `sha256:${relativePath}`, content };
}

function request(generation: number, reset: boolean, changedFiles: SemanticSourceFileInput[]): SemanticProjectRequest {
  return { repositoryId: "repository:fixture", projectKey: "fixture", generation, jobRevision: generation, reset, branch: "main", commit: "abc", changedFiles, removedPaths: [] };
}

function types(items: Array<{ type: string }>): string[] { return items.map((item) => item.type); }
function relationshipTypes(items: Array<{ type: string }>): string[] { return items.map((item) => item.type); }
