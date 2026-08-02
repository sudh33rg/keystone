import { describe, expect, it } from "../../../support/testkit";
import { SDLCEngine, type SDLCPlan, type SDLCStory } from "@core/workflow/sdlc/engine";

function story(plan: SDLCPlan, type: SDLCStory["type"]): SDLCStory {
  return plan.stories.find((item) => item.type === type)!;
}

function completeReadyStory(engine: SDLCEngine, plan: SDLCPlan, type: SDLCStory["type"]): SDLCPlan {
  let current = story(plan, type);
  plan = engine.transition(plan, current.id, "in-progress");
  current = story(plan, type);
  if (["development", "new-test-creation"].includes(type)) {
    plan = engine.prepareDelegation(plan, current.id, {
      agent: "GitHub Copilot",
      skills: ["implementation"],
      instructions: ["Follow the approved specification"],
      prompt: `Complete ${type}`,
      contextPackId: `context-${type}`
    });
    plan = engine.approveDelegation(plan, current.id);
    plan = engine.completeDelegation(plan, current.id, [
      `Copilot delegation for ${type} returned for review.`
    ]);
  } else {
    plan = engine.transition(plan, current.id, "awaiting-validation");
  }
  current = story(plan, type);
  if (!["research", "design", "documentation", "completion"].includes(type)) {
    plan = engine.recordValidation(plan, current.id, {
      status: "passed",
      commands: [`verify:${type}`],
      evidence: [`Passing validation evidence for ${type}.`]
    });
  }
  current = story(plan, type);
  return engine.transition(plan, current.id, "completed", {
    evidence: [`Completion evidence for ${type}.`],
    satisfiedCriteria: current.acceptanceCriteria
  });
}

describe("SDLCEngine", () => {
  it("unlocks specification and design through evidence-backed approvals", () => {
    const engine = new SDLCEngine();
    let plan = engine.createPlan("intent");
    plan = completeReadyStory(engine, plan, "research");
    expect(story(plan, "specification").status).toBe("ready");
    plan = engine.approveSpecification(plan);
    expect(story(plan, "design").status).toBe("ready");
  });

  it("creates presentable R&D documentation and small user/quality stories before execution", () => {
    const engine = new SDLCEngine();
    let plan = engine.createPlan("Add audit history to order updates.", {
      relevantFiles: ["src/orders/service.ts"],
      relevantSymbols: ["updateOrder"],
      relatedTests: ["tests/orders.test.ts"],
      missingTests: ["audit regression test"],
      qaChecklist: ["Audit entries are persisted and tested."],
      securityRisk: "medium",
      performanceRisk: "low",
      architecture: "layered service",
      source: { kind: "valueedge", featureId: "42", featureName: "Order auditing" }
    });
    expect(plan.researchDocument.markdown).toMatch(/Repository Evidence/);
    expect(plan.researchDocument.markdown).toMatch(/src\/orders\/service\.ts/);
    expect(plan.backlogStories.filter((item) => item.kind === "user-story").length).toBeGreaterThan(
      0
    );
    expect(
      plan.backlogStories.filter((item) => item.kind === "quality-story").length
    ).toBeGreaterThan(0);
    expect(plan.backlogStories.every((item) => item.evidence.length > 0)).toBe(true);
    expect(plan.source.kind).toBe("valueedge");
    plan = completeReadyStory(engine, plan, "research");
    plan = engine.approveSpecification(plan);
    expect(plan.backlogStories.every((item) => item.status === "approved")).toBe(true);
  });

  it("executes the complete 16-story intent-led SDLC with approvals, delegation, validation, findings, and read-only PR review", () => {
    const engine = new SDLCEngine();
    let plan = engine.createPlan("Implement an evidence-backed feature safely.");
    plan = completeReadyStory(engine, plan, "research");
    plan = engine.approveSpecification(plan);

    const order: SDLCStory["type"][] = [
      "design",
      "development",
      "existing-test-analysis",
      "test-impact-analysis",
      "new-test-creation",
      "failed-test-investigation",
      "flaky-test-analysis",
      "security-review",
      "performance-review",
      "modernization-review",
      "code-review",
      "pr-review",
      "documentation",
      "completion"
    ];

    for (const type of order) {
      const ready = story(plan, type);
      expect(ready.status).toBe("ready");
      if (type === "security-review") {
        plan = engine.transition(plan, ready.id, "in-progress");
        plan = engine.recordFinding(plan, ready.id, {
          kind: "security",
          severity: "high",
          summary: "Authorization edge requires review.",
          status: "open",
          evidence: ["okf:evidence:security"]
        });
        const finding = story(plan, type).findings[0]!;
        plan = engine.resolveFinding(plan, ready.id, finding.id, "resolved");
        plan = engine.transition(plan, ready.id, "awaiting-validation");
        plan = engine.recordValidation(plan, ready.id, {
          status: "passed",
          commands: ["security-check"],
          evidence: ["Security check passed."]
        });
        const updated = story(plan, type);
        plan = engine.transition(plan, ready.id, "completed", {
          evidence: ["Security review complete."],
          satisfiedCriteria: updated.acceptanceCriteria
        });
      } else {
        plan = completeReadyStory(engine, plan, type);
      }
    }

    expect(plan.stories).toHaveLength(16);
    expect(engine.isComplete(plan)).toBe(true);
    expect(story(plan, "development").delegation?.status).toBe("completed");
    expect(story(plan, "security-review").findings[0]?.status).toBe("resolved");
    expect(story(plan, "pr-review").evidence.join(" ")).toMatch(
      /read-only|Completion evidence|validation/i
    );
  });

  it("blocks completion when criteria, validation, blockers, or severe findings are unresolved", () => {
    const engine = new SDLCEngine();
    let plan = engine.createPlan("intent");
    const research = story(plan, "research");
    plan = engine.transition(plan, research.id, "in-progress");
    plan = engine.transition(plan, research.id, "awaiting-validation");
    expect(() =>
      engine.transition(plan, research.id, "completed", { evidence: ["Only evidence"] })
    ).toThrow();
  });
});
