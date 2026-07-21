import { createHash } from "node:crypto";
import type {
  IntelligenceEvidenceRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
  SourceRange,
} from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import type { AdapterContext } from "./IntelligenceAdapter";

export class AdapterEvidenceFactory {
  constructor(
    readonly adapterId: string,
    readonly adapterVersion: string,
    readonly context: AdapterContext,
  ) {}

  entity(
    file: SemanticSourceFileInput,
    type: string,
    name: string,
    qualifiedName: string,
    range: SourceRange,
    properties?: IntelligenceSymbolRecord["properties"],
    confidence = 1,
  ): { entity: IntelligenceSymbolRecord; evidence: IntelligenceEvidenceRecord } {
    const id = adapterId(
      "entity",
      this.context.repositoryId,
      file.fileId,
      this.adapterId,
      type,
      qualifiedName,
    );
    const evidenceId = adapterId(
      "evidence",
      id,
      file.contentHash,
      range.startLine,
      range.startColumn,
      this.adapterVersion,
    );
    return {
      entity: {
        id,
        repositoryId: this.context.repositoryId,
        fileId: file.fileId,
        ownerFileId: file.fileId,
        type,
        name,
        qualifiedName,
        language: file.language,
        range,
        ...(properties ? { properties } : {}),
        evidenceIds: [evidenceId],
        confidence,
        generation: this.context.generation,
      },
      evidence: this.evidence(
        evidenceId,
        id,
        file,
        range,
        `The ${this.adapterId} adapter extracted ${qualifiedName}.`,
        confidence,
      ),
    };
  }

  relationship(
    source: IntelligenceSymbolRecord,
    target: IntelligenceSymbolRecord,
    type: string,
    owner: SemanticSourceFileInput,
    range: SourceRange,
    options: {
      confidence?: number;
      derivation?: IntelligenceRelationshipRecord["derivation"];
      resolution?: IntelligenceRelationshipRecord["resolution"];
      properties?: IntelligenceRelationshipRecord["properties"];
      secondary?: SemanticSourceFileInput;
    } = {},
  ): { relationship: IntelligenceRelationshipRecord; evidence: IntelligenceEvidenceRecord[] } {
    const id = adapterId(
      "relationship",
      this.context.repositoryId,
      source.id,
      target.id,
      type,
      owner.fileId,
      range.startLine,
      range.startColumn,
    );
    const primaryId = adapterId(
      "evidence",
      id,
      owner.fileId,
      owner.contentHash,
      range.startLine,
      range.startColumn,
    );
    const evidence = [
      this.evidence(
        primaryId,
        id,
        owner,
        range,
        `${source.qualifiedName} ${type} ${target.qualifiedName}.`,
        options.confidence ?? 1,
      ),
    ];
    if (options.secondary && options.secondary.fileId !== owner.fileId) {
      const secondaryId = adapterId(
        "evidence",
        id,
        options.secondary.fileId,
        options.secondary.contentHash,
        "target",
      );
      evidence.push({
        ...this.evidence(
          secondaryId,
          id,
          options.secondary,
          wholeRange(options.secondary.content),
          `The target side of ${type} is declared here.`,
          options.confidence ?? 1,
        ),
        ownerFileId: owner.fileId,
      });
    }
    return {
      relationship: {
        id,
        repositoryId: this.context.repositoryId,
        sourceId: source.id,
        targetId: target.id,
        type,
        ownerFileId: owner.fileId,
        targetFileId: target.fileId,
        resolution: options.resolution ?? "exact",
        ...(options.properties ? { properties: options.properties } : {}),
        evidenceIds: evidence.map((item) => item.id),
        derivation: options.derivation ?? "extracted",
        confidence: options.confidence ?? 1,
        generation: this.context.generation,
      },
      evidence,
    };
  }

  evidence(
    id: string,
    subjectId: string,
    file: SemanticSourceFileInput,
    range: SourceRange,
    statement: string,
    confidence: number,
  ): IntelligenceEvidenceRecord {
    return {
      id,
      subjectId,
      ownerFileId: file.fileId,
      sourceKind: sourceKind(this.adapterId),
      workspaceRootId: file.workspaceRootId,
      relativePath: file.relativePath,
      range,
      extractorId: this.adapterId,
      extractorVersion: this.adapterVersion,
      derivation: "extracted",
      contentHash: file.contentHash,
      ...(this.context.branch ? { branch: this.context.branch } : {}),
      ...(this.context.commit ? { commit: this.context.commit } : {}),
      generation: this.context.generation,
      confidence,
      statement,
    };
  }
}

export function adapterId(...parts: unknown[]): string {
  return `adapter:${createHash("sha256").update(parts.map(stablePart).join("\u001f")).digest("hex").slice(0, 32)}`;
}

function stablePart(value: unknown): string {
  if (value === null || value === undefined) return "";
  switch (typeof value) {
    case "string":
      return value;
    case "number":
    case "boolean":
    case "bigint":
      return String(value);
    default:
      return JSON.stringify(value);
  }
}

export function rangeAt(content: string, start: number, end = start): SourceRange {
  const before = content.slice(0, start);
  const selected = content.slice(start, end);
  const startLines = before.split("\n");
  const endLines = selected.split("\n");
  return {
    startLine: startLines.length - 1,
    startColumn: startLines.at(-1)?.length ?? 0,
    endLine: startLines.length + endLines.length - 2,
    endColumn:
      endLines.length === 1
        ? (startLines.at(-1)?.length ?? 0) + selected.length
        : (endLines.at(-1)?.length ?? 0),
  };
}

export function wholeRange(content: string): SourceRange {
  return rangeAt(content, 0, content.length);
}
export function safePropertyName(value: string): string {
  return value.replace(/["'`]/g, "").trim().slice(0, 200);
}

function sourceKind(adapter: string): IntelligenceEvidenceRecord["sourceKind"] {
  if (adapter.includes("documentation")) return "documentation";
  if (adapter.includes("contract")) return "schema";
  if (adapter.includes("database") || adapter.includes("orm")) return "database";
  if (adapter.includes("ci")) return "ci";
  if (adapter.includes("infrastructure")) return "infrastructure";
  if (adapter.includes("configuration")) return "configuration";
  if (adapter.includes("build") || adapter.includes("package")) return "manifest";
  return "adapter";
}
