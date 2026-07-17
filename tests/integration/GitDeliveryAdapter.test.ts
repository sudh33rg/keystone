import { execFile } from "node:child_process";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitExecutableDeliveryAdapter } from "../../src/extension/git/GitDeliveryAdapter";

const execute = promisify(execFile);

describe("GitExecutableDeliveryAdapter", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "keystone-delivery-"));
    await git(root, ["init", "-b", "main"]); await git(root, ["config", "user.email", "keystone@example.invalid"]); await git(root, ["config", "user.name", "Keystone Test"]);
    await writeFile(join(root, "tracked.txt"), "baseline\n"); await git(root, ["add", "tracked.txt"]); await git(root, ["commit", "-m", "chore: baseline"]);
  });
  afterEach(async () => rm(root, { recursive: true, force: true }));

  it("detects repository, branch, head, and bounded working changes", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await writeFile(join(root, "tracked.txt"), "changed\n");
    const [capabilities, state, changes] = await Promise.all([adapter.capabilities(root), adapter.state(root), adapter.changes(root)]);
    expect(capabilities.repositoryDetected).toBe(true); expect(state.branch).toBe("main"); expect(state.dirty).toBe(true); expect(changes[0]?.path).toBe("tracked.txt");
  });

  it("stages, commits, and verifies actual committed paths", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await writeFile(join(root, "tracked.txt"), "changed\n"); await adapter.stage(root, ["tracked.txt"]);
    expect((await adapter.state(root)).stagedFiles).toContain("tracked.txt");
    const result = await adapter.commit(root, "feat: change tracked file");
    expect(result.hash).toHaveLength(40); expect(result.files).toEqual(["tracked.txt"]); expect((await adapter.state(root)).dirty).toBe(false);
  });

  it("creates a branch without invoking a shell", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await adapter.createBranch(root, "feature/delivery");
    expect((await adapter.state(root)).branch).toBe("feature/delivery");
    await expect(adapter.createBranch(root, "bad;touch-pwned")).rejects.toThrow();
  });

  it("rejects paths outside the repository boundary", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true);
    await expect(adapter.diff(root, "../outside", "working-head", 5_000)).rejects.toThrow(/boundary/);
    await expect(adapter.stage(root, ["/absolute"])).rejects.toThrow(/boundary/);
  });

  it("sanitizes credentials from remote state", async () => {
    await git(root, ["remote", "add", "origin", "https://user:secret@example.com/org/repo.git"]);
    const state = await new GitExecutableDeliveryAdapter(() => true).state(root);
    expect(state.remotes[0]?.sanitizedUrl).toBe("https://example.com/org/repo.git"); expect(JSON.stringify(state)).not.toContain("secret");
  });

  it("reports committed changes since a workflow base and bounded message history", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); const base = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); await writeFile(join(root, "tracked.txt"), "committed workflow change\n"); await git(root, ["add", "tracked.txt"]); await git(root, ["commit", "-m", "feat: committed workflow change"]);
    expect((await adapter.changes(root, base)).map((item) => item.path)).toContain("tracked.txt"); expect(await adapter.recentCommitSubjects(root, 1)).toEqual(["feat: committed workflow change"]);
  });

  it("classifies local commit ancestry for handoff reconciliation without synchronizing", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); const base = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim(); await writeFile(join(root, "tracked.txt"), "main continuation\n"); await git(root, ["commit", "-am", "feat: main continuation"]); const main = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    expect(await adapter.compareCommits(root, base, main)).toBe("ahead"); expect(await adapter.compareCommits(root, main, base)).toBe("behind");
    await git(root, ["switch", "-c", "side", base]); await writeFile(join(root, "tracked.txt"), "side continuation\n"); await git(root, ["commit", "-am", "feat: side continuation"]); const side = (await execute("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    expect(await adapter.compareCommits(root, main, side)).toBe("diverged"); expect(await adapter.compareCommits(root, "f".repeat(40), side)).toBe("missing-commits");
  });

  it("identifies symlink changes as special and excludes text-style assumptions", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await symlink("tracked.txt", join(root, "tracked-link")); await git(root, ["add", "tracked-link"]);
    const change = (await adapter.changes(root)).find((item) => item.path === "tracked-link"); expect(change?.sourceKind).toBe("symlink"); expect(change?.binary).toBe(true);
  });

  it("reports mixed staged, unstaged, and untracked state", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await writeFile(join(root, "tracked.txt"), "staged\n"); await git(root, ["add", "tracked.txt"]); await writeFile(join(root, "tracked.txt"), "staged then unstaged\n"); await writeFile(join(root, "new.txt"), "untracked\n"); const state = await adapter.state(root);
    expect(state.stagedFiles).toContain("tracked.txt"); expect(state.unstagedFiles).toContain("tracked.txt"); expect(state.untrackedFiles).toContain("new.txt");
  });

  it("reports rename and delete changes without fabricating continuity", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await git(root, ["mv", "tracked.txt", "renamed.txt"]); const renamed = await adapter.changes(root); expect(renamed[0]).toMatchObject({ path: "renamed.txt", previousPath: "tracked.txt", status: "renamed" }); await git(root, ["mv", "renamed.txt", "tracked.txt"]); await git(root, ["rm", "tracked.txt"]); expect((await adapter.changes(root))[0]?.status).toBe("deleted");
  });

  it("detects detached HEAD", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await git(root, ["checkout", "--detach", "HEAD"]); const state = await adapter.state(root); expect(state.detachedHead).toBe(true); expect(state.branch).toBeUndefined();
  });

  it("fails capability detection closed outside a Git repository", async () => {
    const outside = await mkdtemp(join(tmpdir(), "keystone-no-git-")); try { const capability = await new GitExecutableDeliveryAdapter(() => false).capabilities(outside); expect(capability.repositoryDetected).toBe(false); expect(capability.stagingAvailable).toBe(false); } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("identifies binary changes", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await writeFile(join(root, "binary.dat"), Buffer.from([0, 1, 2, 3, 255])); await git(root, ["add", "binary.dat"]); expect((await adapter.changes(root)).find((item) => item.path === "binary.dat")?.binary).toBe(true);
  });

  it("reports merge conflicts and in-progress operation state", async () => {
    const adapter = new GitExecutableDeliveryAdapter(() => true); await git(root, ["switch", "-c", "conflict-side"]); await writeFile(join(root, "tracked.txt"), "side\n"); await git(root, ["commit", "-am", "feat: side"]); await git(root, ["switch", "main"]); await writeFile(join(root, "tracked.txt"), "main\n"); await git(root, ["commit", "-am", "feat: main"]); await execute("git", ["merge", "conflict-side"], { cwd: root }).catch(() => undefined); const state = await adapter.state(root); expect(state.operation).toBe("merge"); expect(state.conflictedFiles).toContain("tracked.txt");
  });
});

async function git(root: string, args: string[]): Promise<void> { await execute("git", args, { cwd: root }); }
