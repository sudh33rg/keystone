import { INTELLIGENCE_FILE } from "../../platform/config/defaults";
import { JsonStorage } from "../../platform/storage/jsonStorage";
import type { RepoIntelligence } from "../../domain/types";

export class IntelligenceStore extends JsonStorage<RepoIntelligence> {
  constructor(workspaceRoot: string) {
    super(workspaceRoot, INTELLIGENCE_FILE, {
      workspaceRoot,
      indexedAt: "",
      files: [],
      symbols: [],
      dependencies: [],
      tests: [],
      apis: [],
      services: [],
      calls: [],
      controlFlows: [],
      dataFlows: [],
      typeRelationships: [],
      engineeringEntities: [],
      ownershipHints: [],
      frameworkHints: [],
      securitySensitiveAreas: [],
      performanceSensitivePaths: [],
      modernizationCandidates: []
    });
  }
}
