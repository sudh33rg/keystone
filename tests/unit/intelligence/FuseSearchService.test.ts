import { describe, expect, it } from "vitest";
import { FuseSearchService } from "../../../src/core/intelligence/query/FuseSearchService";
import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";

const SNAPSHOT: IntelligenceSnapshot = {
  symbols: [
    { id: "sym:1", type: "keystone.core.Package", name: "@org/keystone", qualifiedName: "@org/keystone", evidenceIds: [] },
    { id: "sym:2", type: "keystone.core.Module", name: "database.ts", qualifiedName: "src/db/database.ts", evidenceIds: [] },
    { id: "sym:3", type: "keystone.core.Table", name: "users", qualifiedName: "public.users", evidenceIds: [] },
    { id: "sym:4", type: "keystone.core.Route", name: "GET /users", qualifiedName: "GET /users", properties: { routePath: "/users", method: "GET" }, evidenceIds: [] },
    { id: "sym:5", type: "keystone.core.ExternalService", name: "redis", qualifiedName: "redis:6379", evidenceIds: [] },
    { id: "sym:python", type: "keystone.core.Module", name: "python", qualifiedName: "python", evidenceIds: [] },
  ],
  files: [
    { id: "file:1", relativePath: "src/db/database.ts", evidenceIds: [] },
    { id: "file:2", relativePath: "src/api/routes.ts", evidenceIds: [] },
  ],
  relationships: [],
  repository: { id: "repo:1" } as never,
  manifest: { status: "ok" as never, generation: 1, contentHash: "h", updatedAt: new Date().toISOString() },
  diagnostics: [],
} as unknown as IntelligenceSnapshot;

describe("QA — FuseSearchService", () => {
  const svc = new FuseSearchService(SNAPSHOT);

  it("D.1a searches by name substring (exact fallback)", () => {
    const ids = svc.search("users", { kind: "name" });
    expect(ids).toContain("sym:3");
    expect(ids.length).toBeGreaterThanOrEqual(1);
  });

  it("D.1a searches by qualifiedName substring", () => {
    const ids = svc.search("public.", { kind: "qualified-name" });
    expect(ids).toEqual(["sym:3"]);
  });

  it("D.1a type-filtered search returns only route symbols", () => {
    const ids = svc.search("/users", { kind: "name", entityTypes: ["route"] });
    expect(ids).toEqual(["sym:4"]);
  });

  it("D.1b typo-tolerant: 'pythn' resolves to python file", () => {
    const ids = svc.search("pythn", { kind: "name" });
    expect(ids).toEqual(["sym:python"]);
  });

  it("D.1b typo-tolerant: 'reddis' resolves", () => {
    const ids = svc.search("reddis", { kind: "name" });
    expect(ids).toEqual(["sym:5"]);
  });

  it("D.3 bounded limit", () => {
    const ids = svc.search("src", { kind: "name", limit: 1 });
    expect(ids.length).toBeLessThanOrEqual(1);
  });

  it("D.1a safeParse: all returned ids resolve", () => {
    const ids = svc.search("r", { kind: "name" });
    // Every returned id must match a symbol or file id.
    for (const id of ids) {
      const found =
        SNAPSHOT.symbols.some((s: any) => s.id === id) ||
        SNAPSHOT.files.some((f: any) => f.id === id);
      expect(found).toBe(true);
    }
  });
});
