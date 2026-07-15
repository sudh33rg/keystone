import assert from "node:assert/strict";
import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execGit = promisify(execFile);

interface Overview {
  status: string;
  generation: number;
  pendingUpdate: boolean;
  repository?: { branch?: string };
  counts: { files: number };
  categories: Array<{ key: string; count: number }>;
  runtime: { phase: string; workerCapacity: number; completedJobs: number };
}

interface SearchResult { items: Array<{ id: string; name: string; type: string }>; total: number }
interface TechnologyResult { generation: number; total: number; items: Array<{ technologyId: string; capabilityLevel: string }> }
interface UnifiedQueryResult { operation: string; generation: number; data: { kind: string; items: Array<{ id: string }>; cpg?: { nodes: unknown[] } }; evidence: unknown[]; diagnostics: Array<{ code: string }>; explanation: { rankingRules: string[] }; truncated: boolean }

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("keystone-dev.keystone");
  assert.ok(extension, "Keystone extension should be discoverable in the Extension Development Host");

  const startedAt = performance.now();
  await extension.activate();
  const activationDurationMs = performance.now() - startedAt;

  assert.equal(extension.isActive, true, "Keystone extension should activate successfully");
  assert.ok(activationDurationMs < 500, `Keystone activation should remain under 500 ms; measured ${activationDurationMs.toFixed(1)} ms`);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("keystone.open"), "Keystone open command should be registered");
  assert.ok(commands.includes("keystone.showLogs"), "Keystone logs command should be registered");
  assert.ok(commands.includes("keystone.intelligence.overview"), "Keystone overview command should be registered");
  assert.ok(commands.includes("keystone.intelligence.search"), "Keystone semantic search command should be registered");
  assert.ok(commands.includes("keystone.intelligence.cpg"), "Keystone CPG query command should be registered");
  assert.ok(commands.includes("keystone.intelligence.technologies"), "Keystone technology coverage command should be registered");
  assert.ok(commands.includes("keystone.intelligence.query"), "Keystone deterministic query command should be registered");
  const overview = await waitForOverview((value) => value.generation > 0 && !value.pendingUpdate);
  assert.ok(overview, "Keystone overview command should return a typed result");
  assert.ok(["not-indexed", "ready", "partial", "failed", "storage-unavailable"].includes(overview.status));
  assert.equal(typeof overview.counts.files, "number");
  assert.ok(overview.runtime.workerCapacity >= 2, "Continuous ingestion should keep multiple persistent workers");
  assert.ok(overview.categories.some((item) => item.key === "test" && item.count >= 1), "Test files should remain indexed as tests");
  const search = await vscode.commands.executeCommand<SearchResult>("keystone.intelligence.search", { query: "initial", limit: 10 });
  assert.ok(search?.items.some((item) => item.name === "initial" && item.type === "keystone.core.Constant"), "Compiler-backed semantic search should find the fixture declaration");
  const initialEntity = search.items.find((item) => item.name === "initial");
  assert.ok(initialEntity);
  const details = await vscode.commands.executeCommand<{ entity: { id: string }; evidence: unknown[] }>("keystone.intelligence.entity", initialEntity.id);
  assert.equal(details?.entity.id, initialEntity.id);
  assert.ok((details?.evidence.length ?? 0) > 0, "Semantic entity details should include evidence");
  const unifiedSearch = await vscode.commands.executeCommand<UnifiedQueryResult>("keystone.intelligence.query", { text: "find initial" });
  assert.equal(unifiedSearch?.operation, "SEARCH");
  assert.equal(unifiedSearch?.generation, overview.generation);
  assert.ok(unifiedSearch?.data.items.some((item) => item.id === initialEntity.id), "Unified deterministic search should resolve the fixture entity");
  assert.ok((unifiedSearch?.evidence.length ?? 0) > 0 && (unifiedSearch?.explanation.rankingRules.length ?? 0) > 0, "Unified queries should expose evidence and ranking explanation");
  const functionSearch = await vscode.commands.executeCommand<SearchResult>("keystone.intelligence.search", { query: "analyze", limit: 10 });
  const analyze = functionSearch?.items.find((item) => item.name === "analyze");
  assert.ok(analyze, "Compiler-backed semantic search should find the executable fixture scope");
  const cpg = await vscode.commands.executeCommand<{ generation: number; nodes: Array<{ kind: string }>; edges: Array<{ type: string }>; truncated: boolean }>("keystone.intelligence.cpg", { semanticSymbolId: analyze.id, overlays: ["control-flow", "data-flow", "calls"], maxNodes: 100, includeSource: true });
  assert.ok(cpg?.nodes.some((node) => node.kind === "ENTRY") && cpg.nodes.some((node) => node.kind === "EXIT"), "The persisted scope CPG should expose entry and exit nodes");
  assert.ok(cpg?.edges.some((edge) => edge.type === "CFG_TRUE"), "The persisted scope CPG should expose the fixture branch");
  const unifiedCpg = await vscode.commands.executeCommand<UnifiedQueryResult>("keystone.intelligence.query", { query: { operation: "CPG_SCOPE", seeds: [{ id: analyze.id, kind: "stable-id" }], include: { source: true, evidence: true, relationships: true, diagnostics: true, explanation: true, cpg: true }, limits: { results: 25, nodes: 100, edges: 300, paths: 5, depth: 8, evidence: 30, timeBudgetMs: 1000 } } });
  assert.ok((unifiedCpg?.data.cpg?.nodes.length ?? 0) > 0, "Unified CPG queries should reuse the persisted bounded CPG facade");
  const technologies = await vscode.commands.executeCommand<TechnologyResult>("keystone.intelligence.technologies", { limit: 50 });
  assert.ok(technologies?.generation === overview.generation);
  assert.ok(technologies?.items.some((item) => item.technologyId === "openapi" && item.capabilityLevel === "structural"), "Worker-produced OpenAPI coverage should persist and be queryable");
  assert.ok(technologies?.items.some((item) => item.technologyId === "sql"), "Worker-produced SQL coverage should persist and be queryable");

  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  assert.ok(root, "The continuous-ingestion fixture workspace should be open");
  const source = vscode.Uri.joinPath(root, "src", "index.ts");
  const initialGeneration = overview.generation;
  await vscode.workspace.fs.writeFile(source, new TextEncoder().encode("export const modified = 2;\n"));
  const modified = await waitForOverview((value) => value.generation > initialGeneration && !value.pendingUpdate);

  const createdTest = vscode.Uri.joinPath(root, "tests", "created.test.ts");
  await vscode.workspace.fs.writeFile(createdTest, new TextEncoder().encode("export const createdTest = true;\n"));
  const created = await waitForOverview((value) => value.generation > modified.generation && value.counts.files > modified.counts.files && !value.pendingUpdate);
  assert.ok(created.categories.some((item) => item.key === "test" && item.count >= 2));

  const beforeBurst = created.generation;
  await Promise.all([1, 2, 3].map((value) => vscode.workspace.fs.writeFile(source, new TextEncoder().encode(`export const burst = ${value};\n`))));
  const burst = await waitForOverview((value) => value.generation > beforeBurst && !value.pendingUpdate);
  assert.equal(burst.generation, beforeBurst + 1, "Repeated file changes should coalesce into one generation");

  const renamedTest = vscode.Uri.joinPath(root, "tests", "renamed.test.ts");
  await vscode.workspace.fs.rename(createdTest, renamedTest);
  const renamed = await waitForOverview((value) => value.generation > burst.generation && value.counts.files === burst.counts.files && !value.pendingUpdate);
  await vscode.workspace.fs.delete(renamedTest);
  const deleted = await waitForOverview((value) => value.generation > renamed.generation && value.counts.files < renamed.counts.files && !value.pendingUpdate);

  await execGit("git", ["checkout", "-b", "feature"], { cwd: root.fsPath });
  await vscode.workspace.fs.writeFile(source, new TextEncoder().encode("export const branchValue = 4;\n"));
  await execGit("git", ["add", "."], { cwd: root.fsPath });
  await execGit("git", ["commit", "-m", "feature change"], { cwd: root.fsPath });
  const branch = await waitForOverview((value) => value.generation > deleted.generation && value.repository?.branch === "feature" && !value.pendingUpdate);
  assert.equal(branch.repository?.branch, "feature");

  await execGit("git", ["commit", "--allow-empty", "-m", "simulated pull head"], { cwd: root.fsPath });
  const pulled = await waitForOverview((value) => value.generation > branch.generation && value.repository?.branch === "feature" && !value.pendingUpdate);
  assert.ok(pulled.generation > branch.generation, "A same-branch HEAD advance should reconcile like a pull");
}

async function waitForOverview(predicate: (overview: Overview) => boolean, timeoutMs = 30_000): Promise<Overview> {
  const started = Date.now();
  let lastOverview: Overview | undefined;
  while (Date.now() - started < timeoutMs) {
    const overview = await vscode.commands.executeCommand<Overview>("keystone.intelligence.overview");
    lastOverview = overview;
    if (overview && predicate(overview)) return overview;
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for continuous intelligence state. Last overview: ${JSON.stringify(lastOverview)}`);
}
