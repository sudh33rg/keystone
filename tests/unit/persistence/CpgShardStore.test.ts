import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AtomicFileWriter } from "../../../src/core/persistence/AtomicFileWriter";
import { CpgShardStore } from "../../../src/core/persistence/CpgShardStore";
import { TypeScriptJavaScriptParser } from "../../../src/core/intelligence/semantic/TypeScriptJavaScriptParser";
import type {
  SemanticProjectRequest,
  SemanticSourceFileInput,
} from "../../../src/core/intelligence/semantic/SemanticModel";
import type { CpgScopeArtifact } from "../../../src/shared/contracts/cpg";

describe("CpgShardStore", () => {
  it("hard-links structurally unchanged scopes even after a worker rebuild", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-cpg-store-"));
    const firstRoot = join(root, "000001");
    const secondRoot = join(root, "000002.pending");
    const parser = new TypeScriptJavaScriptParser();
    const extracted = await parser.extract(request());
    const first = extracted.cpg?.scopes.find((scope) => scope.descriptor.kind === "function");
    if (!first) throw new Error("Expected a CPG function scope.");
    const store = new CpgShardStore(new AtomicFileWriter(), {
      parseJson: (value) => Promise.resolve(JSON.parse(value) as unknown),
      stringifyJson: (value) => Promise.resolve(JSON.stringify(value)),
    });

    await store.writeGeneration(firstRoot, undefined, {
      semanticGeneration: 1,
      providerId: first.descriptor.providerId,
      providerVersion: first.descriptor.providerVersion,
      scopes: [first],
      removedScopeIds: [],
      buildTimeMs: 1,
    });
    const rebuilt = atGeneration(first, 2);
    const manifest = await store.writeGeneration(secondRoot, firstRoot, {
      semanticGeneration: 2,
      providerId: rebuilt.descriptor.providerId,
      providerVersion: rebuilt.descriptor.providerVersion,
      scopes: [rebuilt],
      removedScopeIds: [],
      buildTimeMs: 1,
    });

    const previous = await stat(join(firstRoot, first.descriptor.shard));
    const current = await stat(join(secondRoot, rebuilt.descriptor.shard));
    expect(current.ino).toBe(previous.ino);
    expect(manifest.metrics).toMatchObject({ scopesBuilt: 0, scopesReused: 1 });
  });
});

function request(): SemanticProjectRequest {
  const file: SemanticSourceFileInput = {
    uri: "file:///fixture/example.ts",
    relativePath: "src/example.ts",
    workspaceRootId: "root:fixture",
    fileId: "file:src/example.ts",
    language: "typescript",
    category: "source",
    contentHash: "sha256:example",
    content: "export function example(value: number): number { return value + 1; }",
  };
  return {
    repositoryId: "repository:cpg-store",
    projectKey: "cpg-store",
    generation: 1,
    jobRevision: 1,
    reset: true,
    branch: "main",
    commit: "abc",
    changedFiles: [file],
    removedPaths: [],
  };
}

function atGeneration(artifact: CpgScopeArtifact, generation: number): CpgScopeArtifact {
  return {
    ...artifact,
    reused: false,
    descriptor: { ...artifact.descriptor, generation },
    nodes: artifact.nodes.map((node) => ({ ...node, generation })),
    edges: artifact.edges.map((edge) => ({ ...edge, generation })),
  };
}
