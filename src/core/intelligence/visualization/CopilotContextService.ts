/**
 * Copilot context grounding from the intelligence snapshot.
 *
 * Deterministic, no LLM. Given a bounded task seed, selects the
 * most relevant intelligence symbols — schema surfaces and
 * connected services / routes / callees — so delegated Copilot
 * tasks can include a grounded context pack.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  IntelligenceRelationshipRecord,
} from "../../../shared/contracts/intelligence";

export interface CopilotContextOptions {
  taskQuery: string;
  maxCandidates?: number;
}

export interface CopilotContextCandidate {
  symbolId: string;
  symbolType: string;
  name: string;
  relativePath?: string;
  relationship?: string;
  confidence: number;
}

export class CopilotContextService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  selectCandidates(options: CopilotContextOptions): CopilotContextCandidate[] {
    const maxCandidates = options.maxCandidates ?? 25;
    const taskQuery = options.taskQuery.trim().toLowerCase();
    if (!taskQuery) return [];

    const scored = this.snapshot.symbols
      .filter((symbol) => this.matchesTask(symbol, taskQuery))
      .map((symbol) => this.scoreSymbol(symbol, taskQuery));

    const withEvidence = scored
      .map((candidate) => ({
        ...candidate,
        relationship: this.bestRelationship(candidate.symbolId),
      }))
      .sort((a, b) => b.confidence - a.confidence || a.symbolId.localeCompare(b.symbolId));

    return withEvidence.slice(0, maxCandidates);
  }

  private scoreSymbol(
    symbol: IntelligenceSymbolRecord,
    taskQuery: string,
  ): CopilotContextCandidate {
    const name = symbol.name.toLowerCase();
    const qn = (symbol.qualifiedName ?? "").toLowerCase();
    let confidence = 0;
    if (qn.includes(taskQuery)) confidence += 0.8;
    else if (name.includes(taskQuery)) confidence += 0.6;

    const schemaBoost = new Set([
      "keystone.core.Table",
      "keystone.core.SchemaTable",
      "keystone.core.SchemaColumn",
      "keystone.core.SchemaForeignKey",
      "keystone.core.Entity",
      "keystone.core.Route",
      "keystone.core.ExternalService",
      "keystone.core.Database",
    ]);
    if (schemaBoost.has(symbol.type)) confidence += 0.1;

    return {
      symbolId: symbol.id,
      symbolType: symbol.type,
      name: symbol.name,
      relativePath: (symbol as any).relativePath,
      confidence: Math.min(1, confidence),
    };
  }

  private matchesSymbol(
    symbol: IntelligenceSymbolRecord,
    taskQuery: string,
  ): boolean {
    const name = symbol.name.toLowerCase();
    const qn = (symbol.qualifiedName ?? "").toLowerCase();
    return (
      this.schemaOrServiceSymbol(symbol) &&
      (qn.includes(taskQuery) || name.includes(taskQuery))
    );
  }

  private schemaOrServiceSymbol(symbol: IntelligenceSymbolRecord): boolean {
    return /(Table|Column|ForeignKey|Entity|Route|ExternalService|Database|OrmEntity|Migration|Schema)/.test(
      symbol.type,
    );
  }

  private matchesTask(symbol: IntelligenceSymbolRecord, taskQuery: string): boolean {
    if (!this.schemaOrServiceSymbol(symbol)) return false;
    const name = symbol.name.toLowerCase();
    const qn = (symbol.qualifiedName ?? "").toLowerCase();
    return qn.includes(taskQuery) || name.includes(taskQuery);
  }

  private bestRelationship(symbolId: string): string | undefined {
    const rel = this.snapshot.relationships.find(
      (r) =>
        (r.sourceId === symbolId || r.targetId === symbolId) &&
        /(foreign-key|db-table-has-column|orm-has-field|route-exposes|uses-technology|uses|contains)/.test(
          r.type,
        ),
    );
    return rel?.type;
  }

  static selectFor(
    snapshot: IntelligenceSnapshot,
    options: CopilotContextOptions,
  ): CopilotContextCandidate[] {
    return new CopilotContextService(snapshot).selectCandidates(options);
  }
}
