import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { runTests } from "@vscode/test-electron";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const run = promisify(execFile);
const workspaceRoot = await mkdtemp(path.join(tmpdir(), "keystone-continuous-"));

try {
  await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "tests"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "docs"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "api"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "db", "migrations"), { recursive: true });
  await writeFile(path.join(workspaceRoot, "src", "index.ts"), "export const initial = 1;\nexport function analyze(input: number): number { if (input > 0) return input + initial; return 0; }\n", "utf8");
  await writeFile(path.join(workspaceRoot, "tests", "index.test.ts"), "export const testValue = true;\n", "utf8");
  await writeFile(path.join(workspaceRoot, "docs", "README.md"), "# Fixture\n\n## Usage\nEvidence-backed fixture documentation.\n", "utf8");
  await writeFile(path.join(workspaceRoot, "api", "openapi.yaml"), "openapi: 3.0.0\npaths:\n  /fixture:\n    get:\n      operationId: fixture\n", "utf8");
  await writeFile(path.join(workspaceRoot, "db", "schema.sql"), "CREATE TABLE fixture_items (id INTEGER PRIMARY KEY, name TEXT);\n", "utf8");
  await writeFile(path.join(workspaceRoot, "db", "migrations", "002_fixture.sql"), "ALTER TABLE fixture_items ADD COLUMN active INTEGER;\n", "utf8");
  await run("git", ["init", "-b", "main"], { cwd: workspaceRoot });
  await run("git", ["config", "user.email", "keystone@example.invalid"], { cwd: workspaceRoot });
  await run("git", ["config", "user.name", "Keystone Tests"], { cwd: workspaceRoot });
  await run("git", ["add", "."], { cwd: workspaceRoot });
  await run("git", ["commit", "-m", "initial"], { cwd: workspaceRoot });
  process.env.KEYSTONE_TEST_WORKSPACE = workspaceRoot;
  await runTests({
    version: "1.95.0",
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: path.join(projectRoot, "dist", "extension-tests", "index.js"),
    launchArgs: [
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--user-data-dir=/tmp/keystone-vscode-test-user-data",
      workspaceRoot
    ]
  });
} catch (error) {
  console.error("Keystone Extension Host tests failed.", error);
  process.exitCode = 1;
} finally {
  await rm(workspaceRoot, { recursive: true, force: true });
}
