import { describe, expect, it } from "../../../support/testkit";
import { planFailureRemediation } from "@core/workflow/quality/failureRemediation";

describe("failure remediation planning", () => {
  it("creates an approval-gated plan without applying or weakening tests", () => {
    const proposal = planFailureRemediation({
      testPath: "test/orders.test.ts",
      failureMessage: "Expected true but received false",
      testCode: "expect(result).toBe(true)"
    });
    expect(proposal.requiresUserApproval).toBe(true);
    expect(proposal.recommendedActions.length).toBeGreaterThan(0);
    expect(proposal.copilotPrompt).toMatch(
      /Do not delete, weaken, quarantine, or modify the test without explicit approval/
    );
    expect("fixedCode" in proposal).toBe(false);
    expect("appliedFixes" in proposal).toBe(false);
  });
});
