import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import type {
  GitRuntimeAdapter,
  GitRuntimeChange,
  BoundedGitDiff,
} from "../../core/delivery/GitDeliveryService";
import { GitBranchService, sanitizeRemoteUrl } from "../../core/delivery/GitDeliveryService";
import {
  GitCapabilitiesSchema,
  GitRepositoryStateSchema,
  type GitCapabilities,
  type GitRepositoryState,
} from "../../shared/contracts/delivery";

const execute = promisify(execFile);

export class GitExecutableDeliveryAdapter implements GitRuntimeAdapter {
  constructor(private readonly gitExtensionAvailable: () => boolean) {}
  async capabilities(root: string): Promise<GitCapabilities> {
    const available = await this.run(root, ["--version"], true).then(
      () => true,
      () => false,
    );
    const repositoryDetected =
      available &&
      (await this.run(root, ["rev-parse", "--is-inside-work-tree"], true).then(
        (item) => item.stdout.trim() === "true",
        () => false,
      ));
    return GitCapabilitiesSchema.parse({
      schemaVersion: 1,
      repositoryRoot: root,
      repositoryDetected,
      gitExtensionAvailable: this.gitExtensionAvailable(),
      gitExecutableAvailable: available,
      statusAvailable: repositoryDetected,
      diffAvailable: repositoryDetected,
      stagingAvailable: repositoryDetected,
      commitAvailable: repositoryDetected,
      branchCreationAvailable: repositoryDetected,
      pushAvailable: repositoryDetected,
      remotesAvailable: repositoryDetected,
      upstreamAvailable: repositoryDetected,
      diagnostics: repositoryDetected
        ? []
        : [
            {
              code: "git-repository-unavailable",
              severity: "error",
              message: "No Git worktree is available for delivery.",
            },
          ],
      refreshedAt: new Date().toISOString(),
    });
  }
  async state(root: string): Promise<GitRepositoryState> {
    const status = await this.run(root, ["status", "--porcelain=v1", "-z", "--branch"]);
    const entries = parseStatus(status.stdout);
    const branch = await this.optional(root, ["branch", "--show-current"]);
    const head = await this.optional(root, ["rev-parse", "HEAD"]);
    const upstream = await this.optional(root, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
    const counts = upstream
      ? await this.optional(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`])
      : undefined;
    const [ahead = 0, behind = 0] = counts?.trim().split(/\s+/).map(Number) ?? [];
    const remoteText = await this.optional(root, ["remote", "-v"]);
    const remotes = parseRemotes(remoteText ?? "");
    const defaultRemote = remotes.some((item) => item.name === "origin")
      ? "origin"
      : remotes[0]?.name;
    const defaultRef = defaultRemote
      ? await this.optional(root, ["symbolic-ref", "--short", `refs/remotes/${defaultRemote}/HEAD`])
      : undefined;
    const defaultBranch = defaultRef?.split("/").slice(1).join("/");
    const operation = await this.operation(root);
    const repositoryId = `repository:${createHash("sha256").update(root).digest("hex").slice(0, 32)}`;
    const rawDiff = await this.optional(root, ["diff", "--raw", "HEAD"]);
    const special = parseIndexKinds((await this.optional(root, ["ls-files", "-s", "-z"])) ?? "");
    const stateData = [
      branch,
      head,
      upstream,
      ahead,
      behind,
      rawDiff,
      entries.map((item) => [item.path, item.x, item.y]),
    ];
    return GitRepositoryStateSchema.parse({
      schemaVersion: 1,
      repositoryRoot: root,
      repositoryId,
      ...(branch ? { branch } : {}),
      detachedHead: !branch && Boolean(head),
      ...(head ? { headCommit: head } : {}),
      ...(upstream ? { upstreamBranch: upstream } : {}),
      ahead,
      behind,
      dirty: entries.length > 0,
      stagedFiles: unique(
        entries.filter((item) => item.x !== " " && item.x !== "?").map((item) => item.path),
      ),
      unstagedFiles: unique(
        entries.filter((item) => item.y !== " " && item.y !== "?").map((item) => item.path),
      ),
      untrackedFiles: unique(entries.filter((item) => item.x === "?").map((item) => item.path)),
      conflictedFiles: unique(
        entries.filter((item) => isConflict(`${item.x}${item.y}`)).map((item) => item.path),
      ),
      remotes: remotes.map((item) => ({
        ...item,
        isDefault: item.name === defaultRemote,
        ...(item.name === defaultRemote && defaultBranch ? { defaultBranch } : {}),
      })),
      ...(defaultRemote ? { defaultRemote } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      operation,
      worktree: true,
      submodules: [...special.values()].includes("submodule"),
      fingerprint: digest(JSON.stringify(stateData)),
      capturedAt: new Date().toISOString(),
      diagnostics: [],
    });
  }
  async changes(root: string, baseCommit?: string): Promise<GitRuntimeChange[]> {
    const working = parseStatus((await this.run(root, ["status", "--porcelain=v1", "-z"])).stdout);
    const committed = baseCommit
      ? parseNameStatus(
          (await this.optional(root, [
            "diff",
            "--name-status",
            "-z",
            "--find-renames",
            baseCommit,
            "HEAD",
          ])) ?? "",
        )
      : [];
    const stats = new Map<string, { additions?: number; deletions?: number; binary: boolean }>();
    const special = parseIndexKinds((await this.optional(root, ["ls-files", "-s", "-z"])) ?? "");
    for (const args of [
      ["diff", "--numstat", "-z", ...(baseCommit ? [baseCommit] : [])],
      ["diff", "--cached", "--numstat", "-z", ...(baseCommit ? [baseCommit] : [])],
    ]) {
      const value = await this.optional(root, args);
      for (const item of parseNumstat(value ?? "")) stats.set(item.path, item);
    }
    const combined = new Map<string, GitRuntimeChange>();
    for (const item of committed)
      combined.set(item.path, {
        ...item,
        sourceKind: special.get(item.path) ?? "file",
        binary: item.binary || special.has(item.path),
      });
    for (const item of working) {
      const stat = stats.get(item.path);
      const sourceKind = special.get(item.path) ?? "file";
      combined.set(item.path, {
        path: item.path,
        ...(item.previousPath ? { previousPath: item.previousPath } : {}),
        status: statusKind(item),
        staged: item.x !== " " && item.x !== "?",
        sourceKind,
        ...(stat?.additions !== undefined ? { additions: stat.additions } : {}),
        ...(stat?.deletions !== undefined ? { deletions: stat.deletions } : {}),
        binary: stat?.binary === true || sourceKind !== "file",
      });
    }
    return [...combined.values()].slice(0, 5000);
  }
  async diff(
    root: string,
    path: string,
    mode: "working-head" | "index-head" | "working-index",
    maxBytes: number,
    signal?: AbortSignal,
  ): Promise<BoundedGitDiff> {
    validatePath(path);
    const args =
      mode === "index-head"
        ? ["diff", "--cached", "--", path]
        : mode === "working-index"
          ? ["diff", "--", path]
          : ["diff", "HEAD", "--", path];
    const result = await this.run(root, args, false, signal);
    const totalBytes = Buffer.byteLength(result.stdout);
    return {
      path,
      text: result.stdout.slice(0, Math.min(maxBytes, 100_000)),
      binary: /Binary files .* differ/.test(result.stdout),
      truncated: totalBytes > Math.min(maxBytes, 100_000),
      totalBytes,
    };
  }
  async stage(root: string, paths: string[]) {
    paths.forEach(validatePath);
    const result = await this.run(root, ["add", "--", ...paths]);
    return { output: result.stdout + result.stderr };
  }
  async unstage(root: string, paths: string[]) {
    paths.forEach(validatePath);
    const result = await this.run(root, ["restore", "--staged", "--", ...paths]);
    return { output: result.stdout + result.stderr };
  }
  async createBranch(root: string, branch: string) {
    if (new GitBranchService().validate(branch).length) throw new Error("Branch name is invalid.");
    const result = await this.run(root, ["switch", "-c", branch]);
    return { output: result.stdout + result.stderr };
  }
  async commit(root: string, message: string) {
    if (!message.trim() || message.length > 20_000)
      throw new Error("Commit message is empty or oversized.");
    const before = await this.optional(root, ["rev-parse", "HEAD"]);
    const result = await this.run(root, ["commit", "-m", message]);
    const hash = (await this.run(root, ["rev-parse", "HEAD"])).stdout.trim();
    if (hash === before) throw new Error("Git did not create a new commit.");
    const files = (
      await this.run(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"])
    ).stdout
      .split(/\r?\n/)
      .filter(Boolean);
    return { hash, files, output: result.stdout + result.stderr };
  }
  async push(root: string, remote: string, branch: string, setUpstream: boolean) {
    if (!/^[A-Za-z0-9._-]+$/.test(remote)) throw new Error("Remote name is invalid.");
    const result = await this.run(root, [
      "push",
      ...(setUpstream ? ["--set-upstream"] : []),
      remote,
      branch,
    ]);
    const counts = await this.optional(root, [
      "rev-list",
      "--left-right",
      "--count",
      `HEAD...${remote}/${branch}`,
    ]);
    const values = counts?.trim().split(/\s+/).map(Number);
    return { output: result.stdout + result.stderr, verified: Boolean(values && values[0] === 0) };
  }
  async recentCommitSubjects(root: string, limit: number): Promise<string[]> {
    const bounded = Math.max(1, Math.min(limit, 100));
    const value = await this.optional(root, ["log", `-${bounded}`, "--pretty=%s"]);
    return value?.split(/\r?\n/).filter(Boolean).slice(0, bounded) ?? [];
  }
  async compareCommits(
    root: string,
    sender: string,
    receiver: string,
  ): Promise<"ahead" | "behind" | "diverged" | "missing-commits"> {
    if (![sender, receiver].every((value) => /^[0-9a-f]{7,64}$/i.test(value)))
      return "missing-commits";
    const exists = async (value: string): Promise<boolean> =>
      this.run(root, ["cat-file", "-e", `${value}^{commit}`], true).then(
        () => true,
        () => false,
      );
    if (!(await exists(sender)) || !(await exists(receiver))) return "missing-commits";
    const isAncestor = (ancestor: string, descendant: string): Promise<boolean> =>
      this.run(root, ["merge-base", "--is-ancestor", ancestor, descendant], true).then(
        () => true,
        () => false,
      );
    if (await isAncestor(sender, receiver)) return "ahead";
    if (await isAncestor(receiver, sender)) return "behind";
    return "diverged";
  }
  private async operation(root: string): Promise<GitRepositoryState["operation"]> {
    for (const [ref, operation] of [
      ["MERGE_HEAD", "merge"],
      ["REBASE_HEAD", "rebase"],
      ["CHERRY_PICK_HEAD", "cherry-pick"],
      ["REVERT_HEAD", "revert"],
    ] as const)
      if (
        await this.run(root, ["rev-parse", "--verify", "-q", ref], true).then(
          () => true,
          () => false,
        )
      )
        return operation;
    return "none";
  }
  private optional(root: string, args: string[]): Promise<string | undefined> {
    return this.run(root, args, true).then(
      (item) => item.stdout.trim() || undefined,
      () => undefined,
    );
  }
  private async run(
    root: string,
    args: string[],
    allowFailure = false,
    signal?: AbortSignal,
  ): Promise<{ stdout: string; stderr: string }> {
    if (args.some((item) => item.includes("\0") || item.includes("\r") || item.includes("\n")))
      throw new Error("Git argument contains a prohibited control character.");
    try {
      const result = await execute("git", args, {
        cwd: root,
        env: safeEnvironment(),
        timeout: 120_000,
        maxBuffer: 1_000_000,
        encoding: "utf8",
        ...(signal ? { signal } : {}),
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (cause) {
      if (allowFailure) throw cause;
      const error = cause as { stdout?: string; stderr?: string; message?: string };
      throw new Error(
        sanitize(
          `${error.stderr ?? ""}\n${error.stdout ?? ""}\n${error.message ?? "Git operation failed."}`,
        ),
        { cause },
      );
    }
  }
}

interface StatusEntry {
  x: string;
  y: string;
  path: string;
  previousPath?: string;
  submodule: boolean;
}
function parseStatus(value: string): StatusEntry[] {
  const parts = value.split("\0");
  const output: StatusEntry[] = [];
  for (let index = 0; index < parts.length; index++) {
    const item = parts[index];
    if (!item || item.startsWith("## ")) continue;
    const x = item[0] ?? " ";
    const y = item[1] ?? " ";
    const path = item.slice(3);
    const renamed = x === "R" || y === "R";
    const previousPath = renamed ? parts[++index] : undefined;
    output.push({ x, y, path, ...(previousPath ? { previousPath } : {}), submodule: false });
  }
  return output;
}
function parseNumstat(
  value: string,
): Array<{ path: string; additions?: number; deletions?: number; binary: boolean }> {
  return value
    .split("\0")
    .filter(Boolean)
    .flatMap((item) => {
      const [add, del, path] = item.split("\t");
      if (!path) return [];
      const binary = add === "-" || del === "-";
      return [
        { path, ...(binary ? {} : { additions: Number(add), deletions: Number(del) }), binary },
      ];
    });
}
function parseNameStatus(value: string): GitRuntimeChange[] {
  const parts = value.split("\0").filter(Boolean);
  const output: GitRuntimeChange[] = [];
  for (let index = 0; index < parts.length;) {
    const code = parts[index++]!;
    const first = parts[index++];
    if (!first) break;
    if (code.startsWith("R") || code.startsWith("C")) {
      const next = parts[index++];
      if (next)
        output.push({
          path: next,
          previousPath: first,
          status: "renamed",
          staged: false,
          binary: false,
        });
    } else
      output.push({
        path: first,
        status: code === "A" ? "added" : code === "D" ? "deleted" : "modified",
        staged: false,
        binary: false,
      });
  }
  return output;
}
function parseIndexKinds(value: string): Map<string, "symlink" | "submodule"> {
  const output = new Map<string, "symlink" | "submodule">();
  for (const item of value.split("\0").filter(Boolean)) {
    const match = /^(120000|160000) [0-9a-f]+ \d+\t(.+)$/.exec(item);
    if (match?.[2]) output.set(match[2], match[1] === "120000" ? "symlink" : "submodule");
  }
  return output;
}
function parseRemotes(value: string): Array<{ name: string; sanitizedUrl: string }> {
  const output = new Map<string, { name: string; sanitizedUrl: string }>();
  for (const line of value.split(/\r?\n/)) {
    const match = /^(\S+)\s+(\S+)\s+\((?:fetch|push)\)$/.exec(line);
    if (match?.[1] && match[2] && !output.has(match[1]))
      output.set(match[1], { name: match[1], sanitizedUrl: sanitizeRemoteUrl(match[2]) });
  }
  return [...output.values()];
}
function statusKind(item: StatusEntry): GitRuntimeChange["status"] {
  const code = `${item.x}${item.y}`;
  if (isConflict(code)) return "conflicted";
  if (item.x === "?" || item.y === "?") return "untracked";
  if (code.includes("R")) return "renamed";
  if (code.includes("A")) return "added";
  if (code.includes("D")) return "deleted";
  return "modified";
}
function isConflict(code: string): boolean {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(code);
}
function validatePath(path: string): void {
  if (
    !path ||
    path.startsWith("/") ||
    path.split(/[\\/]/).includes("..") ||
    path.includes("\0") ||
    path.includes("\r") ||
    path.includes("\n")
  )
    throw new Error("Git path is outside the approved repository boundary.");
}
function safeEnvironment(): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    LC_ALL: "C",
  };
  for (const key of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "SSH_AUTH_SOCK"])
    if (process.env[key]) output[key] = process.env[key];
  return output;
}
function sanitize(value: string): string {
  return [
    ...value
      .replace(/(?:https?:\/\/)?[^\s/@:]+:[^\s/@]+@/g, "")
      .replace(/ghp_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+/g, "[REDACTED]"),
  ]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join("")
    .slice(-20_000);
}
function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function unique<T>(values: T[]): T[] {
  return [...new Set(values)].sort();
}
