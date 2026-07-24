import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_HOOKS,
  GitHookSyncService,
} from "../../../src/core/intelligence/runtime/GitHookSyncService";

const MARKER_BEGIN = "# >>> keystone intelligence sync hook >>>";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "ignore", "ignore"] });
}

describe("GitHookSyncService", () => {
  let repo: string;
  const service = new GitHookSyncService();

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-githook-"));
    git(repo, "init");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("detects a git repository", () => {
    expect(service.isGitRepository(repo)).toBe(true);
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-plain-"));
    try {
      expect(service.isGitRepository(plain)).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it("installs marker-delimited hooks for all default hook names", () => {
    const result = service.install(repo);
    expect(result.skipped).toBeUndefined();
    expect(result.hooks).toEqual([...DEFAULT_SYNC_HOOKS]);
    for (const hook of DEFAULT_SYNC_HOOKS) {
      const file = path.join(result.hooksDir!, hook);
      const content = fs.readFileSync(file, "utf8");
      expect(content.startsWith("#!/bin/sh")).toBe(true);
      expect(content).toContain(MARKER_BEGIN);
      expect(content).toContain(".keystone/git-refresh-signal");
    }
    expect(service.isInstalled(repo)).toBe(true);
  });

  it("is idempotent: reinstall never duplicates the marker block", () => {
    service.install(repo);
    const result = service.install(repo);
    for (const hook of DEFAULT_SYNC_HOOKS) {
      const content = fs.readFileSync(path.join(result.hooksDir!, hook), "utf8");
      expect(content.split(MARKER_BEGIN).length - 1).toBe(1);
    }
  });

  it("preserves user-authored hook content on install and remove", () => {
    const hooksDir = service.install(repo).hooksDir!;
    const file = path.join(hooksDir, "post-commit");
    const userLine = "echo user-authored-line";
    fs.writeFileSync(file, `#!/bin/sh\n${userLine}\n`);
    service.install(repo, ["post-commit"]);
    let content = fs.readFileSync(file, "utf8");
    expect(content).toContain(userLine);
    expect(content).toContain(MARKER_BEGIN);
    service.remove(repo, ["post-commit"]);
    content = fs.readFileSync(file, "utf8");
    expect(content).toContain(userLine);
    expect(content).not.toContain(MARKER_BEGIN);
  });

  it("removes hook files entirely when only our block was present", () => {
    const hooksDir = service.install(repo).hooksDir!;
    const result = service.remove(repo);
    expect(result.hooks).toEqual([...DEFAULT_SYNC_HOOKS]);
    for (const hook of DEFAULT_SYNC_HOOKS) {
      expect(fs.existsSync(path.join(hooksDir, hook))).toBe(false);
    }
    expect(service.isInstalled(repo)).toBe(false);
  });

  it("skips gracefully outside a git repository", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-plain-"));
    try {
      expect(service.install(plain).skipped).toBe("not a git repository");
      expect(service.remove(plain).skipped).toBe("not a git repository");
      expect(service.isInstalled(plain)).toBe(false);
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
