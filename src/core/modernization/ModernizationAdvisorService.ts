import { createHash } from "node:crypto";
import { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { ModernizationPersistence } from "../persistence/ModernizationPersistence";
import {
  ModernizationAssessment,
  ModernizationAssessmentSchema,
  ModernizationRecommendationSchema,
} from "../../shared/contracts/modernization";

export interface ModernizationAdvisorOptions {
  stackInventory?: {
    languages?: string[];
    frameworks?: string[];
    databases?: string[];
    orms?: string[];
    buildSystems?: string[];
    testFrameworks?: string[];
    services?: string[];
    architectureStyle?: string;
    modularitySignals?: string[];
  };
}

type ModernizationAssessmentInput = {
  workflowId?: string;
  summary: string;
  stackInventory?: ModernizationAssessment["stackInventory"];
  userPrompt?: string;
};

export class ModernizationAdvisorService {
  constructor(private readonly persistence: ModernizationPersistence, private readonly logger: KeystoneLogger, private readonly options: ModernizationAdvisorOptions = {}) {}

  async buildAssessment(input: ModernizationAssessmentInput): Promise<ModernizationAssessment> {
    const now = new Date().toISOString();
    const stackInventory = input.stackInventory ?? (this.options.stackInventory as ModernizationAssessmentInput["stackInventory"]) ?? {
      languages: [],
      frameworks: [],
      databases: [],
      orms: [],
      buildSystems: [],
      testFrameworks: [],
      services: [],
      architectureStyle: undefined,
      modularitySignals: [],
    };

    const recommendations = this.deriveRecommendations(stackInventory, input.userPrompt);
    const prompts = this.derivePrompts(recommendations, input.userPrompt);

    const assessment = ModernizationAssessmentSchema.parse({
      schemaVersion: 1,
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      summary: input.summary,
      stackInventory,
      recommendations,
      prompts,
      createdAt: now,
      updatedAt: now,
      contentHash: "",
    });

    await this.persistence.update((state) => ({
      ...state,
      assessments: [...state.assessments, assessment],
    }));

    return assessment;
  }

  loadLatest(workflowId?: string): ModernizationAssessment | undefined {
    const items = this.persistence.snapshot.assessments.filter((item) => !workflowId || item.workflowId === workflowId);
    return items.at(-1);
  }

  private deriveRecommendations(
    inventory: ModernizationAssessment["stackInventory"],
    userPrompt?: string,
  ): ModernizationAssessment["recommendations"] {
    const recommendations: ModernizationAssessment["recommendations"] = [];
    const add = (item: ModernizationAssessment["recommendations"][number]) => recommendations.push(item);

    if (inventory && this.looksLikeMonolith(inventory)) {
      add({
        id: crypto.randomUUID(),
        category: "architecture",
        title: "Assess bounded-context decomposition",
        summary: "Current signals suggest a monolithic service boundary. Evaluate module seams, package dependencies, and runtime ownership before extracting services.",
        rationale: "Monoliths often hide hidden coupling that breaks during decomposition.",
        affectedAreas: inventory.services ?? [],
        affectedFiles: [],
        currentState: inventory.architectureStyle ?? "unknown",
        proposedState: "Bounded contexts with explicit API contracts",
        migrationSteps: [
          "Map module ownership and dependency graph.",
          "Identify low-coupling seams for first extraction.",
          "Introduce async contracts before service split.",
        ],
        breakingChangeRisk: "high",
        estimatedEffort: "large",
        dependencies: [],
        relatedFindings: [],
        recommendationSource: "deterministic",
        evidence: ["architecture heuristic", inventory.architectureStyle ?? ""],
        references: [],
        confidence: 0.6,
        status: "proposed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "",
      });
    }

    const languages = (inventory?.languages ?? []).join(" ");
    if (/typescript|javascript/i.test(languages)) {
      add({
        id: crypto.randomUUID(),
        category: "framework-upgrade",
        title: "Modernize runtime or framework versions",
        summary: "Review runtime and framework versions for supported LTS releases and migration paths.",
        rationale: "Older runtimes increase security debt and miss performance improvements.",
        affectedAreas: inventory?.frameworks ?? [],
        affectedFiles: [],
        migrationSteps: [
          "Audit current runtime and framework versions from manifests.",
          "Check breaking changes between current and target versions.",
          "Create incremental upgrade branches with adapter shims.",
        ],
        breakingChangeRisk: "medium",
        estimatedEffort: "medium",
        dependencies: [],
        relatedFindings: [],
        recommendationSource: "deterministic",
        evidence: ["language heuristic"],
        references: [],
        confidence: 0.7,
        status: "proposed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "",
      });
    }

    const ormCount = inventory?.orms?.length ?? 0;
    if (ormCount > 0) {
      add({
        id: crypto.randomUUID(),
        category: "orm-replacement",
        title: "Evaluate ORM modernization or bounded SQL layer",
        summary: "Current ORMs may hide query costs. Evaluate modern alternatives or explicit query boundaries.",
        rationale: "ORM modernization often improves query control and observability.",
        affectedAreas: inventory?.orms ?? [],
        affectedFiles: [],
        migrationSteps: [
          "Profile hottest query paths.",
          "Compare current ORM with modern alternatives.",
          "Prototype one bounded read/write path.",
        ],
        breakingChangeRisk: "medium",
        estimatedEffort: "medium",
        dependencies: [],
        relatedFindings: [],
        recommendationSource: "deterministic",
        evidence: ["orm heuristic"],
        references: [],
        confidence: 0.6,
        status: "proposed",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        contentHash: "",
      });
    }

    if (userPrompt) {
      const prompt = userPrompt.trim().toLowerCase();
      if (prompt.includes("observability") || prompt.includes("metrics") || prompt.includes("tracing")) {
        add({
          id: crypto.randomUUID(),
          category: "observability",
          title: "Add structured observability stack",
          summary: "User requested observability modernization. Recommend metrics, logs, and traces with typed instrumentation.",
          rationale: "Modern services require observable failure modes and latency budgets.",
          affectedAreas: inventory?.services ?? [],
          affectedFiles: [],
          currentState: undefined,
          proposedState: "Typed metrics/logs/traces with dashboards",
          migrationSteps: ["Instrument requested flows", "Define SLOs", "Add dashboards"],
          breakingChangeRisk: "low",
          estimatedEffort: "medium",
          dependencies: [],
          relatedFindings: [],
          recommendationSource: "deterministic",
          evidence: ["user prompt heuristic"],
          references: [],
          confidence: 0.6,
          status: "proposed",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          contentHash: "",
        });
      }
    }

    return recommendations;
  }

  private derivePrompts(
    recommendations: ModernizationAssessment["recommendations"],
    userPrompt?: string,
  ): ModernizationAssessment["prompts"] {
    const prompts: ModernizationAssessment["prompts"] = [];

    for (const rec of recommendations.slice(0, 5)) {
      prompts.push({
        id: crypto.randomUUID(),
        title: `Modernize: ${rec.title}`,
        prompt: [
          "You are Keystone's modernization advisor.",
          `Recommendation: ${rec.title}`,
          `Category: ${rec.category}`,
          `Current state: ${rec.currentState ?? "unknown"}`,
          `Proposed state: ${rec.proposedState ?? ""}`,
          `Risk: ${rec.breakingChangeRisk}; Effort: ${rec.estimatedEffort}`,
          ...(userPrompt ? [`User prompt: ${userPrompt}`] : []),
          "Return migration steps, validation commands, risks, and rollback notes.",
        ].join("\n"),
        expectedOutput: "markdown migration plan with validation steps and risks",
      });
    }

    return prompts;
  }

  private looksLikeMonolith(inventory: ModernizationAssessment["stackInventory"]): boolean {
    if (!inventory) return false;
    const signals = (inventory.modularitySignals ?? []).join(" ").toLowerCase();
    const style = (inventory.architectureStyle ?? "").toLowerCase();
    const serviceCount = (inventory.services ?? []).length;
    return /monolith|single.*service|single.*repo|tight.*coupling/.test(signals || style) || serviceCount >= 8;
  }
}
