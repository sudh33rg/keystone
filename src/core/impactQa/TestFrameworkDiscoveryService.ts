import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { TestFrameworkCapability, TestCommandDefinition } from "../../shared/contracts/impactQa";

const FRAMEWORKS = ["vitest", "jest", "mocha", "ava", "playwright", "cypress"] as const;
export class TestFrameworkDiscoveryService {
  async discover(workspaceRoot: string): Promise<TestFrameworkCapability[]> {
    let parsed: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try { parsed = JSON.parse(await readFile(join(workspaceRoot, "package.json"), "utf8")) as typeof parsed; }
    catch { return [unsupported("package-json-unavailable", "No readable package.json test configuration was found.")]; }
    const dependencies = { ...(parsed.dependencies ?? {}), ...(parsed.devDependencies ?? {}) };
    const testScripts = Object.entries(parsed.scripts ?? {}).filter(([name, command]) => /(^|:)(test|unit|integration|e2e)($|:)/i.test(name) && !unsafe(command));
    const detected = FRAMEWORKS.filter((framework) => dependencies[framework] || testScripts.some(([, command]) => new RegExp(`\\b${framework}\\b`, "i").test(command)));
    if (!detected.length || !testScripts.length) return [unsupported("test-framework-unsupported", "No verified configured test framework and package test command were found.")];
    return detected.map((framework) => ({ id: `framework:${framework}`, framework, sourceFiles: ["package.json"], availability: "available", commands: testScripts.map(([name]) => command(framework, name)) }));
  }
}
function command(framework: string, script: string): TestCommandDefinition { return { id: `command:package:${script}`, frameworkId: `framework:${framework}`, displayName: `npm run ${script}`, executable: "npm", arguments: ["run", script, "--"], workingDirectory: ".", scope: script.includes("e2e") ? "suite" : "test-file", source: "package-script", timeoutMs: script.includes("e2e") ? 300_000 : 120_000 }; }
function unsupported(code: string, message: string): TestFrameworkCapability { return { id: "framework:unsupported", framework: "unknown", sourceFiles: [], commands: [], availability: "unsupported", diagnostic: { code, message } }; }
function unsafe(command: string): boolean { return /[;&|`]|\Wrm\W|\Wgit\s+(push|commit|reset|checkout)\W|\Wdeploy\W/i.test(command); }
