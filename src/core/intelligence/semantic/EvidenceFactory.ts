import type {
  IntelligenceEvidenceRecord,
  SourceRange,
} from "../../../shared/contracts/intelligence";
import { IntelligenceIdFactory } from "./IntelligenceIdFactory";

export interface EvidenceInput {
  subjectId: string;
  ownerFileId: string;
  workspaceRootId: string;
  relativePath: string;
  range?: SourceRange;
  sourceKind: IntelligenceEvidenceRecord["sourceKind"];
  extractorId: string;
  extractorVersion: string;
  derivation: IntelligenceEvidenceRecord["derivation"];
  contentHash?: string;
  branch?: string;
  commit?: string;
  generation: number;
  confidence: number;
  statement: string;
}

export class EvidenceFactory {
  constructor(private readonly ids = new IntelligenceIdFactory()) {}

  create(input: EvidenceInput): IntelligenceEvidenceRecord {
    const rangeKey = input.range
      ? `${input.range.startLine}:${input.range.startColumn}:${input.range.endLine}:${input.range.endColumn}`
      : "file";
    return {
      id: this.ids.create(
        "evidence",
        input.subjectId,
        input.ownerFileId,
        rangeKey,
        input.extractorId,
        input.extractorVersion,
        input.contentHash,
      ),
      subjectId: input.subjectId,
      ownerFileId: input.ownerFileId,
      workspaceRootId: input.workspaceRootId,
      relativePath: input.relativePath,
      ...(input.range ? { range: input.range } : {}),
      sourceKind: input.sourceKind,
      extractorId: input.extractorId,
      extractorVersion: input.extractorVersion,
      derivation: input.derivation,
      ...(input.contentHash ? { contentHash: input.contentHash } : {}),
      ...(input.branch ? { branch: input.branch } : {}),
      ...(input.commit ? { commit: input.commit } : {}),
      generation: input.generation,
      confidence: input.confidence,
      statement: input.statement,
    };
  }
}
