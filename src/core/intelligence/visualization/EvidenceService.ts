/**
 * EvidenceService (spec §14). Converts raw IntelligenceEvidenceRecord entries
 * into renderer-friendly VisualizationEvidence summaries. The raw source record
 * is kept available as an advanced secondary view, never the primary UX.
 */
import type {
  IntelligenceSnapshot,
  IntelligenceEvidenceRecord,
} from "../../../shared/contracts/intelligence";
import type {
  VisualizationEvidence,
  VisualizationFeedback,
} from "../../../shared/contracts/visualization";

export class EvidenceService {
  constructor(
    private snapshot: IntelligenceSnapshot,
    private feedback: VisualizationFeedback[] = [],
  ) {}

  /** Resolve a single evidence id to a renderer-friendly summary. */
  getEvidence(evidenceId: string): VisualizationEvidence | null {
    const raw = this.snapshot.evidence.find((e) => e.id === evidenceId);
    if (!raw) return null;
    const fb = this.feedback.find((f) => f.targetKind === "evidence" && f.targetId === evidenceId);
    return {
      id: raw.id,
      subjectId: raw.subjectId,
      sourceKind: raw.sourceKind ?? undefined,
      relativePath: raw.relativePath,
      range: raw.range,
      parserId: (raw as unknown as { extractorId?: string }).extractorId,
      parserVersion: (raw as unknown as { extractorVersion?: string }).extractorVersion,
      derivation: raw.derivation,
      confidence: raw.confidence,
      statement: raw.statement,
      feedback: fb
        ? fb.action === "reject"
          ? "rejected"
          : fb.action === "confirm"
            ? "confirmed"
            : "hidden"
        : undefined,
    };
  }

  /** Resolve all evidence for a node or edge (by entity/relationship id). */
  getEvidenceFor(subjectId: string): VisualizationEvidence[] {
    return this.snapshot.evidence
      .filter((e) => e.subjectId === subjectId)
      .map((e) => this.getEvidence(e.id))
      .filter((x): x is VisualizationEvidence => x !== null);
  }

  /**
   * Raw record for the advanced view (spec §14: raw records only as secondary).
   * Returns a deep clone so the UI cannot mutate the source-of-truth object.
   */
  getRawRecord(evidenceId: string): IntelligenceEvidenceRecord | null {
    const raw = this.snapshot.evidence.find((e) => e.id === evidenceId);
    return raw ? structuredClone(raw) : null;
  }

  /** Human-readable relationship claim text for an edge's evidence. */
  describeRelationship(sourceLabel: string, targetLabel: string, relationship: string): string {
    return `${sourceLabel} --[${relationship}]--> ${targetLabel}`;
  }
}
