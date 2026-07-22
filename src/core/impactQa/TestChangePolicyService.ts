import { randomUUID } from "node:crypto";
import type {
  PolicyAssessment,
  PolicyFinding,
  ProposedFileChange,
} from "../../shared/contracts/phase8TestIntelligence";

export interface PolicyCheckInput {
  proposalId: string;
  changes: ProposedFileChange[];
  /** Approved requirement evidence, used to permit expected-value changes. */
  approvedRequirementEvidence?: boolean;
  /** Whether the change is a remediation (vs generated test) — affects some rules. */
  isRemediation: boolean;
}

const BLOCKING_RULES = {
  testDeletion: "policy-test-deletion",
  testSkip: "policy-test-skip",
  assertionWeakening: "policy-assertion-weakening",
  timeoutIncrease: "policy-timeout-increase",
  arbitraryWait: "policy-arbitrary-wait",
  unboundedRetry: "policy-unbounded-retry",
  productionChange: "policy-production-change",
  configurationChange: "policy-production-change",
  outsideWorkspace: "proposal-path-outside-workspace",
  unrelatedChange: "proposal-source-conflict",
  snapshotUnrelated: "proposal-source-conflict",
  removingFailureExpectation: "policy-assertion-weakening",
  swallowingException: "policy-assertion-weakening",
} as const;

/**
 * Deterministic policy inspection for proposed test changes. Never silently
 * rewrites a blocked proposal; it reports every finding with rule, severity,
 * file, affected lines, evidence, and a recommended action.
 */
export class TestChangePolicyService {
  private readonly now: () => string;
  private readonly createId: () => string;

  constructor(now: () => string = () => new Date().toISOString(), createId: () => string = randomUUID) {
    this.now = now;
    this.createId = createId;
  }

  assess(input: PolicyCheckInput): PolicyAssessment {
    const findings: PolicyFinding[] = [];
    for (const change of input.changes) {
      this.inspectChange(change, input, findings);
    }
    const blocking = findings.some((f) => f.severity === "blocking");
    const needsReview = findings.some((f) => f.severity === "warning");
    return {
      id: this.createId(),
      status: blocking ? "blocked" : needsReview ? "needs-review" : "allowed",
      findings,
      createdAt: this.now(),
    };
  }

  private inspectChange(change: ProposedFileChange, input: PolicyCheckInput, findings: PolicyFinding[]): void {
    const path = change.filePath;
    const classification = change.classification;

    // Delete / rename of generated tests is blocked by default.
    if (change.changeType === "delete") {
      if (classification === "test" || classification === "fixture" || classification === "mock") {
        this.push(findings, change, BLOCKING_RULES.testDeletion, "blocking", "Deleting tests, fixtures, or mocks is blocked by default. Healing must not remove coverage.");
        return;
      }
      if (classification === "production" || classification === "configuration") {
        this.push(findings, change, BLOCKING_RULES.productionChange, "blocking", "Deleting production or configuration files is blocked.");
        return;
      }
      this.push(findings, change, BLOCKING_RULES.unrelatedChange, "blocking", "Deletion of unrelated files is blocked.");
      return;
    }

    if (change.changeType === "rename") {
      this.push(findings, change, BLOCKING_RULES.unrelatedChange, "blocking", "Renaming generated test files is blocked by default.");
      return;
    }

    // Production / configuration modifications are blocked by default.
    if (classification === "production") {
      this.push(findings, change, BLOCKING_RULES.productionChange, "blocking", "Modifying production code is blocked. Route product defects to Development.");
      return;
    }
    if (classification === "configuration") {
      this.push(findings, change, BLOCKING_RULES.configurationChange, "blocking", "Modifying configuration is blocked by default.");
      return;
    }

    // Outside workspace / unknown path.
    if (classification === "unknown" || !isWorkspaceRelative(path)) {
      this.push(findings, change, BLOCKING_RULES.outsideWorkspace, "blocking", "Change path is outside the workspace or unclassifiable.");
      return;
    }

    const diff = change.diff ?? "";
    // Skip markers.
    if (/\b\.(skip|x|xtest|todo|only)\b|\bskip\(|\bdescribe\.skip|\bit\(|\btest\.skip/.test(diff) || /\bxtest\b|\bxdescribe\b/.test(path)) {
      this.push(findings, change, BLOCKING_RULES.testSkip, "blocking", "Adding skip/disable markers (.skip, xit, xdescribe, todo, only) is blocked by default.");
      return;
    }

    // Arbitrary sleeps.
    if (/\b(setTimeout|sleep|waitForTimeout|delay)\s*\(\s*\d+\s*\)|\bawait\s+(new\s+)?Promise\s*\(\s*\(_?res\w*\)\s*=>\s*setTimeout/.test(diff)) {
      // A bounded deterministic polling-with-timeout is allowed only when explicit.
      if (!/poll|waitUntil|waitForFunction|retry.*timeout/i.test(diff)) {
        this.push(findings, change, BLOCKING_RULES.arbitraryWait, "blocking", "Inserting a fixed sleep is blocked. Use deterministic polling with a bound instead.");
        return;
      }
    }

    // Unbounded retry.
    if (/\.(retry|flaky)\s*\(|for\s*\(\s*let\s+\w*\s*=\s*0;\s*\w*\s*<\s*Infinity/.test(diff) || /retry\([^)]*\)/.test(diff) && !/\b(retries|retry)\s*[:=]\s*\d+/.test(diff)) {
      this.push(findings, change, BLOCKING_RULES.unboundedRetry, "blocking", "Adding an unbounded retry is blocked. Use a bounded retry with a fixed count.");
      return;
    }

    // Timeout increase without evidence.
    const timeoutMatch = diff.match(/timeout\s*[:=]\s*(\d+)/i) ?? diff.match(/setTimeout\([^,]*,\s*(\d+)/);
    if (timeoutMatch) {
      const value = Number(timeoutMatch[1]);
      if (value > 5000 && !input.approvedRequirementEvidence) {
        this.push(findings, change, BLOCKING_RULES.timeoutIncrease, "blocking", "Increasing a timeout beyond 5000ms without requirement evidence is blocked.");
        return;
      }
    }

    // Assertion weakening — replacing specific assertions with broad truthy checks,
    // removing assertions, removing failure expectations, swallowing exceptions.
    if (assertionWeakeningDetected(diff)) {
      this.push(findings, change, BLOCKING_RULES.assertionWeakening, "blocking", "Assertion weakening, removal, or exception swallowing is blocked. Assertions must remain meaningful.");
      return;
    }

    // Snapshot changes require explicit evidence / review.
    if (classification === "snapshot" && !input.approvedRequirementEvidence) {
      this.push(findings, change, BLOCKING_RULES.snapshotUnrelated, "warning", "Snapshot changes require explicit review tied to approved behaviour.");
      return;
    }

    // Allowed-with-review: new test file, new test case, fixture, bounded mock,
    // deterministic polling. Mark as info-level so the UI shows it was reviewed.
    if (change.changeType === "create" && classification === "test") {
      this.push(findings, change, "allowed-create-test", "info", "Creating a new test file is allowed after review.");
      return;
    }
    if (classification === "fixture" || classification === "mock") {
      this.push(findings, change, "allowed-fixture-or-mock", "info", "Updating a fixture or adding a bounded mock is allowed after review.");
      return;
    }
    if (change.changeType === "modify" && classification === "test") {
      // A genuine new requirement change is allowed but flagged for explicit review.
      this.push(findings, change, "allowed-test-modify", input.approvedRequirementEvidence ? "info" : "warning", input.approvedRequirementEvidence ? "Modifying a test for an approved new requirement is allowed." : "Modifying an existing test requires requirement evidence or explicit review.");
      return;
    }
  }

  private push(
    findings: PolicyFinding[],
    change: ProposedFileChange,
    rule: string,
    severity: PolicyFinding["severity"],
    recommendedAction: string,
  ): void {
    findings.push({
      id: this.createId(),
      rule,
      severity,
      file: change.filePath,
      affectedLines: affectedLines(change.diff),
      evidence: `Proposal change ${change.id} (${change.changeType}/${change.classification}).`,
      recommendedAction,
      changeId: change.id,
    });
  }
}

function assertionWeakeningDetected(diff: string): boolean {
  const removedAssertion = /^-.*(expect\(|assert\(|toStrictEqual|toEqual|toBe|should\.|assertThat)/.test(diff);
  if (removedAssertion) return true;
  // Replacing a specific assertion with a broad truthy check.
  if (/expect\([^)]*\)\.(toBeTruthy|toBeDefined|toBeOk|toExist)/.test(diff) && /toEqual|toStrictEqual|toBe\(false\)|toBe\(true\)|toBeNull/.test(diff)) {
    return true;
  }
  // Removing failure expectations (e.g. removing `toThrow`).
  if (/\btoThrow\b/.test(diff) === false && /^-.*\b(expect\([^)]*\)\.toThrow|rejects\.toThrow)/.test(diff)) {
    return true;
  }
  // Swallowing exceptions in tests.
  if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(diff) || /catch\s*\([^)]*\)\s*\{\s*\/\/|\}\s*\/\/\s*(ignore|swallow|noop)/.test(diff)) {
    return true;
  }
  return false;
}

function affectedLines(diff: string): string[] {
  const lines: string[] = [];
  for (const line of diff.split("\n")) {
    const m = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (m) lines.push(`+${m[1]}`);
    const lineNo = line.match(/^\+(\d+):/);
    if (lineNo) lines.push(lineNo[1]!);
  }
  return lines.slice(0, 100);
}

function isWorkspaceRelative(path: string): boolean {
  return path.length > 0 && !path.startsWith("/") && !path.startsWith("..") && !path.includes("://");
}
