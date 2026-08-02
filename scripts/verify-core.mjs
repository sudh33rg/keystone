/**
 * Core verification harness for the modules added in the dead-graph-removal /
 * staleness-guard work:
 *   - ingestion/revisionGuard.ts   (revision.json sidecar + mismatch detection)
 *   - ingestion/snapshotPrune.ts   (write-only snapshot archive pruning)
 *
 * Convention (see scripts/verify-final.mjs): build first, then require the
 * emitted JS under dist/app. Run: `npm run build && node scripts/verify-core.mjs`.
 * No test framework is configured in the repo, so this is a standalone Node
 * script using node:assert. It does not touch OKF/CPG writers or formats.
 */
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const built = (...segments) => path.join(root, "dist", "app", ...segments);

const { RevisionGuard } = require(built("core", "intelligence", "ingestion", "revisionGuard.js"));
const { reclaimSnapshotArchives, clearIntelligenceCache } = require(
  built("core", "intelligence", "ingestion", "snapshotPrune.js")
);

async function makeTempRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "keystone-verify-"));
  await fs.mkdir(path.join(dir, ".git"), { recursive: true });
  return dir;
}

async function writeSnapshots(repo, names) {
  const dir = path.join(repo, ".keystone", "intelligence", "snapshots");
  await fs.mkdir(dir, { recursive: true });
  for (const name of names) {
    const target = path.join(dir, name);
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, "manifest.json"), "x".repeat(1024 * 1024));
  }
}

async function sizeOf(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const child = path.join(dir, entry.name);
    total += entry.isDirectory() ? await sizeOf(child) : (await fs.stat(child)).size;
  }
  return total;
}

async function main() {
  // --- revisionGuard ---
  const repo = await makeTempRepo();
  const guard = new RevisionGuard(repo);
  assert.equal(await guard.current(), undefined, "no git => current undefined");
  assert.equal(await guard.detectMismatch(), undefined, "no git => no forced rebuild");
  await guard.write({ head: "abc123", branch: "main", capturedAt: new Date().toISOString() });
  assert.equal((await guard.read()).head, "abc123", "sidecar round-trip");
  assert.equal(await guard.detectMismatch(), undefined, "gitless + prior record => no rebuild");
  await fs.rm(repo, { recursive: true, force: true });
  console.log("PASS revisionGuard: sidecar round-trip, no forced rebuild when gitless");

  // --- snapshotPrune ---
  const repo2 = await makeTempRepo();
  const names = ["a", "b", "c", "d", "e"];
  await writeSnapshots(repo2, names);
  const snapDir = path.join(repo2, ".keystone", "intelligence", "snapshots");
  const before = await sizeOf(snapDir);
  const result = await reclaimSnapshotArchives(repo2);
  assert.equal(result.removedSnapshots, names.length - 1, "keep 1, remove rest");
  const after = await sizeOf(snapDir);
  assert.ok(after < before, "footprint reduced");
  assert.equal((await fs.readdir(snapDir)).length, 1, "exactly one retained");
  assert.ok(result.freedBytes > 0);
  await fs.rm(repo2, { recursive: true, force: true });
  console.log(
    `PASS snapshotPrune: kept 1, removed ${result.removedSnapshots}, freed ${(result.freedBytes / 1024 / 1024).toFixed(1)} MB`
  );

  // --- clearIntelligenceCache ---
  const repo3 = await makeTempRepo();
  await writeSnapshots(repo3, ["x", "y"]);
  const target = path.join(repo3, ".keystone", "intelligence");
  assert.ok((await fs.stat(target)).isDirectory());
  const cleared = await clearIntelligenceCache(repo3);
  assert.ok(cleared.freedBytes > 0);
  await assert.rejects(() => fs.stat(target), "intelligence dir removed");
  await fs.rm(repo3, { recursive: true, force: true });
  console.log(
    `PASS clearIntelligenceCache: removed ${(cleared.freedBytes / 1024 / 1024).toFixed(1)} MB`
  );

  console.log("\nALL CORE VERIFICATION PASSED");
}

main().catch((error) => {
  console.error("VERIFICATION FAILED:", error);
  process.exit(1);
});
