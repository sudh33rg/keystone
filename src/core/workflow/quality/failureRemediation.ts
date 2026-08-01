import { classifyFailure, type FailureClassification } from './generation';

export type FailureRemediationKind = 'product-defect' | 'test-defect' | 'flaky-test' | 'environment' | 'unknown';
export interface FailureRemediationInput { testPath: string; testCode?: string; failureMessage: string; failureStackTrace?: string; }
export interface FailureRemediationProposal {
  id: string;
  kind: FailureRemediationKind;
  confidence: number;
  summary: string;
  evidence: string[];
  recommendedActions: string[];
  copilotPrompt: string;
  requiresUserApproval: true;
}

/**
 * Produces evidence-backed remediation guidance only. Keystone never edits or
 * deletes tests automatically; implementation is delegated to Copilot after
 * explicit user approval and must pass the SDLC validation gate.
 */
export function planFailureRemediation(input: FailureRemediationInput): FailureRemediationProposal {
  const classification = classifyFailure({ failureMessage: input.failureMessage, failureStackTrace: input.failureStackTrace, testFile: input.testPath, testCode: input.testCode ?? '' });
  const kind = mapKind(classification);
  const confidence = Math.max(0.2, Math.min(0.95, classification.confidence ?? 0.5));
  const actions = actionsFor(kind);
  const evidence = [classification.description, input.failureMessage, input.failureStackTrace ?? 'No stack trace was provided.'].filter(Boolean);
  return {
    id: `remediation:${input.testPath}:${hashText(input.failureMessage)}`,
    kind,
    confidence,
    summary: `Investigate ${kind.replaceAll('-', ' ')} for ${input.testPath}.`,
    evidence,
    recommendedActions: actions,
    copilotPrompt: [
      `Investigate the failing test ${input.testPath}.`,
      `Classification: ${kind} (${Math.round(confidence * 100)}% confidence).`,
      `Failure: ${input.failureMessage}`,
      'Do not delete, weaken, quarantine, or modify the test without explicit approval.',
      'Identify whether the product, test, environment, or timing is responsible.',
      ...actions.map(action => `- ${action}`),
      'Return proposed changes and validation commands; do not perform Git operations.'
    ].join('\n'),
    requiresUserApproval: true
  };
}
function mapKind(value: FailureClassification): FailureRemediationKind {
  if (value.type === 'REAL_BUG') return 'product-defect';
  if (value.type === 'BROKEN_LOCATOR') return 'test-defect';
  if (value.type === 'FLAKY') return 'flaky-test';
  if (value.type === 'ENV_ISSUE') return 'environment';
  return 'unknown';
}
function actionsFor(kind: FailureRemediationKind): string[] {
  if (kind === 'product-defect') return ['Reproduce the product defect independently of the test.', 'Trace the affected implementation and impacted tests.', 'Prepare the smallest behavior-preserving fix and rerun affected validation.'];
  if (kind === 'test-defect') return ['Confirm the approved behavior and current public contract.', 'Update the test only when its expectation or selector is demonstrably obsolete.', 'Preserve regression coverage and add evidence linking the test to the acceptance criterion.'];
  if (kind === 'flaky-test') return ['Collect repeated-run evidence and isolate timing, shared-state, ordering, or network causes.', 'Prefer deterministic synchronization over retries or increased timeouts.', 'Quarantine only through an explicit, time-bounded user decision.'];
  if (kind === 'environment') return ['Capture toolchain, dependency, service, and environment differences.', 'Fix reproducibility before changing product or test behavior.', 'Rerun the unchanged test in the corrected environment.'];
  return ['Collect a minimal reproduction and complete failure evidence.', 'Classify the failure before proposing code or test changes.', 'Require user review before delegation.'];
}
function hashText(value: string): string { let hash = 2166136261; for (const char of value) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16).padStart(8, '0'); }
