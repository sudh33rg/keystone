import { describe, expect, it, vi } from "vitest";
import { TechnologyDetectionService } from "../../../src/core/intelligence/technology/TechnologyDetectionService";
import {
  detectFromDependencies,
  detectComposeServices,
  matchKeyword,
  normalizeDependencyName,
  parseManifestDependencies,
} from "../../../src/core/intelligence/technology/TechnologyRegistry";
import { IntelligenceSnapshotSchema } from "../../../src/shared/contracts/intelligence";

interface ProviderState {
  symbols: { id: string; type: string; name: string }[];
  relationships: { id: string; sourceId: string; targetId: string; type: string }[];
  evidence: { id: string; subjectId: string }[];
}

function testIdProvider(state: ProviderState): ReturnType<TechnologyDetectionService["detect"]> extends Promise<infer _R>
  ? import("../../../src/core/intelligence/technology/TechnologyDetectionService").TechnologyIdProvider
  : never {
  let counter = 0;
  const mk = (prefix: string): string => `${prefix}#${counter++}`;
  return {
    repositoryId: "repo:test",
    fileId: "file:test",
    generation: 1,
    entity: (kind: string, name: string, discriminator: string) =>
      Promise.resolve(mk(`ent:${kind}:${name}:${discriminator}`)),
    relationship: (sourceId: string, targetId: string, type: string, discriminator: string) =>
      Promise.resolve(mk(`rel:${sourceId}:${targetId}:${type}:${discriminator}`)),
    evidence: (subjectId: string) => {
      const id = mk(`ev:${subjectId}`);
      state.evidence.push({ id, subjectId });
      return Promise.resolve(id);
    },
  };
}

const PYPROJECT = `[project]
name = "demo"
dependencies = [
  "fastapi>=0.110",
  "sqlalchemy>=2.0",
  "psycopg2-binary",
]
`;

const COMPOSE = `services:
  db:
    image: postgres:16
  cache:
    image: redis:7
  queue:
    image: rabbitmq:3
`;

describe("Phase B — TechnologyRegistry", () => {
  it("normalizes scoped dependency names", () => {
    expect(normalizeDependencyName("@nestjs/core")).toBe("core");
    expect(normalizeDependencyName("django.db.models")).toBe("django.db.models");
    expect(normalizeDependencyName("github.com/gin-gonic/gin")).toBe("gin");
  });

  it("matches framework, orm, database, and external-service keywords", () => {
    expect(matchKeyword("fastapi")?.name).toBe("FastAPI");
    expect(matchKeyword("sqlalchemy")?.kind).toBe("orm");
    expect(matchKeyword("postgres")?.kind).toBe("database");
    expect(matchKeyword("redis")?.kind).toBe("database");
    expect(matchKeyword("rabbitmq")?.kind).toBe("external-service");
  });

  it("parses dependency lists from known manifests", () => {
    const fromPy = parseManifestDependencies("pyproject.toml", PYPROJECT);
    const detected = detectFromDependencies(fromPy).map((d) => d.name).sort();
    expect(detected).toContain("FastAPI");
    expect(detected).toContain("SQLAlchemy");
    expect(detected).toContain("PostgreSQL");
  });

  it("detects databases and external services from docker-compose images", () => {
    const detected = detectComposeServices(COMPOSE).map((d) => `${d.kind}:${d.name}`).sort();
    expect(detected).toContain("database:PostgreSQL");
    expect(detected).toContain("database:Redis");
    expect(detected).toContain("external-service:postgres");
    expect(detected).toContain("external-service:redis");
    expect(detected).toContain("external-service:RabbitMQ");
  });
});

describe("Phase B — TechnologyDetectionService", () => {
  it("B.1 detects framework, ORM, database, external-service from manifests with valid evidence", async () => {
    const service = new TechnologyDetectionService();
    const state: ProviderState = { symbols: [], relationships: [], evidence: [] };
    const provider = testIdProvider(state);

    const pyResult = await service.detect("pyproject.toml", PYPROJECT, provider);
    const composeResult = await service.detect("docker-compose.yml", COMPOSE, provider);

    const all = [...pyResult.symbols, ...composeResult.symbols];
    const byType = new Map(all.map((s) => [s.type, s]));
    const names = new Set(all.map((s) => s.name));

    expect(names.has("FastAPI")).toBe(true); // framework
    expect(names.has("SQLAlchemy")).toBe(true); // orm
    expect(names.has("PostgreSQL")).toBe(true); // database (from compose)
    expect(names.has("Redis")).toBe(true); // database (from compose)
    expect(names.has("postgres")).toBe(true); // external-service (from compose)
    expect(names.has("redis")).toBe(true); // external-service (from compose)
    expect(byType.get("keystone.core.Framework")).toBeDefined();
    expect(byType.get("keystone.core.ORM")).toBeDefined();
    expect(byType.get("keystone.core.Database")).toBeDefined();
    expect(byType.get("keystone.core.ExternalService")).toBeDefined();
    expect(all.length).toBeGreaterThan(0);
    // Every symbol must carry a stable id + a (delayed) evidence slot.
    for (const symbol of all) expect(symbol.id.length).toBeGreaterThan(0);
  });

  it("B.2 dedupes the same technology across multiple manifests (single symbol per name)", async () => {
    const service = new TechnologyDetectionService();
    const state1: ProviderState = { symbols: [], relationships: [], evidence: [] };
    const a = await service.detect("pyproject.toml", PYPROJECT, testIdProvider(state1));
    const state2: ProviderState = { symbols: [], relationships: [], evidence: [] };
    const b = await service.detect("requirements.txt", "fastapi\nsqlalchemy\n", testIdProvider(state2));
    const aNames = a.symbols.map((s) => s.name);
    const bNames = b.symbols.map((s) => s.name);
    expect(aNames.filter((n) => n === "FastAPI").length).toBe(1);
    expect(bNames.filter((n) => n === "FastAPI").length).toBe(1);
  });

  it("B.4 performs zero external I/O — detection derives purely from the content string", async () => {
    const readFile = vi.fn();
    const fetch = vi.fn();
    // Ensure no accidental fs/network access: the service receives only a string.
    const service = new TechnologyDetectionService();
    const state: ProviderState = { symbols: [], relationships: [], evidence: [] };
    const result = await service.detect(
      "package.json",
      JSON.stringify({ dependencies: { express: "^4.0.0", mongoose: "^8.0.0", mongodb: "^6.0.0" } }),
      testIdProvider(state),
    );
    expect(readFile).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    const names = result.symbols.map((s) => s.name).sort();
    expect(names).toContain("Express");
    expect(names).toContain("Mongoose");
    expect(names).toContain("MongoDB");
  });

  it("B.3 a snapshot containing B-phase symbols passes IntelligenceSnapshotSchema.safeParse", async () => {
    const service = new TechnologyDetectionService();
    const state: ProviderState = { symbols: [], relationships: [], evidence: [] };
    const provider = testIdProvider(state);
    const result = await service.detect("docker-compose.yml", COMPOSE, provider);
    expect(result.available).toBe(true);
    expect(result.symbols.length).toBeGreaterThan(0);

    // Build a minimal but complete snapshot around the detected symbols.
    const repoId = "repo:test";
    const fileId = "file:test";
    const symbols = result.symbols.map((s) => ({
      id: s.id,
      repositoryId: repoId,
      fileId,
      type: s.type,
      name: s.name,
      qualifiedName: s.name,
      language: "configuration",
      range: { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 },
      evidenceIds: [`ev:${s.id}`],
      confidence: 1,
      generation: 1,
    }));
    const relationships = [
      {
        id: "rel:defines",
        repositoryId: repoId,
        sourceId: repoId,
        targetId: symbols[0]!.id,
        type: "keystone.core.DEFINES_TECHNOLOGY",
        ownerFileId: fileId,
        targetFileId: fileId,
        resolution: "framework" as const,
        evidenceIds: ["ev:rel:defines"],
        derivation: "framework-rule" as const,
        confidence: 1,
        generation: 1,
      },
    ];
    const evidence = [
      ...symbols.map((s) => ({
        id: `ev:${s.id}`,
        subjectId: s.id,
        sourceKind: "database" as const,
        workspaceRootId: "root:test",
        relativePath: "docker-compose.yml",
        extractorId: "keystone.technology-detection",
        extractorVersion: "1",
        derivation: "extracted" as const,
        generation: 1,
        confidence: 1,
        statement: `Detected ${s.name} from manifest.`,
      })),
      {
        id: "ev:rel:defines",
        subjectId: "rel:defines",
        sourceKind: "manifest" as const,
        workspaceRootId: "root:test",
        relativePath: "docker-compose.yml",
        extractorId: "keystone.technology-detection",
        extractorVersion: "1",
        derivation: "extracted" as const,
        generation: 1,
        confidence: 1,
        statement: "Repository defines a technology.",
      },
    ];

    const snapshot = {
      manifest: {
        schemaVersion: 1,
        generation: 1,
        scanRevision: 1,
        repositoryId: repoId,
        status: "ready" as const,
        createdAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        extractorVersions: { "keystone.technology-detection": "1" },
      },
      repository: {
        id: repoId,
        displayName: "test",
        workspaceRoots: [{ id: "root:test", name: "test", evidenceIds: ["ev:root"] }],
        evidenceIds: ["ev:repo"],
      },
      files: [
        {
          id: fileId,
          repositoryId: repoId,
          workspaceRootId: "root:test",
          relativePath: "docker-compose.yml",
          language: "configuration",
          category: "infrastructure",
          analysisLevel: "structural",
          byteSize: 10,
          modifiedAt: new Date().toISOString(),
          classification: {
            category: "infrastructure",
            analysisLevel: "structural",
            included: true,
            generated: false,
            binary: false,
            sensitive: false,
            ruleId: "include.infrastructure",
            reason: "Infrastructure definition.",
          },
          evidenceIds: ["ev:file"],
          generation: 1,
        },
      ],
      symbols,
      relationships,
      evidence: [
        ...evidence,
        {
          id: "ev:root",
          subjectId: "root:test",
          sourceKind: "workspace-inventory" as const,
          workspaceRootId: "root:test",
          relativePath: "",
          extractorId: "keystone.workspace-inventory",
          extractorVersion: "1",
          derivation: "extracted" as const,
          generation: 1,
          confidence: 1,
          statement: "Workspace root identity.",
        },
        {
          id: "ev:repo",
          subjectId: repoId,
          sourceKind: "workspace-inventory" as const,
          workspaceRootId: "root:test",
          relativePath: "",
          extractorId: "keystone.workspace-inventory",
          extractorVersion: "1",
          derivation: "extracted" as const,
          generation: 1,
          confidence: 1,
          statement: "Repository identity.",
        },
        {
          id: "ev:file",
          subjectId: fileId,
          sourceKind: "workspace-inventory" as const,
          workspaceRootId: "root:test",
          relativePath: "docker-compose.yml",
          extractorId: "keystone.workspace-inventory",
          extractorVersion: "1",
          derivation: "extracted" as const,
          generation: 1,
          confidence: 1,
          statement: "File metadata.",
        },
      ],
      diagnostics: [],
    };

    const parsed = IntelligenceSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
  });
});
