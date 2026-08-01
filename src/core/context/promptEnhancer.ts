import { randomUUID } from "node:crypto";

import { analyzeRepositoryGraph } from "../intelligence/pipeline/derivedGraph";
import { buildIntelligenceFindings } from "../intelligence/pipeline/findings";
import { retrieveRepositoryIntelligence } from "../intelligence/pipeline/retrieval";
import type { RepoIntelligence } from "../domain/types";

export type EnhancementMode = "manual" | "auto";
export type EnhancementTurn = { role: "user" | "assistant"; content: string; timestamp: string };
export type EnhancementSession = {
  id: string;
  mode: EnhancementMode;
  originalIntent: string;
  enhancedIntent: string;
  status: "needs-input" | "ready";
  confidence: number;
  questions: string[];
  assumptions: string[];
  evidence: string[];
  goal: string;
  acceptanceCriteria: string[];
  constraints: string[];
  unresolvedGaps: string[];
  qualityScore: number;
  modelUsed: boolean;
  diagnostics: string[];
  turns: EnhancementTurn[];
  updatedAt: string;
};

export type EnhanceIntentInput = {
  text: string;
  mode: EnhancementMode;
  intelligence: RepoIntelligence;
  currentFile?: string;
  previous?: EnhancementSession;
};

/** Progressively turns vague user language into a repository-grounded engineering intent. */
export async function enhanceIntent(input: EnhanceIntentInput): Promise<EnhancementSession> {
  const now = new Date().toISOString();
  const originalIntent = input.previous?.originalIntent ?? input.text.trim();
  const turns = [...(input.previous?.turns ?? []), { role: "user" as const, content: input.text.trim(), timestamp: now }];
  const conversation = turns.filter(turn => turn.role === "user").map(turn => turn.content).join("\nFollow-up: ");
  const graph = analyzeRepositoryGraph(input.intelligence);
  const findings = buildIntelligenceFindings(input.intelligence, graph);
  const retrieval = await retrieveRepositoryIntelligence(input.intelligence, graph, findings, { text: conversation, limit: 8, graphDepth: 1 });
  const evidence = [...new Set([...(input.currentFile ? [`active:${input.currentFile}`] : []), ...retrieval.results.map(result => `${result.path} (${result.reasons.join(", ")})`)])];
  const ambiguity = ambiguityOf(conversation);
  let proposal = fallbackProposal(originalIntent, turns, evidence, input.mode, ambiguity);
  const modelUsed = false;
  const diagnostics: string[] = ["Deterministic repository-grounded enhancement used."];

  if (input.mode === "auto") {
    const grounded = evidence.length > 0;
    const safeToProceed = grounded && proposal.confidence >= 0.6 && proposal.goal.trim().length > 5 && proposal.acceptanceCriteria.length > 0;
    proposal = {
      ...proposal,
      status: safeToProceed ? "ready" : "needs-input",
      questions: safeToProceed ? [] : [grounded ? "Confirm the intended observable result before automatic analysis continues." : "Identify the repository area or behavior this should affect."],
      assumptions: proposal.assumptions.length ? proposal.assumptions : ["Use existing repository patterns and preserve public behavior unless the intent explicitly changes it."]
    };
  }
  const assistantContent = proposal.status === "ready" ? proposal.enhancedIntent : proposal.questions.join("\n");
  const unresolvedGaps = proposal.status === "needs-input" ? proposal.questions : [];
  const qualityScore = qualityOf(proposal, evidence);
  return {
    id: input.previous?.id ?? randomUUID(), mode: input.mode, originalIntent,
    enhancedIntent: proposal.enhancedIntent, status: proposal.status, confidence: proposal.confidence,
    questions: proposal.questions.slice(0, 3), assumptions: proposal.assumptions.slice(0, 8), evidence,
    goal: proposal.goal, acceptanceCriteria: proposal.acceptanceCriteria.slice(0, 8), constraints: proposal.constraints.slice(0, 8), unresolvedGaps,
    qualityScore, modelUsed, diagnostics,
    turns: [...turns, { role: "assistant", content: assistantContent, timestamp: now }], updatedAt: now
  };
}

type Proposal = Pick<EnhancementSession, "enhancedIntent" | "status" | "confidence" | "questions" | "assumptions" | "goal" | "acceptanceCriteria" | "constraints">;

function ambiguityOf(text: string): { vague: boolean; missingAction: boolean; missingTarget: boolean } {
  const tokens = text.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];
  const missingAction = !tokens.some(token => /^(add|build|create|fix|change|update|remove|refactor|test|explain|review|migrate|improve|implement)$/.test(token));
  const missingTarget = !tokens.some(token => token.includes("/") || /(?:api|ui|page|service|class|function|test|auth|database|component|extension|prompt|context)/.test(token));
  return { vague: tokens.length < 5 || missingAction || missingTarget, missingAction, missingTarget };
}

function fallbackProposal(original: string, turns: EnhancementTurn[], evidence: string[], mode: EnhancementMode, ambiguity: ReturnType<typeof ambiguityOf>): Proposal {
  const followups = turns.slice(1).filter(turn => turn.role === "user").map(turn => turn.content);
  const context = evidence.slice(0, 4).map(item => item.split(" (")[0].replace(/^active:/, "")).join(", ");
  const enhancedIntent = [original, ...followups, context ? `Use repository evidence from ${context}.` : "", "Preserve existing behavior outside the requested scope and validate the affected tests."].filter(Boolean).join(" ");
  const questions: string[] = [];
  if (ambiguity.missingAction) questions.push("What should change: add, fix, refactor, test, or explain?");
  if (ambiguity.missingTarget) questions.push(`Which behavior or area is the target${context ? ` (likely: ${context})` : ""}?`);
  if (ambiguity.vague && questions.length < 3) questions.push("What observable result will confirm this is complete?");
  return {
    enhancedIntent, status: mode === "manual" && ambiguity.vague && followups.length === 0 ? "needs-input" : "ready",
    confidence: ambiguity.vague ? (mode === "auto" && evidence.length ? 0.65 : 0.55) : 0.82, questions, assumptions: [],
    goal: original,
    acceptanceCriteria: ["The requested behavior is observable and covered by the smallest relevant validation set."],
    constraints: ["Preserve behavior outside the requested scope.", "Use existing repository patterns."]
  };
}

function qualityOf(proposal: Proposal, evidence: readonly string[]): number {
  const components = [proposal.goal.trim().length > 5, proposal.acceptanceCriteria.length > 0, proposal.constraints.length > 0, evidence.length > 0, proposal.status === "ready"];
  return Math.round((components.filter(Boolean).length / components.length) * 100);
}
