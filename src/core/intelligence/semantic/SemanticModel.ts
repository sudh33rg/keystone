import type {
  FileContribution,
  IntelligenceDiagnostic,
  IntelligenceEvidenceRecord,
  IntelligenceFileRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord
} from "../../../shared/contracts/intelligence";
import type { CpgDelta } from "../../../shared/contracts/cpg";
import type { AdapterOutput, AdapterRegistryState } from "../../../shared/contracts/adapters";

export interface SemanticSourceFileInput {
  uri: string;
  relativePath: string;
  workspaceRootId: string;
  fileId: string;
  language: string;
  category: IntelligenceFileRecord["category"];
  contentHash: string;
  content: string;
}

export interface SemanticProjectRequest {
  repositoryId: string;
  projectKey: string;
  generation: number;
  jobRevision: number;
  reset: boolean;
  branch?: string;
  commit?: string;
  changedFiles: SemanticSourceFileInput[];
  removedPaths: string[];
  adapterCacheSeeds?: AdapterOutput[];
}

export interface SemanticProjectResult {
  repositoryId: string;
  generation: number;
  jobRevision: number;
  parserId: string;
  parserVersion: string;
  sourceHashes: Record<string, string>;
  fileUpdates: Array<Pick<IntelligenceFileRecord, "id" | "structuralHash" | "parserId" | "parserVersion" | "packageId" | "moduleId" | "sourceRoot" | "exported" | "isTest" | "parseStatus" | "shardReferences">>;
  entities: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  evidence: IntelligenceEvidenceRecord[];
  diagnostics: IntelligenceDiagnostic[];
  contributions: FileContribution[];
  adapterState?: AdapterRegistryState;
  cpg?: CpgDelta;
}

export interface SemanticParser {
  readonly id: string;
  readonly version: string;
  supports(language: string): boolean;
  extract(request: SemanticProjectRequest): Promise<SemanticProjectResult>;
}
