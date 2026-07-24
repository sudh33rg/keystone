/**
 * GitHookSyncService — opt-in git hook installer that keeps the intelligence
 * snapshot fresh across bulk file changes the runtime watcher can miss
 * (branch switches, merges, pulls).
 *
 * Ported from codegraph's marker-delimited hook pattern (sync/git-hooks.ts):
 * install is idempotent (re-running replaces our block, never duplicates it)
 * and removal preserves user-authored hook content.
 *
 * Keystone ships no CLI, so hooks cannot invoke a sync command. Instead each
 * hook appends a timestamp to `.keystone/git-refresh-signal`; the extension's
 * existing watcher observes that file and schedules a bounded reconcile with
 * `reason: "git"`. The hook body is pure POSIX shell, backgrounded, and never
 * blocks git.
 *
 * Inert by default: nothing is installed unless `install()` is explicitly
 * called (settings plumbing decides that).
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const MARKER_BEGIN = "# >>> keystone intelligence sync hook >>>";
const MARKER_END = "# <<< keystone intelligence sync hook <<<";

export type GitHookName = "post-commit" | "post-merge" | "post-checkout";

/** Hooks installed by default: commit, merge (covers `git pull`), checkout. */
export const DEFAULT_SYNC_HOOKS: readonly GitHookName[] = [
  "post-commit",
  "post-merge",
  "post-checkout",
];

/** Relative path (from the repository root) of the refresh signal file. */
export const GIT_REFRESH_SIGNAL_PATH = ".keystone/git-refresh-signal";

export interface GitHookSyncResult {
  /** Hook names that were created, updated, or removed. */
  hooks: GitHookName[];
  /** Resolved hooks directory, or undefined when not a git repo. */
  hooksDir?: string;
  /** Reason nothing happened (e.g. not a git repository). */
  skipped?: string;
}

export class GitHookSyncService {
  /**
   * Whether `repositoryRoot` is inside a git working tree. False when git is
   * not installed or the path is not a repository.
   */
  isGitRepository(repositoryRoot: string): boolean {
    try {
      const out = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
      return out === "true";
    } catch {
      return false;
    }
  }

  /**
   * Install (or update) the sync hooks. Idempotent: re-running replaces the
   * marker block rather than duplicating it; user hook content is preserved.
   */
  install(
    repositoryRoot: string,
    hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
  ): GitHookSyncResult {
    const hooksDir = this.hooksDirectory(repositoryRoot);
    if (!hooksDir) return { hooks: [], skipped: "not a git repository" };
    try {
      fs.mkdirSync(hooksDir, { recursive: true });
    } catch {
      return { hooks: [], hooksDir, skipped: "could not access the git hooks directory" };
    }
    const block = this.markerBlock();
    const installed: GitHookName[] = [];
    for (const hook of hooks) {
      const file = path.join(hooksDir, hook);
      let content: string;
      if (fs.existsSync(file)) {
        const base = stripMarkerBlock(fs.readFileSync(file, "utf8")).replace(/\s*$/, "");
        content = base.length > 0 ? `${base}\n\n${block}\n` : `#!/bin/sh\n${block}\n`;
      } else {
        content = `#!/bin/sh\n${block}\n`;
      }
      fs.writeFileSync(file, content);
      chmodExecutable(file);
      installed.push(hook);
    }
    return { hooks: installed, hooksDir };
  }

  /**
   * Remove the sync hooks. Strips only the marker block; deletes the hook
   * file entirely when nothing but a shebang remains.
   */
  remove(
    repositoryRoot: string,
    hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
  ): GitHookSyncResult {
    const hooksDir = this.hooksDirectory(repositoryRoot);
    if (!hooksDir) return { hooks: [], skipped: "not a git repository" };
    const removed: GitHookName[] = [];
    for (const hook of hooks) {
      const file = path.join(hooksDir, hook);
      if (!fs.existsSync(file)) continue;
      const original = fs.readFileSync(file, "utf8");
      if (!original.includes(MARKER_BEGIN)) continue;
      const stripped = stripMarkerBlock(original);
      if (isEffectivelyEmpty(stripped)) {
        fs.unlinkSync(file);
      } else {
        fs.writeFileSync(file, `${stripped.replace(/\s*$/, "")}\n`);
        chmodExecutable(file);
      }
      removed.push(hook);
    }
    return { hooks: removed, hooksDir };
  }

  /** Whether any Keystone sync hook is currently installed. */
  isInstalled(
    repositoryRoot: string,
    hooks: readonly GitHookName[] = DEFAULT_SYNC_HOOKS,
  ): boolean {
    const hooksDir = this.hooksDirectory(repositoryRoot);
    if (!hooksDir) return false;
    return hooks.some((hook) => {
      const file = path.join(hooksDir, hook);
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(MARKER_BEGIN);
    });
  }

  /**
   * Resolve the git hooks directory, honoring `core.hooksPath` and worktrees.
   */
  private hooksDirectory(repositoryRoot: string): string | undefined {
    try {
      const out = execFileSync("git", ["rev-parse", "--git-path", "hooks"], {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
      }).trim();
      if (!out) return undefined;
      return path.isAbsolute(out) ? out : path.resolve(repositoryRoot, out);
    } catch {
      return undefined;
    }
  }

  /** The shell snippet (between markers) injected into each hook. */
  private markerBlock(): string {
    return [
      MARKER_BEGIN,
      "# Signals the Keystone extension to reconcile its intelligence snapshot",
      "# after commits, merges, and checkouts. Runs in the background and never",
      "# blocks git. Managed by Keystone; delete this block to disable.",
      `( mkdir -p "$(git rev-parse --show-toplevel)/.keystone" 2>/dev/null && \\`,
      `  date +%s > "$(git rev-parse --show-toplevel)/${GIT_REFRESH_SIGNAL_PATH}" ) >/dev/null 2>&1 &`,
      MARKER_END,
    ].join("\n");
  }
}

/** Remove the marker block (and the marker lines) from hook content. */
function stripMarkerBlock(content: string): string {
  const lines = content.split("\n");
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === MARKER_BEGIN) {
      inBlock = true;
      continue;
    }
    if (trimmed === MARKER_END) {
      inBlock = false;
      continue;
    }
    if (!inBlock) kept.push(line);
  }
  return kept.join("\n");
}

/** Whether a hook body is just a shebang / blank lines (i.e. only ever ours). */
function isEffectivelyEmpty(content: string): boolean {
  return content
    .split("\n")
    .map((line) => line.trim())
    .every((line) => line.length === 0 || line.startsWith("#!"));
}

function chmodExecutable(file: string): void {
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* chmod is a no-op on some platforms (e.g. Windows) */
  }
}
