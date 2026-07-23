import { randomUUID } from "node:crypto";
import type {
  TestScenario,
  TestScenarioImportance,
  TestScenarioType,
} from "../../shared/contracts/qaTestIntelligence";

export interface ScenarioEvidenceInput {
  workflowId: string;
  generationRequestId: string;
  /** Workflow intent text. */
  intent: string;
  /** Approved specification text, if present. */
  specification?: string;
  /** Acceptance criteria derived from the specification, if present. */
  acceptanceCriteria: string[];
  /** Affected entity ids and a short human label per entity. */
  affectedEntities: Array<{ id: string; label: string; kind?: string }>;
  /** Affected flow ids and labels. */
  affectedFlows: Array<{ id: string; label: string }>;
  /** Why the coverage gap exists (the gap reason). */
  coverageGapReason: string;
  /** Layer recommended by the impact analysis. */
  recommendedLayer: "unit" | "integration" | "contract" | "end-to-end";
  /** Existing mapped test file paths, used to frame regression coverage. */
  existingTestFilePaths: string[];
  /** Detected test framework, for honest framing. */
  testFramework: string;
  /** Public-contract change notes, if any. */
  publicContractChanges: string[];
}

interface RawCriterion {
  text: string;
  evidenceId: string;
}

/**
 * Deterministic scenario derivation. Every scenario is grounded in supplied
 * evidence; the service never invents business values, credentials, or ids.
 * Where a value is unavailable it uses a tested placeholder such as
 * "an existing valid fixture for an authenticated user".
 */
export class TestScenarioService {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(now: () => string = () => new Date().toISOString(), createId: () => string = randomUUID) {
    this.now = now;
    this.createId = createId;
  }

  derive(input: ScenarioEvidenceInput): TestScenario[] {
    const evidence = this.collectEvidence(input);
    const scenarios: TestScenario[] = [];

    // Acceptance-criteria-driven scenarios (one per criterion, success type).
    for (const criterion of evidence.criteria) {
      scenarios.push(this.build({
        input,
        type: "success",
        importance: "required",
        title: `Satisfies: ${truncate(criterion.text, 80)}`,
        behaviour: `The affected behaviour meets the acceptance criterion: ${criterion.text}`,
        setup: [placeholder(input)],
        action: `Exercise the affected behaviour with an existing valid fixture for ${entityLabel(input)}.`,
        expectedOutcome: [`${criterion.text}`],
        evidenceIds: [criterion.evidenceId],
      }));
    }

    // Changed-behaviour scenarios from affected entities.
    for (const entity of input.affectedEntities) {
      scenarios.push(this.build({
        input,
        type: "success",
        importance: "required",
        title: `Covers behaviour of ${entity.label}`,
        behaviour: `The behaviour implemented by ${entity.label} (${entity.id}) behaves as expected for a happy path.`,
        setup: [placeholder(input)],
        action: `Invoke ${entity.label} through its public entry point.`,
        expectedOutcome: [`${entity.label} returns the expected result for the supported case.`],
        evidenceIds: [entity.id],
      }));
    }

    // Affected-flow scenarios.
    for (const flow of input.affectedFlows) {
      scenarios.push(this.build({
        input,
        type: input.recommendedLayer === "integration" ? "integration" : "success",
        importance: "required",
        title: `Covers flow ${flow.label}`,
        behaviour: `The affected flow ${flow.label} (${flow.id}) completes end to end without regression.`,
        setup: [placeholder(input)],
        action: `Drive the flow ${flow.label} using an existing valid fixture.`,
        expectedOutcome: [`${flow.label} reaches its expected terminal state.`],
        evidenceIds: [flow.id],
      }));
    }

    // Error path (only when evidence mentions error handling or a contract change).
    const mentionsError = /error|throw|reject|fail|invalid|exception/i.test(
      [input.intent, input.specification ?? "", input.coverageGapReason, ...evidence.criteria.map((c) => c.text), ...input.publicContractChanges].join(" "),
    );
    if (mentionsError) {
      scenarios.push(this.build({
        input,
        type: "error",
        importance: "recommended",
        title: "Rejects invalid input safely",
        behaviour: "The affected behaviour rejects invalid input without leaking internal state.",
        setup: [placeholder(input), "An invalid input fixture for the affected behaviour."],
        action: "Invoke the behaviour with the invalid fixture.",
        expectedOutcome: ["The behaviour rejects the input and reports a clear error."],
        evidenceIds: evidence.criteria.map((c) => c.evidenceId).slice(0, 3),
      }));
    }

    // Boundary scenario (numeric/collection evidence heuristic).
    const mentionsBoundary = /boundary|limit|min|max|empty|range|threshold|size/i.test(
      [input.coverageGapReason, ...evidence.criteria.map((c) => c.text)].join(" "),
    );
    if (mentionsBoundary) {
      scenarios.push(this.build({
        input,
        type: "boundary",
        importance: "recommended",
        title: "Handles boundary conditions",
        behaviour: "The affected behaviour behaves correctly at documented boundary values.",
        setup: [placeholder(input), "Boundary-value fixtures for the affected inputs."],
        action: "Exercise the boundaries documented by the coverage gap and acceptance criteria.",
        expectedOutcome: ["Boundary inputs produce the documented results without error."],
        evidenceIds: [input.coverageGapReason],
      }));
    }

    // Public-contract change scenarios.
    for (const change of input.publicContractChanges) {
      scenarios.push(this.build({
        input,
        type: "contract",
        importance: "required",
        title: `Honours contract change: ${truncate(change, 70)}`,
        behaviour: `The public contract change (${change}) is honoured by the affected behaviour.`,
        setup: [placeholder(input)],
        action: "Invoke the behaviour against the updated contract shape.",
        expectedOutcome: ["The behaviour conforms to the changed public contract."],
        evidenceIds: [change],
      }));
    }

    // Regression scenario tied to existing mapped tests.
    if (input.existingTestFilePaths.length) {
      scenarios.push(this.build({
        input,
        type: "regression",
        importance: "recommended",
        title: "Guards against regression of related tests",
        behaviour: "Changes to the affected behaviour do not break existing related tests.",
        setup: [`Existing mapped tests: ${input.existingTestFilePaths.join(", ")}`],
        action: "Run the existing related tests after the behaviour change.",
        expectedOutcome: ["Existing related tests continue to pass."],
        evidenceIds: input.existingTestFilePaths.slice(0, 5),
      }));
    }

    if (!scenarios.length) {
      throw new ScenarioEvidenceError(
        "scenario-evidence-insufficient",
        "No acceptance criteria, changed behaviour, affected flow, contract change, or existing tests were available to derive scenarios.",
      );
    }
    return scenarios;
  }

  private build(
    args: {
      input: ScenarioEvidenceInput;
      type: TestScenarioType;
      importance: TestScenarioImportance;
      title: string;
      behaviour: string;
      setup: string[];
      action: string;
      expectedOutcome: string[];
      evidenceIds: string[];
    },
  ): TestScenario {
    return {
      id: this.createId(),
      generationRequestId: args.input.generationRequestId,
      title: args.title,
      behaviour: args.behaviour,
      type: args.type,
      importance: args.importance,
      setup: args.setup,
      action: args.action,
      expectedOutcome: args.expectedOutcome,
      evidenceIds: args.evidenceIds.length ? args.evidenceIds : [args.input.coverageGapReason],
      selected: true,
    };
  }

  private collectEvidence(input: ScenarioEvidenceInput): { criteria: RawCriterion[] } {
    const criteria: RawCriterion[] = [];
    let index = 0;
    for (const text of input.acceptanceCriteria) {
      criteria.push({ text, evidenceId: `ac:${input.workflowId}:${index++}` });
    }
    if (!criteria.length && input.specification) {
      // Honest fallback: split the specification into sentences as candidate criteria.
      const sentences = input.specification.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
      for (const sentence of sentences) {
        criteria.push({ text: sentence, evidenceId: `spec:${input.workflowId}:${index++}` });
      }
    }
    return { criteria };
  }
}

function placeholder(input: ScenarioEvidenceInput): string {
  return `Use an existing valid fixture for ${entityLabel(input)}.`;
}

function entityLabel(input: ScenarioEvidenceInput): string {
  return input.affectedEntities[0]?.label ?? "the affected entity";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export class ScenarioEvidenceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "ScenarioEvidenceError";
  }
}
