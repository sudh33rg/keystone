/**
 * TestMappingViewBuilder (spec §12). Maps test files/cases to production
 * symbols via explicit reference / import / naming / call / coverage evidence /
 * heuristic. Every mapping shows its origin + confidence. Never claims runtime
 * coverage unless actual coverage evidence was ingested.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualEdge,
} from "../../../shared/contracts/visualization";
import type { IntelligenceRelationshipRecord } from "../../../shared/contracts/intelligence";
import type { BuilderContext } from "./BaseViewBuilder";
import { BaseViewBuilder } from "./BaseViewBuilder";

export type TestMappingOrigin =
  | "explicit-reference"
  | "import-relationship"
  | "naming-convention"
  | "call-relationship"
  | "coverage-evidence"
  | "heuristic-inference"
  | "user-confirmed";

export class TestMappingViewBuilder extends BaseViewBuilder {
  build(): { nodes: IntelligenceVisualNode[]; edges: IntelligenceVisualEdge[] } {
    const entityIds = new Set<string>(this.ctx.seeds);
    // Include all test files/cases and their production targets.
    const testRels = this.snapshot.relationships.filter(
      (r) => r.type.includes("COVER") || r.type.includes("TESTS") || r.type.includes("REFERENCES"),
    );
    for (const r of testRels) {
      entityIds.add(r.sourceId);
      entityIds.add(r.targetId);
    }

    const nodes = Array.from(entityIds).map((id) => this.buildNode(id));
    const edges = testRels.map((r) => {
      const origin = this.originFor(r);
      return this.buildEdge(r, {
        relationship: r.type.includes("COVER")
          ? "covers"
          : r.type.includes("TESTS")
            ? "tests"
            : "uses",
        metrics: { mappingOrigin: origin, confidenceNote: this.noteFor(origin) },
      });
    });
    return { nodes, edges };
  }

  private originFor(r: IntelligenceRelationshipRecord): TestMappingOrigin {
    const p = (r.properties ?? {}) as Record<string, unknown>;
    if (p.mappingOrigin) return p.mappingOrigin as TestMappingOrigin;
    if (r.type.includes("COVER")) return "coverage-evidence";
    if (r.type.includes("TESTS")) return "explicit-reference";
    return "call-relationship";
  }

  private noteFor(origin: TestMappingOrigin): string {
    switch (origin) {
      case "coverage-evidence":
        return "Mapped by ingested coverage evidence.";
      case "explicit-reference":
        return "Explicit test reference.";
      case "call-relationship":
        return "Inferred from a call/reference relationship.";
      case "naming-convention":
        return "Inferred from naming convention (heuristic).";
      case "import-relationship":
        return "Inferred from an import relationship.";
      case "heuristic-inference":
        return "Heuristic inference — verify before trusting.";
      case "user-confirmed":
        return "Confirmed by a user.";
    }
  }

  static async build(ctx: BuilderContext) {
    return new TestMappingViewBuilder(ctx).build();
  }
}
