/**
 * ContextCandidateConverter (spec §19). Converts visual selections (node, group,
 * flow, path, evidence, test mapping) into typed ContextPackage candidates
 * rather than copying arbitrary canvas text.
 */
import type {
  IntelligenceVisualNode,
  IntelligenceVisualGroup,
  VisualizationContextCandidate,
  IntelligenceViewType,
} from "../../../shared/contracts/visualization";
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";

export class ContextCandidateConverter {
  static fromNode(
    node: IntelligenceVisualNode,
    snapshot: IntelligenceSnapshot,
    viewType: IntelligenceViewType,
  ): VisualizationContextCandidate {
    const symbol = snapshot.symbols.find((s) => s.id === node.entityId);
    const file = snapshot.files.find((f) => f.id === node.entityId);
    const isTest = node.kind === "test-file" || node.kind === "test-case";
    return {
      candidateType:
        viewType === "tests"
          ? "test-relationship"
          : viewType === "flow" || viewType === "data"
            ? "flow-compressed"
            : viewType === "architecture"
              ? "module-summary"
              : "symbol-signature",
      title: node.label,
      sourceType: isTest ? "test" : symbol ? "symbol" : "repository-file",
      sourceReference: {
        filePath: node.source?.filePath,
        symbolId: node.source?.symbolId,
        entityId: node.entityId,
        startLine: node.source?.startLine,
        endLine: node.source?.endLine,
      },
      content: symbol?.signature ?? file?.relativePath ?? node.description ?? node.label,
      confidence: node.confidence,
      reasons: [
        `Selected ${node.kind} from ${viewType} view.`,
        ...(node.evidenceIds.length
          ? [`Backed by ${node.evidenceIds.length} evidence record(s).`]
          : []),
      ],
    };
  }

  static fromGroup(
    group: IntelligenceVisualGroup,
    _snapshot: IntelligenceSnapshot,
  ): VisualizationContextCandidate {
    return {
      candidateType: "module-summary",
      title: group.label,
      sourceType: "repository-file",
      sourceReference: {
        entityId: group.childNodeIds.map((id) => id.replace(/^n:/, "")).join(","),
      },
      content: `Module/Group: ${group.label} (basis: ${group.basis}) with ${group.childNodeIds.length} member(s).`,
      confidence: 0.9,
      reasons: [
        `Group basis is ${group.basis} (not necessarily an authoritative architecture decision).`,
        group.description ?? "",
      ],
    };
  }

  static fromEvidence(
    evidenceIds: string[],
    snapshot: IntelligenceSnapshot,
  ): VisualizationContextCandidate {
    const statements = evidenceIds
      .map((id) => snapshot.evidence.find((e) => e.id === id)?.statement)
      .filter((s): s is string => Boolean(s));
    return {
      candidateType: "evidence-reference",
      title: `Evidence (${evidenceIds.length})`,
      sourceType: "evidence",
      sourceReference: { evidenceId: evidenceIds[0] },
      content: statements.join("\n\n"),
      confidence: 0.9,
      reasons: ["Selected evidence reference(s)."],
    };
  }

  static fromNodes(
    nodes: IntelligenceVisualNode[],
    snapshot: IntelligenceSnapshot,
    viewType: IntelligenceViewType,
  ): VisualizationContextCandidate[] {
    return nodes.map((n) => this.fromNode(n, snapshot, viewType));
  }
}
