import type { SkillDefinition } from "../../shared/contracts/executionConfiguration";
import { createHash } from "node:crypto";

/**
 * The single Test Generation skill created in Phase 8. It instructs the
 * external assistant or developer to implement only approved scenarios, follow
 * the detected framework, reuse repository conventions, avoid production-code
 * changes, and avoid deletion/skipping/assertion weakening/arbitrary waits.
 */
export const TEST_GENERATION_SKILL_FRAGMENT = `# Keystone Test Generation

You implement NEW tests for a coverage gap that Keystone has identified. You
MUST follow these constraints exactly. Do not deviate.

## Hard constraints

1. Implement ONLY the approved test scenarios. Do not add scenarios the user
   did not approve.
2. Follow the detected test framework and reuse the repository's existing test
   conventions (file layout, naming, assertion style, fixtures).
3. Do NOT modify production source code. Tests may only add or modify test
   files, fixtures, or bounded mocks.
4. Do NOT delete or skip tests (.skip, xit, xdescribe, describe.skip, todo).
5. Do NOT weaken or remove assertions. Keep assertions specific and meaningful.
6. Do NOT insert arbitrary fixed sleeps or unbounded retries. If you need to
   wait, use a deterministic polling mechanism with an explicit timeout.
7. List every test file you created or modified.
8. Explain the fixtures, mocks, and assumptions you relied on.
9. Provide the EXACT test commands to run (single test, then related file).
10. Report any unresolved gaps honestly. Do not claim coverage you did not add.

## Required structured output

Return exactly this structure:

1. Summary
2. Scenarios implemented
3. Proposed file changes (file path, change type, diff)
4. Assumptions
5. Tests to run
6. Unresolved issues

Do not claim automatic code parsing unless Keystone has implemented it.`;

export const TEST_GENERATION_SKILL: SkillDefinition = {
  id: "keystone-test-generation",
  name: "Test Generation",
  description: "Generate new tests for an approved coverage gap without modifying production code.",
  applicableStageTypes: ["qa", "test-generation"],
  promptFragment: TEST_GENERATION_SKILL_FRAGMENT,
  expectedOutput: {
    summaryRequired: true,
    changedFilesRequired: true,
    testsRequired: true,
    assumptionsRequired: true,
  },
  source: "keystone-built-in",
  contentHash: createHash("sha256").update(TEST_GENERATION_SKILL_FRAGMENT).digest("hex"),
  version: 1,
};

export const TEST_HEALING_SKILL_FRAGMENT = `# Keystone Test Healing

You propose a BOUNDED change to a test, fixture, or mock when Keystone has
classified a test failure as a test-side defect (fixture, mock, stale
expectation) or confirmed flakiness. You MUST follow these constraints.

## Hard constraints

1. Preserve intended behaviour. Do not delete, skip, or weaken the test.
2. Distinguish a production defect from a test defect. If the failure is a
   production defect, do NOT propose a test change — escalate to Development.
3. Change ONLY approved test, fixture, or mock files.
4. Avoid arbitrary waits and unbounded retries. Use deterministic polling.
5. Explain the root cause in plain language.
6. Provide validation commands.
7. Report remaining uncertainty honestly.

## Required structured output

1. Diagnosis
2. Proposed correction
3. Files changed
4. Why assertions remain valid
5. Validation commands
6. Remaining uncertainty

Do not ask the agent to "make tests pass." Fix the test defect, not the signal.`;

export function testHealingSkill(): SkillDefinition {
  return {
    id: "keystone-test-healing",
    name: "Test Healing",
    description: "Propose a bounded test-side remediation for a classified test defect or confirmed flakiness.",
    applicableStageTypes: ["qa", "test-remediation"],
    promptFragment: TEST_HEALING_SKILL_FRAGMENT,
    expectedOutput: {
      summaryRequired: true,
      changedFilesRequired: true,
      testsRequired: true,
      assumptionsRequired: true,
    },
    source: "keystone-built-in",
    contentHash: createHash("sha256").update(TEST_HEALING_SKILL_FRAGMENT).digest("hex"),
    version: 1,
  };
}
