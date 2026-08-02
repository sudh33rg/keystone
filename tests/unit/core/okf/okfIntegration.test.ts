import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "../../../support/testkit";
import { buildRepositoryIntelligence } from "@core/intelligence/pipeline";
import { OkfSnapshotStore } from "@core/intelligence/okf/store";
import { validateOkfSnapshot } from "@core/intelligence/okf/validation";
import { KEYSTONE_OKF_PROFILE } from "@core/intelligence/okf/profile";
import { CpgShardStore } from "@core/intelligence/cpg/shardStore";
import { validatePortableOkfBundle } from "@core/intelligence/okf/bundle";
import { queryOkfSnapshot } from "@core/intelligence/okf/queryEngine";
import { repoIntelligenceToOkf } from "@core/intelligence/okf/fromRepoIntelligence";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-okf-"));
  roots.push(root);
  for (const directory of ["src", "tests", "db", "config"])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { express: "^5.0.0" }, scripts: { test: "vitest" } })
  );
  fs.writeFileSync(path.join(root, "README.md"), "# Fixture\nDocuments the user service.");
  fs.writeFileSync(path.join(root, "config", "app.yaml"), "service: user\ntimeout: 30");
  fs.writeFileSync(
    path.join(root, "db", "schema.sql"),
    "CREATE TABLE users (id INTEGER, password TEXT);"
  );
  fs.writeFileSync(
    path.join(root, "src", "base.ts"),
    "export class Base {}\nexport interface Contract {}\nexport function helper(){ return true; }"
  );
  fs.writeFileSync(
    path.join(root, "src", "userService.ts"),
    [
      "import express from 'express';",
      "import { Base, Contract, helper } from './base';",
      "import { absent } from './missing';",
      "export class Child extends Base implements Contract {",
      "  run(){ const source = helper(); const value = source; return value; }",
      "}",
      "export const router = express.Router();",
      "router.get('/users', () => Child);",
      "// legacy password fetch database query marker"
    ].join("\n")
  );
  fs.writeFileSync(
    path.join(root, "tests", "userService.test.ts"),
    "import { Child } from '../src/userService';\ndescribe('Child', () => it('runs', () => new Child().run()));"
  );
  return root;
}

describe("authoritative OKF intelligence", () => {
  it("produces every profile family, validates it, links projections, and retains deletion lifecycle", async () => {
    const root = fixture();
    await buildRepositoryIntelligence(root, { cognitive: true });
    const store = new OkfSnapshotStore(root);
    const first = await store.read();
    expect(first).toBeDefined();
    expect(validateOkfSnapshot(first!).valid).toBe(true);
    expect(first!.observations.length).toBeGreaterThan(0);
    expect(
      new Set(first!.units.filter((unit) => unit.lifecycle === "active").map((unit) => unit.kind))
        .size
    ).toBe(KEYSTONE_OKF_PROFILE.knowledgeKinds.length);
    expect(
      [
        ...new Set(
          first!.units.filter((unit) => unit.lifecycle === "active").map((unit) => unit.kind)
        )
      ].sort()
    ).toEqual([...KEYSTONE_OKF_PROFILE.knowledgeKinds].sort());
    expect(
      [
        ...new Set(
          first!.relationships
            .filter((edge) => edge.lifecycle === "active")
            .map((edge) => edge.kind)
        )
      ].sort()
    ).toEqual([...KEYSTONE_OKF_PROFILE.relationshipKinds].sort());
    expect(
      first!.evidence.every(
        (item) => item.source.workspaceRelativePath && item.extractor && item.extractionRunId
      )
    ).toBe(true);
    expect(first!.units.every((item) => item.provenance.evidenceIds.length > 0)).toBe(true);

    const okfRoot = path.join(root, ".keystone", "intelligence", "okf");
    const graph = JSON.parse(
      fs.readFileSync(path.join(okfRoot, "projections", "graph.json"), "utf8")
    ) as {
      nodes: Array<{ id: string; okfId: string }>;
      edges: Array<{ id: string; okfId: string }>;
    };
    expect(graph.nodes.every((node) => node.id === node.okfId)).toBe(true);
    expect(graph.edges.every((edge) => edge.id === edge.okfId)).toBe(true);
    const search = fs
      .readFileSync(path.join(okfRoot, "projections", "search.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { okfId: string; evidenceIds: string[] });
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((item) => item.okfId && item.evidenceIds.length > 0)).toBe(true);
    const bindings = fs
      .readFileSync(path.join(okfRoot, "projections", "cpg-bindings.jsonl"), "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as { okfId: string; path: string });
    expect(bindings.some((item) => item.path === "src/userService.ts" && item.okfId)).toBe(true);

    const cpg = await new CpgShardStore(root).get("src/userService.ts");
    expect(cpg).toBeDefined();
    expect(cpg!.nodes.some((node) => Boolean(node.okfId))).toBe(true);
    expect(cpg!.edges.some((edge) => Boolean(edge.okfSourceId) || Boolean(edge.okfTargetId))).toBe(
      true
    );
    expect(fs.existsSync(path.join(root, ".keystone", "knowledge"))).toBe(false);
    const portableRoot = path.join(root, ".keystone", "intelligence", "okf-bundle");
    const portable = await validatePortableOkfBundle(portableRoot);
    expect(portable.valid).toBe(true);
    expect(portable.concepts).toBe(
      first!.units.filter((unit) => unit.lifecycle === "active").length
    );
    const portableManifest = JSON.parse(
      fs.readFileSync(path.join(portableRoot, ".keystone-bundle.json"), "utf8")
    ) as { format: string; version: string; concepts: number; extractionRunId: string };
    expect(portableManifest).toMatchObject({
      format: "OKF",
      version: "0.2",
      concepts: portable.concepts,
      extractionRunId: first!.manifest.extractionRunId
    });
    const rootIndex = fs.readFileSync(path.join(portableRoot, "index.md"), "utf8");
    expect(rootIndex.startsWith('---\nokf_version: \"0.2\"\n---')).toBe(true);
    const conceptFiles = walk(portableRoot).filter(
      (file) => file.endsWith(".md") && !file.endsWith("index.md") && !file.endsWith("log.md")
    );
    expect(conceptFiles.length).toBe(portable.concepts);
    expect(
      conceptFiles.every((file) => {
        const text = fs.readFileSync(file, "utf8");
        return (
          text.startsWith("---\ntype: ") &&
          text.includes('\ngenerated:\n  by: \"keystone/1.0.0\"') &&
          text.includes('\nverified:\n  - by: \"process:keystone-okf-validator\"') &&
          text.includes("\nstatus: stable")
        );
      })
    ).toBe(true);
    expect(
      conceptFiles.some((file) => {
        const text = fs.readFileSync(file, "utf8");
        return text.includes("\nsources:\n") && /\[\^source-[^\]]+\]:/m.test(text);
      })
    ).toBe(true);

    const readmeId = first!.units.find(
      (unit) => unit.kind === "documentation" && unit.properties.path === "README.md"
    )!.id;
    fs.rmSync(path.join(root, "README.md"));
    await buildRepositoryIntelligence(root, { cognitive: true });
    const second = await store.read();
    expect(second).toBeDefined();
    expect(validateOkfSnapshot(second!).valid).toBe(true);
    expect(second!.manifest.parentExtractionRunId).toBe(first!.manifest.extractionRunId);
    expect(second!.units.find((unit) => unit.id === readmeId)?.lifecycle).toBe("deleted");
    expect(second!.evidence.some((item) => item.freshness === "stale")).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          root,
          ".keystone",
          "intelligence",
          "snapshots",
          first!.manifest.extractionRunId,
          "manifest.json"
        )
      )
    ).toBe(true);
  });

  it("enforces relationship constraints at generation time and answers multi-hop evidence queries", async () => {
    const root = fixture();
    const snapshot = await buildRepositoryIntelligence(root, { cognitive: true });
    const intelligence = structuredClone(snapshot.intelligence);
    // Force the exact shape that previously broke persisted promotion: a test mapped to
    // a configuration artifact. The converter must produce a profile-valid representation.
    intelligence.tests.push({
      testFile: "tests/userService.test.ts",
      targetFile: "config/app.yaml",
      reason: "explicit regression mapping",
      confidence: 0.9
    } as any);
    const converted = repoIntelligenceToOkf(intelligence);
    expect(validateOkfSnapshot(converted).valid).toBe(true);
    expect(
      converted.relationships
        .filter((edge) => edge.kind === "tests" || edge.kind === "covers")
        .every((edge) => {
          const source = converted.units.find((unit) => unit.id === edge.sourceId);
          const target = converted.units.find((unit) => unit.id === edge.targetId);
          return source?.kind === "test" && Boolean(target);
        })
    ).toBe(true);

    const result = queryOkfSnapshot(converted, "What tests cover src/userService.ts?");
    expect(result.intent).toBe("tests");
    expect(result.traversedRelationships).toBeGreaterThan(0);
    expect(result.items.some((item) => item.path === "tests/userService.test.ts")).toBe(true);
    expect(result.items.every((item) => item.evidenceIds.length > 0)).toBe(true);
  });
});

function walk(root: string): string[] {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(root, entry.name)) : [path.join(root, entry.name)]
    );
}
