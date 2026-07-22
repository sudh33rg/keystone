import { createHash } from "node:crypto";
import type { SkillDefinition } from "../../shared/contracts/executionConfiguration";
import { TEST_GENERATION_SKILL } from "../impactQa/TestGenerationSkill";

export class DevelopmentSkillError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "DevelopmentSkillError"; }
}

export class DevelopmentSkillService {
  builtInDevelopmentSkill(): SkillDefinition {
    return this.withHash({
      id: "keystone-development", name: "Development", description: "Implement the selected Development objective within its real source scope and report the work performed.", applicableStageTypes: ["development"],
      promptFragment: [
        "Implement only the stated objective.", "Stay within the selected source scope unless it is insufficient; ask before expanding it.", "Identify assumptions and list files changed.",
        "Describe the main implementation decisions.", "List tests actually run.", "Report unresolved issues.", "Do not commit, push, merge, or create a pull request.",
      ].join("\n"),
      expectedOutput: { summaryRequired: true, changedFilesRequired: true, testsRequired: true, assumptionsRequired: true }, source: "keystone-built-in", contentHash: "0".repeat(64), version: 1,
    });
  }

  /** Phase 8 — bounded Test Generation skill used by the QA test-intelligence flow. */
  builtInTestGenerationSkill(): SkillDefinition {
    return this.withHash(TEST_GENERATION_SKILL);
  }

  withHash(skill: SkillDefinition): SkillDefinition {
    const content = JSON.stringify({ id: skill.id, name: skill.name, description: skill.description, applicableStageTypes: skill.applicableStageTypes, promptFragment: skill.promptFragment, expectedOutput: skill.expectedOutput, source: skill.source, version: skill.version });
    return { ...skill, contentHash: createHash("sha256").update(content).digest("hex") };
  }

  list(definitions: SkillDefinition[], allowedStageTypes: string[] = ["development", "qa"]): SkillDefinition[] {
    const names = new Set<string>();
    for (const skill of definitions) { const key = skill.name.trim().toLowerCase(); if (names.has(key)) throw new DevelopmentSkillError("skill-duplicate", `Duplicate skill name: ${skill.name}`); names.add(key); }
    return definitions.filter((skill) => skill.applicableStageTypes.some((stage) => allowedStageTypes.includes(stage)));
  }

  require(definitions: SkillDefinition[], id: string, allowedStageTypes: string[] = ["development", "qa"]): SkillDefinition {
    const skill = this.list(definitions, allowedStageTypes).find((item) => item.id === id);
    if (!skill) throw new DevelopmentSkillError("skill-not-found", "The selected skill was not found.");
    return skill;
  }
}
