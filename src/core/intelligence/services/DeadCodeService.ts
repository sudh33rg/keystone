// DeadCodeService.ts
// Provides dead code detection: symbols with no incoming references that are
// publicly exported or executable, suggesting they may be unused.

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";
import type { IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";

export interface DeadCodeCandidate {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  visibility: string | undefined;
  exported: boolean;
  isTest: boolean;
  hasCpgBranches: boolean;
  confidence: number;
  risk: "low" | "medium" | "high";
  reasons: string[];
}

export interface DeadCodeResult {
  generation: number;
  candidates: DeadCodeCandidate[];
  totalCandidates: number;
  highRisk: number;
  mediumRisk: number;
  lowRisk: number;
}

export class DeadCodeService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async detect(signal?: AbortSignal): Promise<DeadCodeResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    // Build incoming reference map
    const incomingRefs = new Set<string>();
    for (const rel of snapshot.relationships) {
      incomingRefs.add(rel.targetId);
    }

    const candidates: DeadCodeCandidate[] = [];

    for (let index = 0; index < snapshot.symbols.length; index++) {
      const symbol = snapshot.symbols[index];
      if (!symbol) continue;
      if ((index + 1) % 500 === 0) {
        if (signal?.aborted) {
          const error = new Error("Cancelled.");
          error.name = "AbortError";
          throw error;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      // Skip if has incoming references
      if (incomingRefs.has(symbol.id)) continue;

      // Skip test symbols
      if (this.isTestSymbol(symbol)) continue;

      // Only flag public/exported symbols or those with CPG branches
      const isPublic = symbol.visibility === "public" || symbol.visibility === "package";
      const isExported = symbol.exported === true;
      const hasCpgBranches = symbol.codeAnalysis?.branches
        ? symbol.codeAnalysis.branches > 0
        : false;

      if (!isPublic && !isExported && !hasCpgBranches) continue;

      const reasons: string[] = [];
      let risk: "low" | "medium" | "high" = "low";

      if (!isPublic && !isExported) {
        reasons.push("no incoming references");
        if (hasCpgBranches) {
          risk = "medium";
          reasons.push(`CPG branches exist (${symbol.codeAnalysis!.branches})`);
        }
      } else {
        reasons.push("public/exported symbol with no indexed callers");
        risk = "high";
      }

      if (hasCpgBranches) {
        risk = "high";
        reasons.push(`has ${symbol.codeAnalysis!.branches} CPG branches — likely executable`);
      }

      candidates.push({
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        relativePath: "",
        visibility: symbol.visibility,
        exported: symbol.exported ?? false,
        isTest: this.isTestSymbol(symbol),
        hasCpgBranches,
        confidence: symbol.confidence,
        risk,
        reasons,
      });
    }

    // Sort by risk (high first), then by qualified name
    candidates.sort((a, b) => {
      const riskOrder = { high: 0, medium: 1, low: 2 };
      if (riskOrder[a.risk] !== riskOrder[b.risk]) {
        return riskOrder[a.risk] - riskOrder[b.risk];
      }
      return a.qualifiedName.localeCompare(b.qualifiedName);
    });

    return {
      generation: snapshot.manifest.generation,
      candidates,
      totalCandidates: candidates.length,
      highRisk: candidates.filter((c) => c.risk === "high").length,
      mediumRisk: candidates.filter((c) => c.risk === "medium").length,
      lowRisk: candidates.filter((c) => c.risk === "low").length,
    };
  }

  private isTestSymbol(symbol: IntelligenceSymbolRecord): boolean {
    return (
      symbol.type.includes("Test") ||
      symbol.type.includes("Fixture") ||
      symbol.type.includes("Mock") ||
      symbol.name.toLowerCase().includes("test") ||
      symbol.name.toLowerCase().includes("spec")
    );
  }
}
