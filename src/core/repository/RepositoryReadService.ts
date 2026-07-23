import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import * as vscode from "vscode";
import {
  type RepositoryChangedFile,
  type RepositoryDiff,
  type RepositoryHistoryEntry,
  type RepositoryIdentity,
  type RepositoryStatus,
} from "../../shared/contracts/repository";

const execute = promisify(execFile);

/**
 * Read-only Git command allowlist.
 *
 * Keystone may only READ repository information. These commands are the only
 * Git invocations the read service is permitted to perform. No mutation, remote,
 * or PR command is ever accepted, and arbitrary command text from the webview is
 * never executed.
 */
const READ_ONLY_GIT_COMMANDS = new Set([
  "status",
  "branch",
  "rev-parse",
  "rev-list",
  "log",
  "diff",
  "show",
  "remote",
  "symbolic-ref",
  "config",
  "ls-files",
  "cat-file",
]);

/**
 * Read-only Git command allowlist.
 *
 * Exposes only inspection operations. The interface intentionally omits every
 * mutation and remote-integration method (stage, commit, push, pull, fetch,
 * checkout, branch creation, merge, rebase, reset, stash, create PR, approve PR,
 * merge PR). This is a permanent local-first security boundary.
 */
export class RepositoryReadService {
  constructor(private readonly root: string) {}

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const command = args[0];
    if (!command || !READ_ONLY_GIT_COMMANDS.has(command)) {
      throw Object.assign(new Error(`Read-only Git command not permitted: ${command ?? "<empty>"}`), {
        code: "git-read-only-violation",
      });
    }
    try {
      return await execute("git", args, { cwd: this.root, maxBuffer: 64 * 1024 * 1024 });
    } catch (error) {
      const err = error as { stdout?: string; stderr?: string; message?: string };
      throw Object.assign(new Error(err.stderr?.trim() || err.message || "Git read failed"), {
        code: "git-read-error",
        stdout: err.stdout,
        stderr: err.stderr,
      });
    }
  }

  private fingerprint(input: string): string {
    return `sha256:${createHash("sha256").update(input).digest("hex").slice(0, 32)}`;
  }

  async getStatus(): Promise<RepositoryStatus> {
    const detected = await this
      .run(["rev-parse", "--is-inside-work-tree"])
      .then((r) => r.stdout.trim() === "true")
      .catch(() => false);
    if (!detected) {
      return {
        schemaVersion: 1,
        repositoryRoot: this.root,
        repositoryDetected: false,
        branch: undefined,
        revision: undefined,
        detachedHead: false,
        operation: "none",
        conflictedFiles: [],
        ahead: 0,
        behind: 0,
        fingerprint: this.fingerprint(`no-repo:${this.root}`),
      };
    }
    const statusRaw = await this.run(["status", "--porcelain=v1", "-z", "--branch"]);
    const entries = statusRaw.stdout.split("\0").filter(Boolean);
    let branch: string | undefined;
    let detachedHead = false;
    let ahead = 0;
    let behind = 0;
    const conflictedFiles: string[] = [];
    for (const entry of entries) {
      if (entry.startsWith("## ")) {
        const header = entry.slice(3);
        const branchMatch = header.match(/^(.+?)(?:\.\.\.|$)/);
        const branchText = branchMatch?.[1] ?? header;
        if (branchText.startsWith("(no branch)") || /^\(detached/.test(branchText)) {
          detachedHead = true;
        } else {
          branch = branchText;
        }
        const aheadBehind = header.match(/\[ahead (\d+), behind (\d+)\]/);
        if (aheadBehind) {
          ahead = Number(aheadBehind[1]);
          behind = Number(aheadBehind[2]);
        }
        continue;
      }
      const code = entry.slice(0, 2);
      if (code.includes("U") || code === "AA" || code === "DD") conflictedFiles.push(entry.slice(3));
    }
    const revision = await this.run(["rev-parse", "HEAD"]).then((r) => r.stdout.trim()).catch(() => undefined);
    const operation = conflictedFiles.length ? "unknown" : "none";
    const fingerprint = this.fingerprint(
      JSON.stringify({ branch, revision, ahead, behind, conflicted: conflictedFiles.length }),
    );
    return {
      schemaVersion: 1,
      repositoryRoot: this.root,
      repositoryDetected: true,
      branch,
      revision,
      detachedHead,
      operation,
      conflictedFiles,
      ahead,
      behind,
      fingerprint,
    };
  }

  async getCurrentBranch(): Promise<string | undefined> {
    return this.run(["branch", "--show-current"]).then((r) => r.stdout.trim() || undefined).catch(() => undefined);
  }

  async getCurrentRevision(): Promise<string | undefined> {
    return this.run(["rev-parse", "HEAD"]).then((r) => r.stdout.trim() || undefined).catch(() => undefined);
  }

  async getChangedFiles(): Promise<RepositoryChangedFile[]> {
    const out = await this.run(["status", "--porcelain=v1", "-z"]);
    const entries = out.stdout.split("\0").filter(Boolean);
    const files: RepositoryChangedFile[] = [];
    for (const entry of entries) {
      const code = entry.slice(0, 2);
      const path = entry.slice(3);
      const staged = code[0] !== " " && code[0] !== "?";
      const untracked = code === "??";
      const renamed = code[0] === "R";
      let previousPath: string | undefined;
      let effectivePath = path;
      if (renamed) {
        const [from, to] = path.split("\0");
        previousPath = from;
        effectivePath = to ?? path;
      }
      const status: RepositoryChangedFile["status"] = untracked
        ? "untracked"
        : renamed
          ? "renamed"
          : code.includes("D")
            ? "deleted"
            : code.includes("A")
              ? "added"
              : code.includes("U")
                ? "unmerged"
                : "modified";
      files.push({
        schemaVersion: 1,
        repositoryRoot: this.root,
        path: effectivePath,
        ...(previousPath ? { previousPath } : {}),
        status,
        staged,
        sourceKind: "file",
      });
    }
    return files;
  }

  async getDiff(relativePath: string): Promise<RepositoryDiff> {
    if (relativePath.includes("\0") || relativePath.includes("\n")) {
      throw Object.assign(new Error("Invalid relative path for diff."), { code: "git-read-invalid-path" });
    }
    const out = await this.run(["diff", "--unified=3", "--", relativePath]);
    const lines = out.stdout.split("\n");
    const hunks: RepositoryDiff["hunks"] = [];
    let current: RepositoryDiff["hunks"][number] | undefined;
    for (const line of lines) {
      const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
      if (hunkHeader) {
        current = {
          oldStart: Number(hunkHeader[1]),
          oldLines: Number(hunkHeader[2] ?? "1"),
          newStart: Number(hunkHeader[3]),
          newLines: Number(hunkHeader[4] ?? "1"),
          header: hunkHeader[5] ?? "",
          lines: [],
        };
        hunks.push(current);
        continue;
      }
      if (current) current.lines.push(line);
    }
    return { schemaVersion: 1, repositoryRoot: this.root, path: relativePath, hunks };
  }

  async getHistory(options: { limit: number; paths?: string[] }): Promise<RepositoryHistoryEntry[]> {
    const max = Math.min(Math.max(options.limit, 1), 200);
    const format = "%H%x1f%h%x1f%an%x1f%aI%x1f%s";
    const args = ["log", `--max-count=${max}`, `--format=${format}`];
    if (options.paths?.length) args.push("--", ...options.paths);
    const out = await this.run(args);
    return out.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [revision, shortRevision, author, timestamp, message] = line.split("\x1f");
        return {
          schemaVersion: 1,
          repositoryRoot: this.root,
          revision,
          shortRevision,
          author,
          timestamp,
          message,
        } as RepositoryHistoryEntry;
      });
  }

  async getRepositoryIdentity(): Promise<RepositoryIdentity> {
    const status = await this.getStatus();
    const revision = status.revision;
    const branch = status.branch;
    const remoteRaw = await this.run(["remote", "-v"]).then((r) => r.stdout.trim()).catch(() => "");
    const remoteUrl = remoteRaw.split("\n").find((l) => l.startsWith("origin"))?.split(/\s+/)[1];
    const defaultBranch = remoteRaw.includes("origin/HEAD")
      ? remoteRaw.match(/origin\/HEAD -> (.+)/)?.[1]
      : undefined;
    const sanitizedRemoteUrl = remoteUrl ? sanitizeRemoteUrl(remoteUrl) : undefined;
    const fingerprint = this.fingerprint(
      JSON.stringify({ remoteUrl: sanitizedRemoteUrl, defaultBranch, revision, branch }),
    );
    return {
      schemaVersion: 1,
      repositoryRoot: this.root,
      remoteUrl,
      sanitizedRemoteUrl,
      defaultBranch,
      revision,
      branch,
      fingerprint,
    };
  }
}

/** Redacts credentials from a remote URL. Pure, side-effect free. */
export function sanitizeRemoteUrl(value: string): string {
  return value.replace(/^(https?:\/\/)([^@]+@)/, "$1***@").replace(/(:)[^@]+@/, "$1***@");
}

/** Resolve the active workspace repository root via VS Code. Returns undefined when no folder is open. */
export function resolveRepositoryRoot(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}
