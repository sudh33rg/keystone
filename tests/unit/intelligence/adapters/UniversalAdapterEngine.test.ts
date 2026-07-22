import { beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  UniversalAdapterEngine,
  type UniversalAnalysisResult,
} from "../../../../src/core/intelligence/adapters/UniversalAdapterEngine";
import { DefaultIgnorePolicy } from "../../../../src/core/intelligence/IgnorePolicy";
import { IntelligenceQueryService } from "../../../../src/core/intelligence/IntelligenceQueryService";
import type {
  SemanticProjectRequest,
  SemanticSourceFileInput,
} from "../../../../src/core/intelligence/semantic/SemanticModel";
import type {
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
} from "../../../../src/shared/contracts/intelligence";
import type { AdapterOutput } from "../../../../src/shared/contracts/adapters";

const CONTENT: Record<string, string> = {
  "docs/README.md":
    "# Guide\n\n## Setup\nSee [decision](adr/0001-cache.md).\n\n```sh\nnpm test\n```\nREQ-101: Preserve evidence.\n",
  "docs/adr/0001-cache.md": "# Cache Decision\nStatus: accepted\nDecision: use a local cache.\n",
  "api/openapi.yaml":
    "openapi: 3.0.0\npaths:\n  /users/{id}:\n    get:\n      operationId: getUser\ncomponents:\n  schemas:\n    User:\n      type: object\n",
  "api/schema.graphql": "type User { id: ID! name: String! }\ntype Query { user(id: ID!): User }\n",
  "api/user.schema.json": JSON.stringify({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "User",
    type: "object",
    properties: { id: { type: "string" }, active: { type: "boolean" } },
  }),
  "api/user.proto":
    'syntax = "proto3"; message User { string id = 1; } service Users { rpc GetUser (User) returns (User); }',
  "api/event.avsc": JSON.stringify({
    type: "record",
    name: "Event",
    fields: [{ name: "id", type: "string" }],
  }),
  "db/schema.sql":
    "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nCREATE TABLE posts (id INTEGER, user_id INTEGER, FOREIGN KEY (user_id) REFERENCES users(id));\nCREATE INDEX posts_user_idx ON posts(user_id);",
  "db/migrations/002_users.sql": "ALTER TABLE users ADD COLUMN email TEXT;",
  "prisma/schema.prisma":
    'model User {\n id Int @id\n name String @map("full_name")\n @@map("users")\n}\n',
  "src/User.java":
    'package app; import java.util.List; @Entity(name="users") public class User { @Test public void testSave() {} public void save() {} }',
  "src/service.py":
    "import os\nfrom flask import Flask\nclass Service:\n    def run(self):\n        return 1\ndef helper(value):\n    return value\n",
  "src/Service.cs": "namespace App; public class Service { public void Run() {} }",
  "src/service.go": 'package service\nimport "fmt"\nfunc Run() {}\nfunc TestRun(t *testing.T) {}\n',
  "src/lib.rs":
    "use std::fmt; pub struct Item { id: i32 } pub fn run() {} #[test] fn test_run() {}",
  "src/tool.sh": "#!/bin/sh\nfunction build_app() { echo ok; }\n",
  "src/unknown.foo": "widget Unknown { value }",
  "tests/test_service.py":
    "import pytest\n@pytest.mark.unit\ndef test_service():\n    assert True\n",
  "package.json": JSON.stringify({
    name: "sample",
    scripts: { build: "vite build", test: "vitest" },
    dependencies: { react: "1" },
    devDependencies: { vite: "1" },
  }),
  "pom.xml":
    "<project><artifactId>sample</artifactId><dependencies><dependency><groupId>org.junit</groupId><artifactId>junit</artifactId><scope>test</scope></dependency></dependencies><build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build></project>",
  "app.csproj":
    '<Project><PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup><ItemGroup><PackageReference Include="NUnit" Version="4.0" /></ItemGroup><Target Name="BuildDocs" /></Project>',
  "pyproject.toml":
    '[project]\nname = "sample-python"\ndependencies = ["requests"]\n[tool.poetry.dependencies]\npython = "^3.12"\nrequests = "^2"\n',
  ".github/workflows/ci.yml":
    "name: CI\non: push\njobs:\n  build:\n    steps:\n      - run: npm run build\n      - run: npm test\n      - run: echo ${{ secrets.API_TOKEN }}\n",
  ".gitlab-ci.yml": "stages:\n  test:\n    script: pytest\n",
  Dockerfile: "FROM node:20 AS build\nEXPOSE 3000\nENV API_TOKEN=not-persisted\n",
  "compose.yaml":
    'services:\n  api:\n    image: sample/api\n    ports:\n      - "3000:3000"\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n',
  "k8s/deployment.yaml":
    "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: api\nspec:\n  template:\n    spec:\n      containers:\n        - image: sample/api\n          env:\n            - secretKeyRef:\n                name: API_TOKEN\n",
  "infra/main.tf":
    'resource "aws_s3_bucket" "assets" {}\nvariable "region" { default = "us-east-1" }\n',
  "config/app.yaml":
    "server:\n  port: 3000\npassword: super-secret-value\nAPI_TOKEN: token-value\n",
};

describe("Universal repository intelligence adapters", () => {
  let result: UniversalAnalysisResult;
  beforeAll(async () => {
    result = await new UniversalAdapterEngine().analyze(request(CONTENT), [], []);
  });
  const entities = (type: string) => result.entities.filter((item) => item.type === type);
  const relations = (type: string) => result.relationships.filter((item) => item.type === type);
  const detected = (technology: string) =>
    result.adapterState.detections.some((item) => item.technologyId === technology);

  it("1 extracts Markdown hierarchy and exact document links", () => {
    expect(entities("keystone.core.Section").map((item) => item.name)).toContain("Setup");
    expect(relations("keystone.core.LINKS_TO")).toHaveLength(1);
  });
  it("2 detects architecture decisions only from explicit ADR evidence", () => {
    expect(entities("keystone.core.ArchitectureDecision")).toHaveLength(1);
    expect(detected("adr")).toBe(true);
  });
  it("3 extracts OpenAPI endpoint and schema declarations", () => {
    expect(
      entities("keystone.core.Endpoint").some(
        (item) => item.properties?.httpMethod === "GET" && item.properties.path === "/users/{id}",
      ),
    ).toBe(true);
    expect(detected("openapi")).toBe(true);
  });
  it("4 extracts GraphQL types and fields", () => {
    expect(
      result.entities.some(
        (item) => item.properties?.contractKind === "graphql" && item.name === "User",
      ),
    ).toBe(true);
    expect(
      relations("keystone.core.HAS_FIELD").some(
        (item) => result.entities.find((entity) => entity.id === item.targetId)?.name === "id",
      ),
    ).toBe(true);
  });
  it("5 extracts JSON Schema and properties", () => {
    expect(
      result.entities.some(
        (item) => item.name === "active" && item.properties?.contractKind === "json-schema",
      ),
    ).toBe(true);
  });
  it("6 extracts SQL tables, columns, indexes, and foreign keys", () => {
    expect(entities("keystone.core.Table").length).toBeGreaterThanOrEqual(2);
    expect(entities("keystone.core.Column").length).toBeGreaterThanOrEqual(4);
    expect(entities("keystone.core.Index")).toHaveLength(1);
    expect(entities("keystone.core.ForeignKey").length).toBeGreaterThan(0);
  });
  it("7 extracts SQL migration alter operations", () => {
    expect(entities("keystone.core.Migration")).toHaveLength(1);
    expect(relations("keystone.core.ALTERS")).toHaveLength(1);
  });
  it("8 extracts explicit Prisma model and table mapping metadata", () => {
    const user = entities("keystone.core.OrmEntity").find(
      (item) => item.properties?.orm === "prisma",
    );
    expect(user?.properties?.tableName).toBe("users");
    expect(user?.properties?.mappingKind).toBe("explicit");
  });
  it("9 extracts a second ORM mapping from JPA annotations", () => {
    expect(
      entities("keystone.core.OrmEntity").some(
        (item) => item.properties?.orm === "jpa" && item.properties.tableName === "users",
      ),
    ).toBe(true);
  });
  it("10 structurally extracts Java class and imports", () => {
    expect(
      result.entities.some(
        (item) =>
          item.language === "java" && item.type === "keystone.core.Class" && item.name === "User",
      ),
    ).toBe(true);
    expect(
      result.relationships.some(
        (item) =>
          item.type === "keystone.core.IMPORTS" &&
          result.entities.find((entity) => entity.id === item.targetId)?.name === "java.util.List",
      ),
    ).toBe(true);
  });
  it("11 structurally extracts Python functions and imports", () => {
    expect(
      result.entities.some((item) => item.language === "python" && item.name === "helper"),
    ).toBe(true);
    expect(result.entities.some((item) => item.properties?.moduleSpecifier === "os")).toBe(true);
  });
  it("12 structurally extracts C# class and namespace", () => {
    expect(
      result.entities.some((item) => item.language === "csharp" && item.name === "Service"),
    ).toBe(true);
    expect(entities("keystone.core.Namespace").some((item) => item.name === "App")).toBe(true);
  });
  it("13 structurally extracts Go package and function", () => {
    expect(result.entities.some((item) => item.language === "go" && item.name === "Run")).toBe(
      true,
    );
    expect(detected("go")).toBe(true);
  });
  it("14 structurally extracts Rust struct and function", () => {
    expect(result.entities.some((item) => item.language === "rust" && item.name === "Item")).toBe(
      true,
    );
    expect(result.entities.some((item) => item.language === "rust" && item.name === "run")).toBe(
      true,
    );
  });
  it("15 reports metadata-only fallback without fake declarations", () => {
    expect(detected("unknown-structural")).toBe(true);
    expect(
      result.diagnostics.some(
        (item) => item.code === "missing-adapter" && item.relativePath === "src/unknown.foo",
      ),
    ).toBe(true);
  });
  it("16 extracts pytest and language test cases", () => {
    expect(detected("pytest")).toBe(true);
    expect(entities("keystone.core.TestCase").some((item) => item.name === "test_service")).toBe(
      true,
    );
  });
  it("17 extracts package.json dependencies and scripts", () => {
    expect(
      result.entities.some(
        (item) =>
          item.type === "keystone.core.Package" && item.properties?.packageManager === "npm",
      ),
    ).toBe(true);
    expect(result.entities.some((item) => item.properties?.scriptName === "build")).toBe(true);
  });
  it("18 extracts Maven dependencies and plugins", () => {
    expect(detected("maven")).toBe(true);
    expect(
      entities("keystone.core.Plugin").some((item) => item.name === "maven-compiler-plugin"),
    ).toBe(true);
  });
  it("19 extracts .NET project metadata", () => {
    expect(
      result.entities.some(
        (item) =>
          item.properties?.buildSystem === "msbuild" &&
          item.properties.targetFramework === "net8.0",
      ),
    ).toBe(true);
  });
  it("20 extracts Python package metadata", () => {
    expect(
      result.entities.some(
        (item) => item.name === "sample-python" && item.type === "keystone.core.Package",
      ),
    ).toBe(true);
  });
  it("21 extracts GitHub Actions workflow jobs and safe command signatures", () => {
    expect(detected("github-actions")).toBe(true);
    expect(entities("keystone.core.Job").some((item) => item.name === "build")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("API_TOKEN=not-persisted");
  });
  it("22 extracts a second CI provider", () => {
    expect(detected("gitlab-ci")).toBe(true);
    expect(result.adapterState.coverage.some((item) => item.technologyId === "gitlab-ci")).toBe(
      true,
    );
  });
  it("23 extracts Docker image, port, and environment key name", () => {
    expect(detected("docker")).toBe(true);
    expect(entities("keystone.core.ContainerImage").some((item) => item.name === "node:20")).toBe(
      true,
    );
    expect(entities("keystone.core.Port").some((item) => item.name === "3000")).toBe(true);
  });
  it("24 extracts Docker Compose services and relationships", () => {
    expect(detected("docker-compose")).toBe(true);
    expect(entities("keystone.core.Service").some((item) => item.name === "api")).toBe(true);
    expect(relations("keystone.core.DEPENDS_ON").length).toBeGreaterThan(0);
  });
  it("25 extracts Kubernetes resources", () => {
    expect(detected("kubernetes")).toBe(true);
    expect(
      result.entities.some(
        (item) => item.properties?.resourceKind === "Deployment" && item.name === "api",
      ),
    ).toBe(true);
  });
  it("26 extracts Terraform resources", () => {
    expect(detected("terraform")).toBe(true);
    expect(result.entities.some((item) => item.properties?.resourceType === "aws_s3_bucket")).toBe(
      true,
    );
  });
  it("27 extracts configuration keys without values", () => {
    expect(result.entities.some((item) => item.properties?.keyPath === "server.port")).toBe(true);
    expect(
      result.entities.find((item) => item.properties?.keyPath === "password")?.properties
        ?.configurationClass,
    ).toBe("sensitive-name-only");
    expect(JSON.stringify(result)).not.toContain("super-secret-value");
    expect(JSON.stringify(result)).not.toContain("token-value");
  });
  it("28 excludes generated files from deep ingestion", () => {
    const decision = new DefaultIgnorePolicy().decide("generated/client.java");
    expect(decision.included).toBe(false);
    expect(decision.generated).toBe(true);
  });
  it("29 classifies static assets as metadata-only", () => {
    const decision = new DefaultIgnorePolicy().decide("src/app.css");
    expect(decision.analysisLevel).toBe("metadata-only");
  });
  it("30 detects adapters from manifests", () => {
    expect(detected("maven")).toBe(true);
    expect(detected("msbuild")).toBe(true);
    expect(detected("python-packaging")).toBe(true);
  });
  it("31 detects frameworks from explicit imports", () => {
    expect(detected("flask")).toBe(true);
    expect(
      result.adapterState.detections.find((item) => item.technologyId === "flask")?.evidence[0]
        ?.kind,
    ).toBe("import");
  });
  it("32 records every adapter version for invalidation", () => {
    expect(result.adapterState.capabilities.every((item) => Boolean(item.version))).toBe(true);
    expect(
      result.adapterState.capabilities.some(
        (item) => item.adapterId === "keystone.adapter.contract",
      ),
    ).toBe(true);
  });
  it("33 maps OpenAPI operations to routes only by exact method and path", async () => {
    const linked = await routeLinkedResult();
    expect(
      linked.relationships.some(
        (item) =>
          item.type === "keystone.core.IMPLEMENTS_CONTRACT_OPERATION" &&
          item.confidence === 1 &&
          item.properties?.linkRule === "exact-http-method-path",
      ),
    ).toBe(true);
  });
  it("34 maps ORM models to SQL tables with explicit mapping confidence", () => {
    expect(
      relations("keystone.core.MAPS_TO").some(
        (item) => item.confidence === 1 && item.properties?.classification === "exact",
      ),
    ).toBe(true);
  });
  it("links migrations to an unambiguous explicit ORM mapping", async () => {
    const linked = await new UniversalAdapterEngine().analyze(
      request({
        "db/schema.sql": "CREATE TABLE users (id INTEGER);",
        "db/migrations/002.sql": "ALTER TABLE users ADD COLUMN name TEXT;",
        "schema.prisma": 'model User {\n id Int @id\n @@map("users")\n}',
      }),
      [],
      [],
    );
    expect(
      linked.relationships
        .filter((item) => item.type === "keystone.core.MIGRATES")
        .map((item) => ({ confidence: item.confidence, evidence: item.evidenceIds.length })),
    ).toContainEqual({ confidence: 1, evidence: 2 });
  });
  it("35 maps build scripts to CI steps by exact script key", () => {
    expect(
      relations("keystone.core.EXECUTES").some(
        (item) => item.properties?.linkRule === "exact-package-script-name",
      ),
    ).toBe(true);
  });
  it("36 diagnoses ambiguous cross-links instead of fabricating one", async () => {
    const ambiguous = await new UniversalAdapterEngine().analyze(
      request({
        "a.sql": "CREATE TABLE users (id INTEGER);",
        "b.sql": "CREATE TABLE users (id INTEGER);",
        "schema.prisma": "model User { id Int @id }",
      }),
      [],
      [],
    );
    expect(
      ambiguous.diagnostics.some((item) => item.code === "ambiguous-cross-link" && item.ambiguity),
    ).toBe(true);
  });
  it("37 serves bounded capability coverage queries", async () => {
    const query = new IntelligenceQueryService(
      {
        getSnapshot: () => undefined,
        isStorageAvailable: () => true,
        getLoadError: () => undefined,
        getAdapterState: () => result.adapterState,
      },
      { getState: runtimeState },
    );
    const coverage = await query.technologies({ limit: 3 });
    expect(coverage.items).toHaveLength(3);
    expect(coverage.nextCursor).toBe("3");
  });
  it("38 exposes generation-tagged technology UI contracts", async () => {
    const source = await readFile("src/ui/components/intelligence/TechnologyCoverage.tsx", "utf8");
    expect(source).toContain("intelligence/technologies");
    expect(source).toContain("capabilityLevel");
  });
  it("39 incrementally changes schema output while reusing unaffected adapter artifacts", async () => {
    const engine = new UniversalAdapterEngine();
    const first = await engine.analyze(
      request({
        "README.md": "# Stable",
        "schema.json": JSON.stringify({
          $schema: "x",
          title: "A",
          properties: { one: { type: "string" } },
        }),
      }),
      [],
      [],
    );
    const second = await engine.analyze(
      request(
        {
          "README.md": "# Stable",
          "schema.json": JSON.stringify({
            $schema: "x",
            title: "A",
            properties: { two: { type: "string" } },
          }),
        },
        2,
      ),
      [],
      [],
    );
    expect(first.entities.some((item) => item.name === "one")).toBe(true);
    expect(second.entities.some((item) => item.name === "two")).toBe(true);
    expect(
      second.adapterState.metrics.find(
        (item) => item.adapterId === "keystone.adapter.documentation",
      )?.cacheReused,
    ).toBe(1);
  });
  it("40 activates an adapter after a manifest appears", async () => {
    const engine = new UniversalAdapterEngine();
    const first = await engine.analyze(request({ "src/A.java": "class A {}" }), [], []);
    const second = await engine.analyze(
      request(
        { "src/A.java": "class A {}", "pom.xml": "<project><artifactId>x</artifactId></project>" },
        2,
      ),
      [],
      [],
    );
    expect(first.adapterState.detections.some((item) => item.technologyId === "maven")).toBe(false);
    expect(second.adapterState.detections.some((item) => item.technologyId === "maven")).toBe(true);
  });
  it("41 deactivates an adapter after a manifest disappears", async () => {
    const engine = new UniversalAdapterEngine();
    const next = await engine.analyze(request({ "src/A.java": "class A {}" }, 2), [], []);
    expect(next.adapterState.detections.some((item) => item.technologyId === "maven")).toBe(false);
  });
  it("42 introduces no external storage or server dependency", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies)).toEqual([
      "@xyflow/react", "fuse.js", "puppeteer", "react", "react-dom", "tree-sitter-go", "tree-sitter-java",
      "tree-sitter-javascript", "tree-sitter-python", "tree-sitter-rust",
      "tree-sitter-typescript", "web-tree-sitter", "zod",
    ]);
  });
  it("43 uses no LLM for adapter ingestion or selection", async () => {
    const source = await readFile(
      "src/core/intelligence/adapters/UniversalAdapterEngine.ts",
      "utf8",
    );
    expect(source).not.toMatch(/openai|anthropic|ollama|language model/i);
  });
  it("44 persists no secret values in adapter results", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("super-secret-value");
    expect(serialized).not.toContain("token-value");
    expect(serialized).not.toContain("not-persisted");
  });
  it("45 excludes dependency and build-output folders from deep parsing", () => {
    const policy = new DefaultIgnorePolicy();
    for (const path of [
      "node_modules/x/index.js",
      "vendor/x/a.py",
      "dist/app.js",
      "build/a.class",
      "target/debug/app",
    ])
      expect(policy.decide(path).included).toBe(false);
  });
  it("does not detect technologies from code samples embedded in TypeScript strings", async () => {
    const output = await new UniversalAdapterEngine().analyze(
      request({
        "tests/detector.test.ts":
          "import { describe, it } from 'vitest';\nconst samples = `from flask import Flask\\nimport pytest\\n@SpringBootApplication\\nimport { Entity } from 'typeorm';\\ndescribe('mocha', () => {});`;\ndescribe('detector', () => it('works', () => samples));",
      }),
      [],
      [],
    );
    const technologies = output.adapterState.detections.map((item) => item.technologyId);
    expect(technologies).toContain("vitest");
    expect(technologies).not.toEqual(
      expect.arrayContaining(["flask", "pytest", "spring", "typeorm", "mocha", "playwright"]),
    );
  });
  it("hydrates an unchanged adapter cache in a fresh engine", async () => {
    const input = request({
      "README.md": "# Stable",
      "schema.json": JSON.stringify({ $schema: "x", title: "A" }),
    });
    const first = await new UniversalAdapterEngine().analyze(input, [], []);
    const seed = adapterSeed(first, input, "keystone.adapter.documentation");
    const second = await new UniversalAdapterEngine().analyze(
      { ...input, generation: 2, jobRevision: 2, adapterCacheSeeds: [seed] },
      [],
      [],
    );
    expect(
      second.adapterState.metrics.find((item) => item.adapterId === seed.adapterId)?.cacheReused,
    ).toBe(1);
    expect(
      second.entities
        .filter((item) =>
          item.evidenceIds.some(
            (id) =>
              second.evidence.find((evidence) => evidence.id === id)?.extractorId ===
              seed.adapterId,
          ),
        )
        .map((item) => item.name),
    ).toEqual(
      first.entities
        .filter((item) =>
          item.evidenceIds.some(
            (id) =>
              first.evidence.find((evidence) => evidence.id === id)?.extractorId === seed.adapterId,
          ),
        )
        .map((item) => item.name),
    );
  });
  it("rejects hydrated adapter cache entries after a version or source-hash change", async () => {
    const input = request({ "README.md": "# Stable" });
    const first = await new UniversalAdapterEngine().analyze(input, [], []);
    const seed = adapterSeed(first, input, "keystone.adapter.documentation");
    const versionMiss = await new UniversalAdapterEngine().analyze(
      {
        ...input,
        generation: 2,
        jobRevision: 2,
        adapterCacheSeeds: [{ ...seed, adapterVersion: "0.0.0" }],
      },
      [],
      [],
    );
    expect(
      versionMiss.adapterState.metrics.find((item) => item.adapterId === seed.adapterId)
        ?.cacheReused,
    ).toBe(0);
    const changed = request({ "README.md": "# Changed" }, 2);
    const hashMiss = await new UniversalAdapterEngine().analyze(
      { ...changed, adapterCacheSeeds: [seed] },
      [],
      [],
    );
    expect(
      hashMiss.adapterState.metrics.find((item) => item.adapterId === seed.adapterId)?.cacheReused,
    ).toBe(0);
  });
  it.each([
    ["c", "src/tool.c", "int execute(void) { return 0; }", "execute"],
    ["cpp", "src/tool.cpp", "class Runner {}; int execute() { return 0; }", "Runner"],
    ["ruby", "lib/tool.rb", "require 'json'\ndef execute()\nend", "execute"],
    ["php", "src/Tool.php", "<?php class Tool { public function execute() {} }", "Tool"],
    ["kotlin", "src/Tool.kt", "package app\nclass Tool { fun execute() {} }", "Tool"],
    ["swift", "src/Tool.swift", "import Foundation\nclass Tool { func execute() {} }", "Tool"],
    ["shell", "scripts/tool.sh", "execute() { echo ok; }", "execute"],
  ])(
    "structurally supports the required %s language tier",
    async (technology, path, content, declaration) => {
      const output = await new UniversalAdapterEngine().analyze(
        request({ [path]: content }),
        [],
        [],
      );
      expect(
        output.adapterState.detections.some(
          (item) => item.technologyId === technology && item.capabilityLevel === "structural",
        ),
      ).toBe(true);
      expect(output.entities.some((item) => item.name === declaration)).toBe(true);
    },
  );
});

function request(contents: Record<string, string>, generation = 1): SemanticProjectRequest {
  return {
    repositoryId: "repository:test",
    projectKey: "universal-test",
    generation,
    jobRevision: generation,
    reset: true,
    changedFiles: Object.entries(contents).map(([path, content], index) =>
      file(path, content, index),
    ),
    removedPaths: [],
  };
}
function file(relativePath: string, content: string, index: number): SemanticSourceFileInput {
  return {
    uri: `file:///fixture/${relativePath}`,
    relativePath,
    workspaceRootId: "root:test",
    fileId: `file:${index}:${relativePath}`,
    language: language(relativePath),
    category: category(relativePath),
    contentHash: createHash("sha256").update(content).digest("hex"),
    content,
  };
}
function language(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    (
      {
        ts: "typescript",
        tsx: "typescriptreact",
        js: "javascript",
        jsx: "javascriptreact",
        c: "c",
        cpp: "cpp",
        java: "java",
        py: "python",
        cs: "csharp",
        go: "go",
        rs: "rust",
        rb: "ruby",
        php: "php",
        kt: "kotlin",
        swift: "swift",
        sh: "shell",
        sql: "sql",
        prisma: "prisma",
        md: "markdown",
        graphql: "graphql",
        proto: "protobuf",
        tf: "terraform",
        yaml: "yaml",
        yml: "yaml",
        json: "json",
        xml: "xml",
        toml: "toml",
      } as Record<string, string>
    )[extension ?? ""] ?? "unknown"
  );
}
function category(path: string): SemanticSourceFileInput["category"] {
  if (/migrations?\//.test(path)) return "migration";
  if (/docs\//.test(path) || /\.md$/.test(path)) return "documentation";
  if (/\.sql$|\.prisma$|openapi|graphql|schema\.json|\.proto$|\.avsc$/.test(path)) return "schema";
  if (/github|gitlab/.test(path)) return "ci";
  if (/Dockerfile|compose|k8s|\.tf$/.test(path)) return "infrastructure";
  if (/package\.json|pom\.xml|csproj|pyproject/.test(path)) return "manifest";
  if (/tests?\//.test(path)) return "test";
  if (/config/.test(path)) return "configuration";
  return "source";
}
function runtimeState() {
  return {
    status: "ready" as const,
    phase: "ready" as const,
    pendingUpdate: false,
    scanRevision: 1,
    queueDepth: 0,
    activeWorkers: 0,
    workerCapacity: 1,
    pendingFiles: 0,
    completedJobs: 0,
    failedJobs: 0,
    staleResultsDiscarded: 0,
    workerRestarts: 0,
    throughputFilesPerSecond: 0,
    currentFiles: [],
    health: "healthy" as const,
  };
}
async function routeLinkedResult(): Promise<UniversalAnalysisResult> {
  const input = request({
    "api/openapi.yaml": CONTENT["api/openapi.yaml"]!,
    "src/routes.ts": "router.get('/users/:id', getUser);",
  });
  const routeFile = input.changedFiles[1]!;
  const range = { startLine: 0, startColumn: 0, endLine: 0, endColumn: 10 };
  const handler: IntelligenceSymbolRecord = {
    id: "handler",
    repositoryId: input.repositoryId,
    fileId: routeFile.fileId,
    ownerFileId: routeFile.fileId,
    type: "keystone.core.Function",
    name: "getUser",
    qualifiedName: "getUser",
    language: "typescript",
    range,
    evidenceIds: ["handler-evidence"],
    confidence: 1,
    generation: 1,
  };
  const route: IntelligenceSymbolRecord = {
    ...handler,
    id: "route",
    type: "keystone.core.Route",
    name: "GET /users/:id",
    qualifiedName: "GET /users/:id",
    evidenceIds: ["route-evidence"],
  };
  const relation: IntelligenceRelationshipRecord = {
    id: "route-handler",
    repositoryId: input.repositoryId,
    sourceId: route.id,
    targetId: handler.id,
    type: "keystone.core.ROUTES_TO",
    ownerFileId: routeFile.fileId,
    targetFileId: routeFile.fileId,
    resolution: "framework",
    properties: { method: "GET", path: "/users/:id" },
    evidenceIds: ["route-relation-evidence"],
    derivation: "framework-rule",
    confidence: 1,
    generation: 1,
  };
  return new UniversalAdapterEngine().analyze(input, [handler, route], [relation]);
}
function adapterSeed(
  result: UniversalAnalysisResult,
  input: SemanticProjectRequest,
  adapterId: string,
): AdapterOutput {
  const capability = result.adapterState.capabilities.find((item) => item.adapterId === adapterId)!;
  const detections = result.adapterState.detections.filter((item) => item.adapterId === adapterId);
  const ids = new Set(detections.flatMap((item) => item.fileIds));
  const evidence = result.evidence.filter((item) => item.extractorId === adapterId);
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const entities = result.entities.filter((item) =>
    item.evidenceIds.some((id) => evidenceIds.has(id)),
  );
  const relationships = result.relationships.filter((item) =>
    item.evidenceIds.some((id) => evidenceIds.has(id)),
  );
  return {
    adapterId,
    adapterVersion: capability.version,
    sourceContentHashes: Object.fromEntries(
      input.changedFiles
        .filter((item) => ids.has(item.fileId))
        .map((item) => [item.fileId, item.contentHash]),
    ),
    jobRevision: input.jobRevision,
    generationCompatibility: input.generation,
    detections,
    entities,
    relationships,
    evidence,
    diagnostics: result.diagnostics.filter((item) => item.adapterId === adapterId),
    exclusions: [],
    invalidations: [...ids],
    indexUpdates: [],
    okfProjectionHints: [],
    metrics: result.adapterState.metrics.find((item) => item.adapterId === adapterId)!,
  };
}
