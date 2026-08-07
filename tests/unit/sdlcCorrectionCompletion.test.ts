import assert from "node:assert/strict";
import test from "node:test";

import { SDLCEngine, type SDLCPlan } from "@core/workflow/sdlc/engine";

test("a passed correction completes only a story that satisfies the normal SDLC contract", () => {
  const engine = new SDLCEngine();
  const created = engine.createPlan("Fix the order validation regression");
  const target = created.stories.find((story) => story.type === "development")!;
  const plan: SDLCPlan = {
    ...created,
    stories: created.stories.map((story) =>
      story.id === target.id
        ? {
            ...story,
            status: "awaiting-validation",
            satisfiedCriteria: [...story.acceptanceCriteria],
            evidence: ["Implementation and correction evidence"],
            delegation: {
              id: "delegation-1",
              status: "completed",
              agent: "GitHub Copilot",
              skills: [],
              instructions: [],
              promptHash: "prompt",
              correctionPacketId: "correction-1"
            },
            validationRuns: [
              {
                id: "validation-1",
                status: "passed",
                commands: ["npm test"],
                evidence: ["npm test: passed"],
                completedAt: new Date().toISOString()
              }
            ]
          }
        : story
    )
  };

  const completed = engine.finalizePassedCorrection(plan, target.id);
  assert.equal(completed.completed, true);
  assert.equal(completed.plan.stories.find((story) => story.id === target.id)?.status, "completed");

  const missingCriteria = {
    ...plan,
    stories: plan.stories.map((story) =>
      story.id === target.id ? { ...story, satisfiedCriteria: [] } : story
    )
  };
  const retained = engine.finalizePassedCorrection(missingCriteria, target.id);
  assert.equal(retained.completed, false);
  assert.match(retained.reason ?? "", /Acceptance criteria are not satisfied/);
});
