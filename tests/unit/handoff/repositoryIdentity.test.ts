import { describe, expect, it } from "vitest";
import { RepositoryIdentityService } from "../../../src/core/handoff/RepositoryIdentityService";
import type { HandoffRepositoryIdentity } from "../../../src/shared/contracts/handoff";

function buildService() {
  return new RepositoryIdentityService();
}

const baseInput = {
  repositoryName: "keystone",
  manifestHashes: [
    { relativePath: "package.json", contentHash: "sha256:" + "a".repeat(64) },
    { relativePath: "tsconfig.json", contentHash: "sha256:" + "b".repeat(64) },
  ],
  workspaceRootCount: 1,
};

describe("RepositoryIdentityService", () => {
  it("generates a deterministic identity for identical inputs", () => {
    const a = buildService().build(baseInput);
    const b = buildService().build(baseInput);
    expect(a.identityHash).toBe(b.identityHash);
  });

  it("does not depend on the absolute local path", () => {
    const withGit = buildService().build({ ...baseInput, git: { remoteUrl: "https://github.com/x/keystone.git", revision: "abc" } });
    expect(withGit.identityHash).toBeDefined();
    expect(JSON.stringify(withGit)).not.toContain("/Users/");
  });

  it("recognizes a matching clone", () => {
    const sender = buildService().build({ ...baseInput, git: { remoteUrl: "https://github.com/x/keystone.git", revision: "abc" } });
    const receiver = buildService().build({ ...baseInput, git: { remoteUrl: "https://github.com/x/keystone.git", revision: "abc" } });
    expect(buildService().compare(sender, receiver)).toBe("exact-match");
  });

  it("rejects an unrelated repository", () => {
    const sender = buildService().build({ ...baseInput, manifestHashes: [{ relativePath: "Cargo.toml", contentHash: "sha256:" + "f".repeat(64) }] });
    const receiver = buildService().build(baseInput);
    expect(buildService().compare(sender, receiver)).toBe("incompatible");
  });

  it("recognizes revision difference as a non-blocking warning", () => {
    const sender = buildService().build({ ...baseInput, git: { remoteUrl: "https://github.com/x/keystone.git", revision: "abc" } });
    const receiver = buildService().build({ ...baseInput, git: { remoteUrl: "https://github.com/x/keystone.git", revision: "def" } });
    expect(buildService().compare(sender, receiver)).toBe("compatible-revision-difference");
  });

  it("does not make handoff impossible when Git metadata is missing", () => {
    const sender = buildService().build(baseInput);
    const receiver = buildService().build(baseInput);
    const result = buildService().compare(sender, receiver);
    expect(["exact-match", "probable-match", "ambiguous", "unverifiable"]).toContain(result);
  });

  it("handles multi-root workspaces explicitly", () => {
    const multi = buildService().build({ ...baseInput, workspaceRootCount: 2, manifestHashes: [...baseInput.manifestHashes, { relativePath: "server/package.json", contentHash: "sha256:" + "c".repeat(64) }] });
    expect(multi.roots.length).toBeGreaterThan(0);
  });

  it("survives workspace relocation (renaming the repo does not change identityHash)", () => {
    const original = buildService().build(baseInput);
    const relocated = buildService().relocated(original, "keystone-renamed");
    expect(relocated.identityHash).toBe(original.identityHash);
    expect(relocated.repositoryName).toBe("keystone-renamed");
  });

  it("produces a schema-valid identity", () => {
    const id: HandoffRepositoryIdentity = buildService().build(baseInput);
    expect(id.identityHash.startsWith("sha256:")).toBe(true);
  });
});
