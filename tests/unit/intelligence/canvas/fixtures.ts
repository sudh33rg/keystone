import type { IntelligenceSnapshot } from "../../../../src/shared/contracts/intelligence";
import { intelligenceSnapshot } from "../fixtures";

export function canvasSnapshot(): IntelligenceSnapshot {
  const snapshot = intelligenceSnapshot(7); snapshot.symbols = [
    symbol("entity:route:orders", "POST /orders", "POST /orders", "keystone.core.Route", "file:src/orders.ts", 1),
    symbol("entity:orders:create", "create", "OrderService.create", "keystone.core.Method", "file:src/orders.ts", 10),
    symbol("entity:users:create", "create", "UserService.create", "keystone.core.Method", "file:src/users.ts", 5),
    symbol("entity:repo:save", "save", "OrderRepository.save", "keystone.core.Method", "file:src/repository.ts", 20),
    symbol("entity:test:create", "creates order", "OrderServiceTest.creates order", "keystone.core.TestCase", "file:tests/orders.test.ts", 7),
  ];
  snapshot.files = [file("file:src/orders.ts", "src/orders.ts", false), file("file:src/users.ts", "src/users.ts", false), file("file:src/repository.ts", "src/repository.ts", false), file("file:tests/orders.test.ts", "tests/orders.test.ts", true)];
  snapshot.relationships = [
    relationship("relationship:route-create", "entity:route:orders", "entity:orders:create", "keystone.core.ROUTES_TO", "evidence:route-create"),
    relationship("relationship:create-save", "entity:orders:create", "entity:repo:save", "keystone.core.CALLS", "evidence:create-save"),
    relationship("relationship:orders-import", "file:src/orders.ts", "file:src/repository.ts", "keystone.core.IMPORTS", "evidence:orders-import"),
    relationship("relationship:test-create", "entity:test:create", "entity:orders:create", "keystone.core.TESTS", "evidence:test-create"),
  ];
  snapshot.evidence = snapshot.relationships.map((rel) => ({ id: rel.evidenceIds[0]!, subjectId: rel.id, sourceKind: "source-file" as const, workspaceRootId: "workspace-root:fixture", relativePath: rel.id.includes("test") ? "tests/orders.test.ts" : "src/orders.ts", range: { startLine: 1, startColumn: 0, endLine: 2, endColumn: 20 }, extractorId: "fixture-parser", extractorVersion: "1", derivation: "extracted" as const, generation: 7, confidence: 1, statement: `${rel.sourceId} ${rel.type} ${rel.targetId}` }));
  return snapshot;
}
function symbol(id: string, name: string, qualifiedName: string, type: string, fileId: string, line: number) { return { id, repositoryId: "repository:fixture", fileId, type, name, qualifiedName, language: "typescript", range: { startLine: line, startColumn: 0, endLine: line + 2, endColumn: 20 }, properties: {}, evidenceIds: [], confidence: 1, generation: 7 }; }
function file(id: string, relativePath: string, isTest: boolean) { return { id, repositoryId: "repository:fixture", workspaceRootId: "workspace-root:fixture", relativePath, language: "typescript", category: isTest ? "test" as const : "source" as const, analysisLevel: "deep" as const, byteSize: 100, modifiedAt: "2026-07-22T00:00:00.000Z", contentHash: id, classification: { category: isTest ? "test" as const : "source" as const, analysisLevel: "deep" as const, included: true, generated: false, binary: false, sensitive: false, ruleId: "fixture", reason: "Fixture" }, isTest, evidenceIds: [], generation: 7 }; }
function relationship(id: string, sourceId: string, targetId: string, type: string, evidenceId: string) { return { id, repositoryId: "repository:fixture", sourceId, targetId, type, evidenceIds: [evidenceId], derivation: "extracted" as const, resolution: "exact" as const, confidence: 1, generation: 7 }; }
