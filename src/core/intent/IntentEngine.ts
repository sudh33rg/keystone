import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { RepositoryIndexService } from "../intelligence/RepositoryIndexService";
import {
  type IntentRecord,
  IntentRecordSchema,
  SCHEMA_VERSION
} from "../../shared/contracts/domain";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface IntentAnalysis {
  record: IntentRecord;
  confidence: number;
  recommendations: {
    mode: "quick" | "guided" | "spec-driven";
    agents: string[];
    risk: "low" | "medium" | "high" | "critical";
  };
}

export class IntentEngine {
  private workflowIdCounter = 0;
  private intents = new Map<string, IntentRecord>();

  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly index: RepositoryIndexService
  ) {}

  registerIntent(intent: IntentRecord): void {
    this.intents.set(intent.id, intent);
  }

  getIntent(intentId: string): IntentRecord | undefined {
    return this.intents.get(intentId);
  }

  analyze(text: string, mode: "quick" | "guided" | "spec-driven", workspaceRoot?: string): IntentAnalysis {
    const workflowId = `wf-${++this.workflowIdCounter}`;
    const intentId = crypto.randomUUID();

    const normalized = this.normalize(text);
    const category = this.categorize(text);
    const risk = this.assessRisk(text);
    const affectedAreas = this.findAffectedAreas(text, workspaceRoot);
    const ambiguities = this.extractAmbiguities(text);
    const constraints = this.extractConstraints(text);
    const recommendedAgents = this.recommendAgents(category);
    const requiredDecisions = this.identifyRequiredDecisions(text, risk);

    const record: IntentRecord = {
      id: intentId,
      workflowId,
      revision: 1,
      originalText: text,
      normalizedObjective: normalized,
      category,
      developmentMode: mode,
      affectedAreas,
      expectedOutcome: this.extractExpectedOutcome(text),
      constraints,
      ambiguities,
      riskLevel: risk,
      recommendedWorkflow: {
        mode: this.recommendMode(text, risk),
        approvalPolicy: risk === "high" || risk === "critical" || mode === "spec-driven"
      },
      recommendedAgents: recommendedAgents,
      requiredDecisions
    };

    const validated = IntentRecordSchema.safeParse(record);
    if (!validated.success) {
      throw new KeystoneError({
        code: "INTENT_VALIDATION_FAILED",
        category: "INTERNAL",
        message: "Generated intent record failed validation.",
        operation: "intent.analyze",
        recoverable: false,
        recommendedAction: "Review the intent input and retry."
      });
    }

    return {
      record: validated.data,
      confidence: 0.7,
      recommendations: {
        mode: this.recommendMode(text, risk),
        agents: recommendedAgents.map((a) => a.agentId),
        risk
      }
    };
  }

  private normalize(text: string): string {
    const trimmed = text.trim();
    const lines = trimmed.split(/\n/);
    if (lines.length === 1) return trimmed;

    const firstLine = lines[0].trim();
    if (firstLine.length > 0) return firstLine;
    return trimmed;
  }

  private categorize(text: string): string {
    const lower = text.toLowerCase();
    if (/(?:bug|fix|issue|defect|error|crash|fail)/.test(lower)) return "bug-fix";
    if (/(?:refactor|restructure|clean|modernize|upgrade)/.test(lower)) return "refactor";
    if (/(?:test|spec|coverage|assert)/.test(lower)) return "testing";
    if (/(?:investigate|debug|trace|understand|diagnose)/.test(lower)) return "investigation";
    if (/(?:doc|readme|comment|explain|document)/.test(lower)) return "documentation";
    if (/(?:review|check|audit|verify)/.test(lower)) return "review";
    if (/(?:performance|speed|optimize|fast|latency|memory)/.test(lower)) return "performance";
    if (/(?:security|auth|authn|authz|vulnerab|cve|exploit|inject)/.test(lower)) return "security";
    if (/(?:feature|implement|add|create|build|develop)/.test(lower)) return "feature";
    return "maintenance";
  }

  private assessRisk(text: string): "low" | "medium" | "high" | "critical" {
    const lower = text.toLowerCase();
    const criticalPatterns = [/security/i, /auth/i, /credential/i, /permission/i, /deploy/i, /migration/i, /database/i];
    const highPatterns = [/(?:refactor|restructure)/i, /api/i, /config/i, /architecture/i];
    const mediumPatterns = [/(?:add|implement|feature)/i];

    for (const pattern of criticalPatterns) {
      if (pattern.test(lower)) return "critical";
    }
    for (const pattern of highPatterns) {
      if (pattern.test(lower)) return "high";
    }
    for (const pattern of mediumPatterns) {
      if (pattern.test(lower)) return "medium";
    }
    return "low";
  }

  private findAffectedAreas(text: string, workspaceRoot?: string): { reference: string; reason: string }[] {
    const areas: { reference: string; reason: string }[] = [];
    const lower = text.toLowerCase();

    // Extract file mentions
    const fileMentions = text.match(/\b(?:src\/|lib\/|app\/|packages\/|src\/|lib\/|app\/)[\w/.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|c|h|cpp)\b/g);
    if (fileMentions) {
      for (const file of fileMentions) {
        areas.push({ reference: file, reason: "mentioned in intent" });
      }
    }

    // Extract symbol mentions
    const symbolMentions = text.match(/\b[A-Z][a-zA-Z0-9]+\b/g);
    if (symbolMentions) {
      const unique = [...new Set(symbolMentions)];
      for (const sym of unique.slice(0, 10)) {
        areas.push({ reference: sym, reason: "mentioned in intent" });
      }
    }

    return areas;
  }

  private extractAmbiguities(text: string): { question: string; impact: string }[] {
    const ambiguities: { question: string; impact: string }[] = [];
    const lower = text.toLowerCase();

    if (/\?(?:.*)$/.test(text.trim())) {
      ambiguities.push({
        question: "The request appears to be a question rather than a directive.",
        impact: "Clarification needed before proceeding."
      });
    }

    if (lower.includes("maybe") || lower.includes("perhaps") || lower.includes("consider")) {
      ambiguities.push({
        question: "The request uses uncertain language.",
        impact: "Scope and intent may change."
      });
    }

    if (lower.includes("and") && text.split("and").length > 3) {
      ambiguities.push({
        question: "The request appears to cover multiple distinct tasks.",
        impact: "Consider breaking into separate requests."
      });
    }

    return ambiguities;
  }

  private extractConstraints(text: string): { description: string; provenance: string }[] {
    const constraints: { description: string; provenance: string }[] = [];
    const lower = text.toLowerCase();

    if (lower.includes("without breaking") || lower.includes("backward compatible") || lower.includes("api compatible")) {
      constraints.push({
        description: "Must maintain backward compatibility.",
        provenance: "user"
      });
    }

    if (lower.includes("performance") || lower.includes("fast") || lower.includes("latency")) {
      constraints.push({
        description: "Performance is a concern.",
        provenance: "user"
      });
    }

    if (lower.includes("security") || lower.includes("auth")) {
      constraints.push({
        description: "Security is a concern.",
        provenance: "user"
      });
    }

    return constraints;
  }

  private recommendAgents(category: string): { agentId: string; reason: string }[] {
    const agents: { agentId: string; reason: string }[] = [];

    switch (category) {
      case "bug-fix":
        agents.push({ agentId: "copilot-debugging", reason: "Specialized in debugging and issue resolution." });
        agents.push({ agentId: "copilot-coding", reason: "General implementation capability." });
        break;
      case "feature":
        agents.push({ agentId: "copilot-coding", reason: "Primary implementation agent." });
        agents.push({ agentId: "copilot-testing", reason: "Test coverage for new features." });
        break;
      case "security":
        agents.push({ agentId: "copilot-security", reason: "Security-focused agent." });
        agents.push({ agentId: "copilot-review", reason: "Security review capability." });
        break;
      default:
        agents.push({ agentId: "copilot-coding", reason: "General implementation capability." });
    }

    return agents;
  }

  private identifyRequiredDecisions(text: string, risk: string): { id: string; question: string; blocking: boolean }[] {
    const decisions: { id: string; question: string; blocking: boolean }[] = [];
    const lower = text.toLowerCase();

    if (risk === "critical" || risk === "high") {
      decisions.push({
        id: crypto.randomUUID(),
        question: "This request has significant scope. Confirm the approach before proceeding.",
        blocking: true
      });
    }

    if (lower.includes("breaking") || lower.includes("api") || lower.includes("interface")) {
      decisions.push({
        id: crypto.randomUUID(),
        question: "This may affect the public API. Confirm the breaking change scope.",
        blocking: true
      });
    }

    return decisions;
  }

  private extractExpectedOutcome(text: string): string {
    const lower = text.toLowerCase();
    if (lower.includes("fix")) return "Fix the reported issue.";
    if (lower.includes("add") || lower.includes("implement") || lower.includes("create")) return "Implement the requested feature.";
    if (lower.includes("refactor")) return "Refactor the code as described.";
    if (lower.includes("test")) return "Add tests for the specified functionality.";
    return "Address the described request.";
  }

  private recommendMode(text: string, risk: "low" | "medium" | "high" | "critical"): "quick" | "guided" | "spec-driven" {
    if (risk === "critical" || risk === "high") return "spec-driven";
    if (risk === "medium") return "guided";
    return "quick";
  }
}
