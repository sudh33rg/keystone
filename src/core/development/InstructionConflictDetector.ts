import { createHash } from "node:crypto";
import type { InstructionConflict } from "../../shared/contracts/executionConfiguration";

interface ConflictInput { id: string; workspaceRelativePath: string; content: string; }
interface UnavailableInput { id: string; workspaceRelativePath: string; availability: string; }

export class InstructionConflictDetector {
  detect(instructions: ConflictInput[]): InstructionConflict[] {
    const conflicts: InstructionConflict[] = [];
    for (let leftIndex = 0; leftIndex < instructions.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < instructions.length; rightIndex += 1) {
        const left = instructions[leftIndex]!; const right = instructions[rightIndex]!;
        conflicts.push(...this.compare(left, right));
      }
    }
    return conflicts;
  }

  unresolved(instructions: UnavailableInput[]): InstructionConflict[] {
    return instructions.filter((item) => item.availability !== "available").map((item) => ({
      id: conflictId("instruction-availability", [item.id]), category: "instruction-availability", state: "unresolved", severity: "error", confidence: "deterministic", instructionIds: [item.id], sourcePaths: [item.workspaceRelativePath],
      evidence: [`Instruction availability: ${item.availability}`], recommendedResolution: "Restore the instruction file or deselect it before saving the profile.",
    }));
  }

  private compare(left: ConflictInput, right: ConflictInput): InstructionConflict[] {
    const rules: Array<{ category: InstructionConflict["category"]; left: RegExp; right: RegExp; evidence: [string, string] }> = [
      { category: "test-requirement", left: /(?:must|should|always)?\s*run tests|tests? required/i, right: /do not run tests|skip tests|tests? (?:are )?not required/i, evidence: ["Requires tests", "Forbids or skips tests"] },
      { category: "output-format", left: /output (?:must be )?json|respond (?:only )?with json/i, right: /output (?:must be )?markdown|respond (?:only )?with markdown/i, evidence: ["Requires JSON output", "Requires Markdown output"] },
      { category: "file-scope", left: /only modify ([^\n.]+)/i, right: /(?:must|required to) modify ([^\n.]+)/i, evidence: ["Restricts writable file scope", "Requires a potentially excluded file category"] },
      { category: "git-policy", left: /do not (?:commit|push|merge)|never (?:commit|push|merge)/i, right: /(?:must|always) (?:commit|push|merge)/i, evidence: ["Forbids Git mutation", "Requires Git mutation"] },
      { category: "framework-rule", left: /must use ([a-z0-9_-]+)/i, right: /do not use ([a-z0-9_-]+)/i, evidence: ["Requires a framework", "Forbids a framework"] },
      { category: "naming-rule", left: /use (?:camelcase|camel case)/i, right: /use (?:snake_case|snake case)/i, evidence: ["Requires camelCase naming", "Requires snake_case naming"] },
    ];
    const result: InstructionConflict[] = [];
    for (const rule of rules) {
      const forward = rule.left.test(left.content) && rule.right.test(right.content); const reverse = rule.left.test(right.content) && rule.right.test(left.content);
      if (!forward && !reverse) continue;
      result.push({ id: conflictId(rule.category, [left.id, right.id]), category: rule.category, state: "conflict", severity: "error", confidence: "inferred", instructionIds: [left.id, right.id], sourcePaths: [left.workspaceRelativePath, right.workspaceRelativePath], evidence: rule.evidence, recommendedResolution: "Deselect one conflicting instruction or revise the actual source files, then refresh configuration." });
    }
    return result;
  }
}

function conflictId(category: string, ids: string[]): string { return `conflict:${createHash("sha256").update(`${category}:${[...ids].sort().join(":")}`).digest("hex").slice(0, 24)}`; }
