/**
 * ContextPackageRenderer
 *
 * Renders the agent-ready delegation prompt from a ContextPackage, integrating
 * the Phase 2 execution contract: workflow, specification, intelligence context,
 * compressed context sections, skills, instructions, task, and expected output.
 *
 * The renderer also produces the *complete measured prompt token count*, which
 * includes context + instructions + skills + specification + output reservation
 * (not just the compressed context). UI logic never lives here.
 */

import type { ContextPackage, ContextItem } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";

export interface RenderSections {
  executionContract: string;
  workflow: string;
  specification: string;
  intelligenceContext: string;
  compressedContext: string;
  skills: string;
  instructions: string;
  task: string;
  expectedOutput: string;
}

export class ContextPackageRenderer {
  render(
    pkg: ContextPackage,
    skillNames: string[],
    instructionNames: string[],
    counter: TokenCounter,
  ): { rendered: string; completePromptTokens: number; sections: RenderSections } {
    const sections: RenderSections = {
      executionContract: this.renderExecutionContract(pkg),
      workflow: this.renderWorkflow(pkg),
      specification: this.renderSpecification(pkg),
      intelligenceContext: this.renderIntelligence(pkg),
      compressedContext: this.renderCompressedContext(pkg),
      skills: this.renderList("Skills", skillNames),
      instructions: this.renderList("Instructions", instructionNames),
      task: this.renderTask(pkg),
      expectedOutput: this.renderExpectedOutput(pkg),
    };

    let rendered = "# Keystone Execution Contract\n\n";
    rendered += sections.executionContract + "\n";
    rendered += sections.workflow + "\n";
    rendered += sections.specification + "\n";
    rendered += sections.intelligenceContext + "\n";
    rendered += sections.compressedContext + "\n";
    rendered += sections.skills + "\n";
    rendered += sections.instructions + "\n";
    rendered += sections.task + "\n";
    rendered += sections.expectedOutput + "\n";

    const completePromptTokens = counter.countSections([
      sections.executionContract,
      sections.workflow,
      sections.specification,
      sections.intelligenceContext,
      sections.compressedContext,
      sections.skills,
      sections.instructions,
      sections.task,
      sections.expectedOutput,
    ]);

    return { rendered, completePromptTokens, sections };
  }

  private renderExecutionContract(pkg: ContextPackage): string {
    const b = pkg.budget;
    return [
      `Token budget: ${b.requestedTokens}`,
      `Available context tokens: ${b.availableContextTokens}`,
      `Reserved instruction tokens: ${b.reservedInstructionTokens}`,
      `Reserved output tokens: ${b.reservedOutputTokens}`,
      `Tokenizer: ${b.tokenizerId} (${pkg.metrics.tokenizerMeasurement})`,
      `Context package: ${pkg.id} (version ${pkg.metadata.version})`,
      `Stage: ${pkg.stageId} | Execution profile: ${pkg.executionProfileId}`,
    ].join("\n");
  }

  private renderWorkflow(_pkg: ContextPackage): string {
    return "## Workflow\n- Objective (see included intent context)\n";
  }

  private renderSpecification(pkg: ContextPackage): string {
    const criteria = pkg.requiredFacts.filter((f) => f.category === "acceptance-criterion");
    return [
      "## Specification",
      `- Required facts tracked: ${pkg.requiredFacts.length}`,
      `- Critical required facts: ${pkg.requiredFacts.filter((f) => f.critical).length}`,
      `- Acceptance criteria represented: ${criteria.length}`,
      pkg.coverage.unresolvedRequiredFacts.length
        ? `- UNRESOLVED required facts: ${pkg.coverage.unresolvedRequiredFacts.join(", ")}`
        : "- All required facts are represented.",
    ].join("\n");
  }

  private renderIntelligence(pkg: ContextPackage): string {
    const relevant = pkg.items.filter(
      (i) =>
        i.sourceType === "symbol" ||
        i.sourceType === "call-flow" ||
        i.sourceType === "data-flow" ||
        i.sourceType === "dependency",
    );
    return (
      "## Repository Intelligence\n" +
      (relevant.length
        ? relevant.map((i) => `- ${i.title} (${i.contentMode})`).join("\n") + "\n"
        : "- (none)\n")
    );
  }

  private renderCompressedContext(pkg: ContextPackage): string {
    const lines: string[] = ["## Compressed Context"];
    for (const section of pkg.sections) {
      lines.push(`\n### ${section.title} (${section.group}, ${section.tokenCount} tokens)`);
      for (const itemId of section.itemIds) {
        const item = pkg.items.find((i) => i.id === itemId);
        if (item) lines.push(this.renderItem(item));
      }
    }
    if (pkg.exclusions.length) {
      lines.push("\n### Excluded Context");
      for (const ex of pkg.exclusions)
        lines.push(
          `- [excluded:${ex.reason}] ${ex.item.title} (-${ex.tokensRemoved} tokens${ex.restorable ? ", restorable" : ""})`,
        );
    }
    return lines.join("\n") + "\n";
  }

  private renderItem(item: ContextItem): string {
    const mode =
      item.contentMode === "summary" ||
      item.contentMode === "contract" ||
      item.contentMode === "signature"
        ? ` [${item.contentMode}${item.compressionStrategy ? ":" + item.compressionStrategy : ""}]`
        : "";
    const detail =
      item.structuralSummary && item.contentMode !== "summary"
        ? `\n  Summary: ${item.structuralSummary}`
        : "";
    return `- ${item.title}${mode} (${item.tokenCount} tokens): ${item.content}${detail}`;
  }

  private renderList(title: string, names: string[]): string {
    if (!names.length) return `## ${title}\n- None selected\n`;
    return `## ${title}\n` + names.map((n) => `- ${n}`).join("\n") + "\n";
  }

  private renderTask(_pkg: ContextPackage): string {
    return "## Task\n- Execute the approved work item using the included context. Do not modify files outside the represented scope.\n";
  }

  private renderExpectedOutput(pkg: ContextPackage): string {
    return `## Expected Output\n- Required output contract for stage '${pkg.stageId}'.\n- Reserved output tokens: ${pkg.budget.reservedOutputTokens}\n`;
  }
}
