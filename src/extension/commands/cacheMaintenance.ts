import * as vscode from "vscode";

import type { VscodeProvider } from "../ui/vscodeProvider";
import {
  clearIntelligenceCache,
  reclaimSnapshotArchives
} from "../../core/intelligence/ingestion/snapshotPrune";

/**
 * Registers the cache-maintenance commands. The actual pruning logic lives in
 * `core` (`snapshotPrune.ts`) so it can be reused by the pipeline; this module
 * only wires the commands and surfaces results to the user.
 */
export function registerCacheMaintenanceCommands(
  context: { subscriptions: { push(...items: unknown[]): void } },
  provider: VscodeProvider
): void {
  const reclaim = vscode.commands.registerCommand("keystone.reclaimCache", async () => {
    const root = provider.activeWorkspaceRoot;
    if (!root) return;
    const result = await reclaimSnapshotArchives(root);
    if (result.removedSnapshots === 0 && result.cache.removedEntries === 0) {
      provider.notify("Keystone: intelligence caches are within the retention policy.");
      return;
    }
    const megabytes = (result.freedBytes / (1024 * 1024)).toFixed(1);
    provider.notify(
      `Keystone: reclaimed ${megabytes} MB (${result.removedSnapshots} snapshot archive(s), ${result.cache.removedEntries} persistent cache entr${result.cache.removedEntries === 1 ? "y" : "ies"}).`
    );
  });
  const clear = vscode.commands.registerCommand("keystone.clearCache", async () => {
    const root = provider.activeWorkspaceRoot;
    if (!root) return;
    const confirmation = await vscode.window.showWarningMessage(
      "Clear all Keystone intelligence for this workspace? This removes the cached graph and requires a full re-index.",
      { modal: true },
      "Clear cache"
    );
    if (confirmation !== "Clear cache") return;
    const result = await clearIntelligenceCache(root);
    const megabytes = (result.freedBytes / (1024 * 1024)).toFixed(1);
    provider.notify(
      `Keystone: cleared ${megabytes} MB of intelligence cache. Triggering re-index.`
    );
    await provider.indexWorkspace(root);
  });
  context.subscriptions.push(reclaim, clear);
}
