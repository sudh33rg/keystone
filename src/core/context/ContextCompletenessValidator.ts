/**
 * ContextCompletenessValidator
 *
 * Validates post-compression completeness against required facts and blocks
 * delegation when a critical required fact is missing, required source evidence
 * is stale, the context contradicts the approved specification, or the token
 * budget is too small to preserve critical context.
 */

import type {
  ContextItem,
  ContextWarning,
  RequiredFact,
  StageContextProfile,
} from "../../shared/contracts/contextPackage";
import { ContextWarningSchema } from "../../shared/contracts/contextPackage";

export interface CompletenessResult {
  warnings: ContextWarning[];
  /** Whether delegation should be blocked. */
  blocked: boolean;
  completenessScore: number;
  confidence: number;
}

export class ContextCompletenessValidator {
  validate(
    facts: RequiredFact[],
    items: ContextItem[],
    profile: StageContextProfile,
    specText: string,
    impossibleBudget: boolean,
  ): CompletenessResult {
    const warnings: ContextWarning[] = [];
    let blocked = false;

    const criticalMissing = facts.filter(
      (f) => f.critical && (f.state === "missing" || f.state === "conflicting"),
    );
    if (criticalMissing.length > 0) {
      warnings.push(
        this.warn(
          "critical-fact-missing",
          "error",
          `${criticalMissing.length} critical required fact(s) are not represented in the context package: ${criticalMissing.map((f) => f.id).join(", ")}.`,
        ),
      );
      blocked = true;
    }

    const lowConfidence = facts.filter((f) => f.state === "low-confidence");
    if (lowConfidence.length > 0) {
      warnings.push(
        this.warn(
          "low-confidence-fact",
          "warning",
          `${lowConfidence.length} required fact(s) are represented only at low confidence.`,
        ),
      );
    }

    // Stale required evidence.
    const staleRequired = items.filter(
      (i) => i.importance === "required" && i.freshness === "stale",
    );
    if (staleRequired.length > 0) {
      warnings.push(
        this.warn(
          "stale-required-evidence",
          "error",
          `${staleRequired.length} required item(s) are built from stale source revisions.`,
        ),
      );
      blocked = true;
    }

    // Contradiction: removed facts whose identifiers still carry a "must not"
    // style constraint contradicted by a retained item are surfaced as a warning.
    const contradiction = this.detectContradiction(items, specText);
    if (contradiction) {
      warnings.push(this.warn("spec-contradiction", "error", contradiction));
      blocked = true;
    }

    // Required safety evidence (e.g. security/performance findings).
    for (const safetyType of profile.requiredSafetyEvidence) {
      if (!items.some((i) => i.sourceType === safetyType)) {
        warnings.push(
          this.warn(
            "missing-safety-evidence",
            "warning",
            `Stage profile requires '${safetyType}' evidence but none is present.`,
          ),
        );
      }
    }

    // Impossible budget.
    if (impossibleBudget) {
      warnings.push(
        this.warn(
          "budget-impossible",
          "error",
          "The token budget is too small to preserve critical context; delegation is blocked.",
        ),
      );
      blocked = true;
    }

    const satisfied = facts.filter(
      (f) => f.state === "satisfied" || f.state === "partially-satisfied",
    ).length;
    const completenessScore = facts.length === 0 ? 1 : satisfied / facts.length;
    const confidence =
      facts.length === 0
        ? 1
        : facts.reduce(
            (acc, f) =>
              acc + (f.state === "satisfied" ? 1 : f.state === "partially-satisfied" ? 0.6 : 0),
            0,
          ) / facts.length;

    if (!blocked && completenessScore < profile.minimumCompletenessThreshold) {
      warnings.push(
        this.warn(
          "completeness-below-threshold",
          "warning",
          `Completeness score ${completenessScore.toFixed(2)} is below the stage threshold ${profile.minimumCompletenessThreshold}.`,
        ),
      );
    }

    return { warnings, blocked, completenessScore, confidence };
  }

  /** Mark facts as low-confidence when their only satisfying item is low confidence. */
  annotateLowConfidence(facts: RequiredFact[], items: ContextItem[]): RequiredFact[] {
    return facts.map((fact) => {
      if (fact.state === "satisfied" && fact.satisfiedBy.length > 0) {
        const supporting = items.filter((i) => fact.satisfiedBy.includes(i.id));
        if (supporting.every((i) => i.confidence < 0.5)) {
          return {
            ...fact,
            state: "low-confidence",
            reason: "Satisfied only by low-confidence intelligence.",
          };
        }
      }
      return fact;
    });
  }

  private detectContradiction(items: ContextItem[], specText: string): string | undefined {
    // Heuristic: if the spec explicitly forbids something and a retained item
    // appears to undo it, flag for human review (never auto-resolve). This is a
    // conservative keyword check, not semantic proof.
    const forbidden = (
      specText.match(/\b(must not|do not|never|forbidden|prohibited)\b[^.]*\./gi) ?? []
    ).map((s) => s.toLowerCase());
    if (forbidden.length === 0) return undefined;
    for (const item of items) {
      for (const phrase of forbidden) {
        const keyword = phrase
          .replace(/must not|do not|never|forbidden|prohibited/gi, "")
          .trim()
          .split(" ")[0];
        if (
          keyword &&
          keyword.length > 3 &&
          item.content.toLowerCase().includes(keyword) &&
          /override|disable|bypass|remove|ignore/.test(item.content.toLowerCase())
        ) {
          return `Retained context may contradict an approved constraint: "${phrase.slice(0, 120)}".`;
        }
      }
    }
    return undefined;
  }

  private warn(
    code: string,
    severity: ContextWarning["severity"],
    message: string,
  ): ContextWarning {
    return ContextWarningSchema.parse({ code, severity, message });
  }
}
