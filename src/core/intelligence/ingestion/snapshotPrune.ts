import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Snapshot-archive hygiene for the intelligence cache.
 *
 * These routines live in `core` (not `extension`) so the pipeline can prune
 * automatically on every run. They operate purely by deleting write-only
 * artifacts and never import or mutate OKF/CPG writers, readers, or formats.
 *
 * The `snapshots/` directory is written by `OkfSnapshotStore.write()` on every
 * successful run but is never read back by any code path. Left unchecked it
 * grows ~110 MB per run. Pruning keeps only the newest entry: enough for
 * forensic recovery, without paying the unbounded disk cost.
 */
const SNAPSHOT_RETENTION = 1;
const CACHE_RETENTION_DAYS = 30;
const CACHE_ENTRY_LIMITS: Readonly<Record<string, number>> = {
  extractions: 8192,
  query: 512,
  graph: 512
};

export interface ReclaimResult {
  readonly freedBytes: number;
  readonly removedSnapshots: number;
  readonly removedDirectories: string[];
  readonly cache: CacheReclaimResult;
}

export interface CacheReclaimResult {
  readonly scannedEntries: number;
  readonly retainedEntries: number;
  readonly removedEntries: number;
  readonly freedBytes: number;
  readonly byDirectory: Readonly<Record<string, number>>;
}

async function directorySize(target: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) {
      total += await directorySize(child);
    } else {
      try {
        const stat = await fs.stat(child);
        total += stat.size;
      } catch {
        // ignore entries removed concurrently
      }
    }
  }
  return total;
}

async function removeDirectory(target: string): Promise<number> {
  const size = await directorySize(target);
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    return 0;
  }
  return size;
}

export async function reclaimSnapshotArchives(workspaceRoot: string): Promise<ReclaimResult> {
  const snapshotsDir = path.join(workspaceRoot, ".keystone", "intelligence", "snapshots");
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(snapshotsDir, { withFileTypes: true });
  } catch {
    const cache = await reclaimPersistentCaches(workspaceRoot);
    return {
      freedBytes: cache.freedBytes,
      removedSnapshots: 0,
      removedDirectories: [],
      cache
    };
  }
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => right.name.localeCompare(left.name));
  const removable = directories.slice(SNAPSHOT_RETENTION);
  let freedBytes = 0;
  const removedDirectories: string[] = [];
  for (const directory of removable) {
    const target = path.join(snapshotsDir, directory.name);
    freedBytes += await removeDirectory(target);
    removedDirectories.push(target);
  }
  const cache = await reclaimPersistentCaches(workspaceRoot);
  return {
    freedBytes: freedBytes + cache.freedBytes,
    removedSnapshots: removable.length,
    removedDirectories,
    cache
  };
}

async function reclaimPersistentCaches(workspaceRoot: string): Promise<CacheReclaimResult> {
  const cacheRoot = path.join(workspaceRoot, ".keystone", "cache");
  const cutoff = Date.now() - CACHE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let scannedEntries = 0;
  let retainedEntries = 0;
  let removedEntries = 0;
  let freedBytes = 0;
  const byDirectory: Record<string, number> = {};

  for (const [directory, limit] of Object.entries(CACHE_ENTRY_LIMITS)) {
    const target = path.join(cacheRoot, directory);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(target, { withFileTypes: true });
    } catch {
      continue;
    }
    const candidates = (
      await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            try {
              const stat = await fs.stat(path.join(target, entry.name));
              return { path: path.join(target, entry.name), mtimeMs: stat.mtimeMs };
            } catch {
              return undefined;
            }
          })
      )
    ).filter((entry): entry is { path: string; mtimeMs: number } => Boolean(entry));
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    scannedEntries += candidates.length;
    let removedInDirectory = 0;
    for (const [index, entry] of candidates.entries()) {
      const expired = entry.mtimeMs < cutoff;
      const overLimit = index >= limit;
      if (!expired && !overLimit) continue;
      const size = await removeFile(entry.path);
      if (size === undefined) continue;
      freedBytes += size;
      removedEntries += 1;
      removedInDirectory += 1;
    }
    byDirectory[directory] = removedInDirectory;
    retainedEntries += candidates.length - removedInDirectory;
  }
  return { scannedEntries, retainedEntries, removedEntries, freedBytes, byDirectory };
}

async function removeFile(target: string): Promise<number | undefined> {
  let size = 0;
  try {
    size = (await fs.stat(target)).size;
    await fs.rm(target, { force: true });
    return size;
  } catch {
    return undefined;
  }
}

export async function clearIntelligenceCache(
  workspaceRoot: string
): Promise<{ freedBytes: number }> {
  const targets = [
    path.join(workspaceRoot, ".keystone", "intelligence"),
    path.join(workspaceRoot, ".keystone", "cache")
  ];
  let freedBytes = 0;
  for (const target of targets) freedBytes += await removeDirectory(target);
  return { freedBytes };
}
