import type { IntelligenceSnapshot } from "../../../src/shared/contracts/intelligence";

export function intelligenceSnapshot(generation = 1): IntelligenceSnapshot {
  const repositoryId = "repository:fixture";
  const rootId = "workspace-root:fixture";
  const fileId = "file:src/index.ts";
  const repositoryEvidenceId = "evidence:repository";
  const fileEvidenceId = "evidence:file";
  const relationshipId = "relationship:contains";
  const relationshipEvidenceId = "evidence:relationship";
  const rootEvidenceId = "evidence:root";
  const now = "2026-07-15T00:00:00.000Z";
  return {
    manifest: {
      schemaVersion: 1,
      generation,
      scanRevision: generation,
      repositoryId,
      status: "ready",
      createdAt: now,
      completedAt: now,
      extractorVersions: { "keystone.workspace-inventory": "1" },
    },
    repository: {
      id: repositoryId,
      displayName: "fixture",
      workspaceRoots: [{ id: rootId, name: "fixture", evidenceIds: [rootEvidenceId] }],
      branch: "main",
      evidenceIds: [repositoryEvidenceId],
    },
    files: [
      {
        id: fileId,
        repositoryId,
        workspaceRootId: rootId,
        relativePath: "src/index.ts",
        language: "typescript",
        category: "source",
        analysisLevel: "deep",
        byteSize: 12,
        modifiedAt: now,
        contentHash: "abc123",
        classification: {
          category: "source",
          analysisLevel: "deep",
          included: true,
          generated: false,
          binary: false,
          sensitive: false,
          ruleId: "include.source",
          reason: "Supported source file.",
        },
        evidenceIds: [fileEvidenceId],
        generation,
      },
    ],
    symbols: [],
    relationships: [
      {
        id: relationshipId,
        repositoryId,
        sourceId: repositoryId,
        targetId: fileId,
        type: "keystone.core.CONTAINS",
        evidenceIds: [relationshipEvidenceId],
        derivation: "extracted",
        confidence: 1,
        generation,
      },
    ],
    evidence: [
      {
        id: repositoryEvidenceId,
        subjectId: repositoryId,
        sourceKind: "workspace-inventory",
        workspaceRootId: rootId,
        relativePath: "",
        extractorId: "keystone.workspace-inventory",
        extractorVersion: "1",
        derivation: "extracted",
        generation,
        confidence: 1,
        statement: "Observed repository.",
      },
      {
        id: rootEvidenceId,
        subjectId: rootId,
        sourceKind: "workspace-inventory",
        workspaceRootId: rootId,
        relativePath: "",
        extractorId: "keystone.workspace-inventory",
        extractorVersion: "1",
        derivation: "extracted",
        generation,
        confidence: 1,
        statement: "Observed root.",
      },
      {
        id: fileEvidenceId,
        subjectId: fileId,
        sourceKind: "workspace-inventory",
        workspaceRootId: rootId,
        relativePath: "src/index.ts",
        extractorId: "keystone.workspace-inventory",
        extractorVersion: "1",
        derivation: "extracted",
        contentHash: "abc123",
        generation,
        confidence: 1,
        statement: "Observed file.",
      },
      {
        id: relationshipEvidenceId,
        subjectId: relationshipId,
        sourceKind: "workspace-inventory",
        workspaceRootId: rootId,
        relativePath: "src/index.ts",
        extractorId: "keystone.workspace-inventory",
        extractorVersion: "1",
        derivation: "extracted",
        contentHash: "abc123",
        generation,
        confidence: 1,
        statement: "Observed containment.",
      },
    ],
    diagnostics: [],
  };
}
