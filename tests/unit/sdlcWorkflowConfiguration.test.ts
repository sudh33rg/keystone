import assert from "node:assert/strict";
import test from "node:test";

import { SDLCEngine } from "@core/workflow/sdlc/engine";

test("a plan persists its selected workflow stages and omits unselected phases", () => {
  const plan = new SDLCEngine().createPlan("Add saved search", {
    enabledStages: ["discovery", "development", "testing"]
  });

  assert.deepEqual(plan.workflow.enabledStages, ["discovery", "development", "testing"]);
  assert.ok(plan.discoveryDocument);
  assert.ok(plan.backlogStories.some((story) => story.kind === "user-story"));
  assert.ok(plan.backlogStories.some((story) => story.kind === "quality-story"));
  assert.ok(plan.stories.every((story) => !["research", "specification", "design", "pr-review"].includes(story.type)));
  assert.ok(plan.stories.some((story) => story.type === "discovery-generation"));
  assert.ok(plan.stories.some((story) => story.type === "user-story-generation"));
  assert.ok(plan.stories.some((story) => story.type === "qa-story-generation"));
});

test("discovery artifacts are not generated when Discovery is excluded", () => {
  const plan = new SDLCEngine().createPlan("Fix validation", {
    enabledStages: ["planning", "development"]
  });

  assert.equal(plan.discoveryDocument, undefined);
  assert.deepEqual(plan.backlogStories, []);
  assert.ok(plan.stories.every((story) => !story.type.includes("story-generation")));
});

test("generated stories require an explicit approval separate from specification approval", () => {
  const engine = new SDLCEngine();
  const created = engine.createPlan("Add saved search");
  const approved = engine.approveBacklogStories(created);

  assert.equal(created.backlogApproval.status, "pending");
  assert.ok(created.backlogStories.every((story) => story.status === "draft"));
  assert.equal(approved.backlogApproval.status, "approved");
  assert.ok(approved.backlogStories.every((story) => story.status === "approved"));
});
