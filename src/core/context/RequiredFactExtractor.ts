/**
 * RequiredFactExtractor
 *
 * Derives the set of required facts for the current stage/work item from the
 * specification, acceptance criteria, and profile. Each required fact must map
 * to one or more context items so completeness can be validated after
 * compression. Required facts include: target behaviour, affected interfaces,
 * acceptance criteria, repository conventions, relevant constraints, required
 * tests, known risks, changed symbols, and required output format.
 */

import type { DevelopmentSpecification, DevelopmentTask } from "../../shared/contracts/delegation";
import type {
  ContextItem,
  RequiredFact,
  StageContextProfile,
} from "../../shared/contracts/contextPackage";
import { RequiredFactSchema } from "../../shared/contracts/contextPackage";
import { fnv1a } from "./compressionUtils";

export interface RequiredFactResult {
  facts: RequiredFact[];
  /** Map of fact id -> item ids that satisfy it. */
  mapping: Map<string, string[]>;
}

export class RequiredFactExtractor {
  extract(
    task: DevelopmentTask,
    specification: DevelopmentSpecification,
    items: ContextItem[],
    profile: StageContextProfile,
  ): RequiredFactResult {
    const facts: RequiredFact[] = [];
    const mapping = new Map<string, string[]>();

    const pushFact = (fact: Omit<RequiredFact, "state" | "satisfiedBy" | "reason">) =>
      facts.push(
        RequiredFactSchema.parse({
          ...fact,
          state: "missing",
          satisfiedBy: [],
          reason: "Not yet mapped to retained context.",
        }),
      );

    // Target behaviour.
    pushFact({
      id: `fact:behaviour:${fnv1a(task.objective).slice(0, 8)}`,
      description: `Target behaviour: ${task.objective}`,
      category: "target-behaviour",
      critical: true,
    });

    // Acceptance criteria (each is a required fact).
    for (const criterion of specification.acceptanceCriteria.filter((c) =>
      task.acceptanceCriterionIds.includes(c.id),
    )) {
      pushFact({
        id: `fact:ac:${criterion.id}`,
        description: `Acceptance criterion ${criterion.id}: ${criterion.description}`,
        category: "acceptance-criterion",
        critical: criterion.required,
      });
    }

    // Affected interfaces — derived from expected entity symbols.
    for (const entityId of task.expectedEntityIds.slice(0, 20)) {
      pushFact({
        id: `fact:iface:${entityId}`,
        description: `Affected interface/symbol: ${entityId}`,
        category: "affected-interface",
        critical: true,
      });
    }

    // Constraints.
    let constraintIndex = 0;
    for (const constraint of specification.constraints ?? []) {
      pushFact({
        id: `fact:constraint:${constraintIndex++}`,
        description: `Constraint: ${constraint}`,
        category: "constraint",
        critical: false,
      });
    }

    // Required tests (from test strategy).
    const requiredTests = specification.testStrategy?.requiredTests ?? [];
    for (const test of requiredTests.slice(0, 20)) {
      pushFact({
        id: `fact:test:${fnv1a(test).slice(0, 8)}`,
        description: `Required test: ${test}`,
        category: "required-test",
        critical: false,
      });
    }

    // Known risks.
    const risks = specification.testStrategy?.risks ?? [];
    for (const risk of risks.slice(0, 10)) {
      pushFact({
        id: `fact:risk:${fnv1a(risk).slice(0, 8)}`,
        description: `Known risk: ${risk}`,
        category: "known-risk",
        critical: false,
      });
    }

    // Required output format from the profile/contract.
    pushFact({
      id: `fact:output:${profile.id}`,
      description: `Required output format for stage ${profile.stageType}.`,
      category: "output-format",
      critical: false,
    });

    // Map facts to retained items.
    for (const fact of facts) {
      const matched = this.matchItems(fact, task, items);
      mapping.set(fact.id, matched);
      if (matched.length === 0) {
        fact.state = "missing";
        fact.reason = "No retained context item satisfies this required fact.";
      } else if (matched.length === 1 && fact.critical) {
        fact.state = "satisfied";
        fact.satisfiedBy = matched;
        fact.reason = `Satisfied by 1 retained item (${matched[0]}).`;
      } else {
        fact.state = fact.critical ? "satisfied" : "partially-satisfied";
        fact.satisfiedBy = matched;
        fact.reason = `Satisfied by ${matched.length} retained item(s).`;
      }
    }

    return { facts, mapping };
  }

  private matchItems(
    fact: Omit<RequiredFact, "state" | "satisfiedBy" | "reason">,
    task: DevelopmentTask,
    items: ContextItem[],
  ): string[] {
    const matched: string[] = [];
    const desc = fact.description.toLowerCase();
    for (const item of items) {
      if (item.importance !== "required" && !item.included) continue;
      if (
        fact.category === "acceptance-criterion" &&
        item.sourceType === "acceptance-criterion" &&
        desc.includes((item.sourceReference.entityId ?? "").toLowerCase())
      )
        matched.push(item.id);
      else if (
        fact.category === "affected-interface" &&
        item.sourceType === "symbol" &&
        desc.includes((item.sourceReference.symbolId ?? "").toLowerCase())
      )
        matched.push(item.id);
      else if (fact.category === "target-behaviour" && item.sourceType === "workflow-intent")
        matched.push(item.id);
      else if (
        fact.category === "constraint" &&
        item.sourceType === "specification" &&
        item.content.toLowerCase().includes(desc.replace("constraint:", "").trim().slice(0, 20))
      )
        matched.push(item.id);
      else if (fact.category === "required-test" && item.sourceType === "test")
        matched.push(item.id);
      else if (fact.category === "output-format" && item.sourceType === "instruction")
        matched.push(item.id);
    }
    return matched;
  }
}
