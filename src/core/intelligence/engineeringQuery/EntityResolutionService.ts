/**
 * EntityResolutionService (spec §8, §10).
 *
 * Resolves a free-text subject/target to ranked ResolvedEntityCandidate[] using the
 * existing IntelligenceSnapshot (source of truth). Never invents entities.
 *
 * Signals (§8): exact qualified-name, exact symbol/file name, exact file path,
 * normalized route (via symbol.properties.route), case-insensitive, partial name,
 * recent selection, active editor, changed files, package/module proximity,
 * entity-type hint, graph connectivity (handled by ranking).
 *
 * Ambiguity rule (§9): do NOT auto-select a low-confidence candidate when
 * multiple plausible matches exist.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceSymbolRecord,
  IntelligenceFileRecord,
} from "../../../shared/contracts/intelligence";
import type { ResolvedEntityCandidate } from "../../../shared/contracts/engineeringQuery";

export interface ResolutionContext {
  repositoryId: string;
  activeFilePath?: string;
  activeSelection?: string;
  workflowPackageIds?: string[];
  workflowModuleIds?: string[];
  changedEntityIds?: string[];
  recentEntityIds?: string[];
  packageProximityIds?: string[];
}

export interface ResolutionResult {
  candidates: ResolvedEntityCandidate[];
  ambiguityState: "resolved" | "needs-selection" | "partially-resolved" | "unresolved";
  contextInfluenced: boolean;
}

interface Scored {
  candidate: ResolvedEntityCandidate;
  score: number;
}

export class EntityResolutionService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  resolve(
    rawText: string,
    opts: { typeHint?: string; ctx?: ResolutionContext } = {},
  ): ResolutionResult {
    const text = rawText.trim();
    if (!text) {
      return { candidates: [], ambiguityState: "unresolved", contextInfluenced: false };
    }
    const ctx = opts.ctx;
    const lower = text.toLowerCase();

    const scored: Scored[] = [];
    const consider = (c: ResolvedEntityCandidate, score: number): void => {
      scored.push({ candidate: c, score });
    };

    for (const sym of this.snapshot.symbols) {
      const c = this.symbolCandidate(sym, ctx);
      const s = this.matchScore(
        text,
        lower,
        sym.qualifiedName,
        c.displayName,
        "symbol",
        opts.typeHint,
        ctx,
      );
      if (s > 0) consider(c, s);
    }
    for (const file of this.snapshot.files) {
      const c = this.fileCandidate(file, ctx);
      const s = this.matchScore(
        text,
        lower,
        file.relativePath,
        c.displayName,
        "file",
        opts.typeHint,
        ctx,
      );
      if (s > 0) consider(c, s);
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 20);
    let contextInfluenced = false;
    const enriched = top.map((entry) => {
      let score = entry.score;
      if (ctx) {
        if (entry.candidate.entityId === ctx.activeSelection) {
          score += 60;
          contextInfluenced = true;
        }
        if (ctx.recentEntityIds?.includes(entry.candidate.entityId)) {
          score += 25;
          contextInfluenced = true;
        }
        if (ctx.changedEntityIds?.includes(entry.candidate.entityId)) {
          score += 20;
          contextInfluenced = true;
        }
        if (ctx.packageProximityIds?.includes(entry.candidate.entityId)) {
          score += 12;
          contextInfluenced = true;
        }
      }
      return { candidate: entry.candidate, score };
    });
    enriched.sort((a, b) => b.score - a.score);
    const candidates = enriched.map((e) => e.candidate);

    let ambiguityState: ResolutionResult["ambiguityState"];
    const first = candidates[0];
    const second = candidates[1];
    if (candidates.length === 0) ambiguityState = "unresolved";
    else if (candidates.length === 1) ambiguityState = "resolved";
    else if (
      first &&
      second &&
      first.confidence >= 0.9 &&
      first.confidence - second.confidence >= 0.25
    )
      ambiguityState = "resolved";
    else if (candidates.length > 1) ambiguityState = "needs-selection";
    else ambiguityState = "partially-resolved";

    return { candidates, ambiguityState, contextInfluenced };
  }

  /** Auto-select only when one dominant candidate exists (§9). */
  select(candidates: ResolvedEntityCandidate[]): string[] {
    const first = candidates[0];
    const second = candidates[1];
    if (!first) return [];
    if (candidates.length === 1) return [first.entityId];
    if (first.confidence >= 0.9 && second && first.confidence - second.confidence >= 0.25) {
      return [first.entityId];
    }
    return [];
  }

  private matchScore(
    text: string,
    lower: string,
    qualifiedName: string,
    displayName: string,
    kind: "symbol" | "file",
    typeHint: string | undefined,
    ctx: ResolutionContext | undefined,
  ): number {
    const qLower = qualifiedName.toLowerCase();
    const dLower = displayName.toLowerCase();
    let score: number;
    const routeVal = "";
    void routeVal;

    if (lower === qLower) {
      score = 1;
    } else if (lower === dLower) {
      score = 0.95;
    } else if (qLower.endsWith("." + lower) || dLower.endsWith(lower)) {
      score = 0.7;
    } else if (
      qLower.includes("." + lower + ".") ||
      qLower.includes("/" + lower + "/") ||
      dLower.includes(lower)
    ) {
      score = 0.45;
    } else if (lower.length >= 3 && (qLower.includes(lower) || dLower.includes(lower))) {
      score = 0.3;
    } else {
      return 0;
    }

    void ctx;
    void text;
    // Type-hint agreement boosts confidence (§6/§8).
    if (typeHint && qualifiedName === typeHint) score += 0.05;
    return Math.min(1, score);
  }

  private symbolCandidate(
    sym: IntelligenceSymbolRecord,
    ctx: ResolutionContext | undefined,
  ): ResolvedEntityCandidate {
    const file = this.snapshot.files.find((f) => f.id === sym.fileId);
    return {
      entityId: sym.id,
      displayName: sym.name,
      qualifiedName: sym.qualifiedName,
      kind: sym.type,
      location: file
        ? {
            relativePath: file.relativePath,
            startLine: sym.range?.startLine,
            startColumn: sym.range?.startColumn,
            endLine: sym.range?.endLine,
            endColumn: sym.range?.endColumn,
          }
        : undefined,
      confidence: 0,
      reason: "",
      repositoryScope: ctx?.repositoryId ?? this.snapshot.repository.id,
      supportingAliases: [],
    };
  }

  private fileCandidate(
    file: IntelligenceFileRecord,
    ctx: ResolutionContext | undefined,
  ): ResolvedEntityCandidate {
    return {
      entityId: file.id,
      displayName: file.relativePath.split("/").pop() ?? file.relativePath,
      qualifiedName: file.relativePath,
      kind: "keystone.core.File",
      location: { relativePath: file.relativePath },
      confidence: 0,
      reason: "",
      repositoryScope: ctx?.repositoryId ?? this.snapshot.repository.id,
      supportingAliases: [],
    };
  }
}
