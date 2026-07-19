// CyclomaticComplexityService.ts
// Provides cyclomatic complexity analysis using CPG branch counts.
// Complexity = 1 + number of decision points (branches).

import type { IntelligenceSnapshotReader } from "../../persistence/IntelligenceStore";

export interface ComplexityLevel {
  label: "trivial" | "moderate" | "complex" | "very_complex" | "untestable";
  min: number;
  max: number;
  description: string;
}

export interface ComplexityResult {
  id: string;
  type: string;
  name: string;
  qualifiedName: string;
  relativePath: string;
  cyclomaticComplexity: number;
  branchCount: number;
  callCount: number;
  level: ComplexityLevel;
  confidence: number;
}

export interface CyclomaticComplexityResult {
  generation: number;
  results: ComplexityResult[];
  totalAnalyzed: number;
  averageComplexity: number;
  maxComplexity: number;
  byLevel: Record<ComplexityLevel["label"], number>;
}

const COMPLEXITY_LEVELS: ComplexityLevel[] = [
  { label: "trivial", min: 1, max: 5, description: "Simple, easy to test" },
  { label: "moderate", min: 6, max: 10, description: "Moderate complexity, consider refactoring" },
  { label: "complex", min: 11, max: 20, description: "High complexity, testing is difficult" },
  { label: "very_complex", min: 21, max: 50, description: "Very complex, high maintenance cost" },
  { label: "untestable", min: 51, max: Infinity, description: "Effectively untestable" },
];

export class CyclomaticComplexityService {
  constructor(private readonly store: IntelligenceSnapshotReader) {}

  async analyze(signal?: AbortSignal): Promise<CyclomaticComplexityResult> {
    const snapshot = this.store.getSnapshot();
    if (!snapshot) {
      throw new Error("Intelligence snapshot unavailable.");
    }

    const results: ComplexityResult[] = [];

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

      // Only include symbols with CPG data
      if (!symbol.codeAnalysis) continue;

      const branchCount = symbol.codeAnalysis.branches ?? 0;
      const callCount = symbol.codeAnalysis.calls ?? 0;
      const cyclomaticComplexity = 1 + branchCount;
      const level = this.getComplexityLevel(cyclomaticComplexity);

      const file = snapshot.files.find((f) => f.id === symbol.fileId);

      results.push({
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        qualifiedName: symbol.qualifiedName,
        relativePath: file?.relativePath ?? "",
        cyclomaticComplexity,
        branchCount,
        callCount,
        level,
        confidence: symbol.confidence,
      });
    }

    // Sort by complexity descending
    results.sort((a, b) => b.cyclomaticComplexity - a.cyclomaticComplexity);

    const totalAnalyzed = results.length;
    const averageComplexity =
      totalAnalyzed > 0
        ? results.reduce((sum, r) => sum + r.cyclomaticComplexity, 0) / totalAnalyzed
        : 0;
    const maxComplexity = results.length > 0 ? results[0]!.cyclomaticComplexity : 0;

    const byLevel: Record<ComplexityLevel["label"], number> = {
      trivial: 0,
      moderate: 0,
      complex: 0,
      very_complex: 0,
      untestable: 0,
    };
    for (const r of results) {
      byLevel[r.level.label]++;
    }

    return {
      generation: snapshot.manifest.generation,
      results,
      totalAnalyzed,
      averageComplexity,
      maxComplexity,
      byLevel,
    };
  }

  async getFunctionComplexity(
    functionId: string,
    signal?: AbortSignal,
  ): Promise<ComplexityResult | undefined> {
    const result = await this.analyze(signal);
    return result.results.find((r) => r.id === functionId);
  }

  async getHighComplexityFunctions(
    threshold = 10,
    signal?: AbortSignal,
  ): Promise<ComplexityResult[]> {
    const result = await this.analyze(signal);
    return result.results.filter(
      (r) => r.cyclomaticComplexity >= threshold,
    );
  }

  private getComplexityLevel(complexity: number): ComplexityLevel {
    for (const level of COMPLEXITY_LEVELS) {
      if (complexity >= level.min && complexity <= level.max) {
        return level;
      }
    }
    return COMPLEXITY_LEVELS[COMPLEXITY_LEVELS.length - 1]!;
  }
}
