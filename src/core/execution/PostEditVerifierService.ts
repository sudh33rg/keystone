import type { PostEditVerificationResult } from "../../shared/contracts/postEditVerification";

// ---------------------------------------------------------------------------
// Deterministic post-edit verifier.
// Borrowed structure from the old Keystone orchestrator surface, stripped to
// additive helpers only. No legacy orchestrator/runtime dependencies.
// ---------------------------------------------------------------------------

export interface VerificationOutcome {
  signal: string;
  passed: boolean;
  details: string;
}

export interface PostEditVerificationContext {
  output: string;
  originalCode?: string;
  affectedFiles?: string[];
  completionCriteria?: readonly string[];
  nonGoals?: readonly string[];
}

export class PostEditVerifierService {
  verify(
    input: PostEditVerificationContext & { postEditVerifier: boolean },
  ): PostEditVerificationResult {
    const output = input.output.trim();
    const signals: VerificationOutcome[] = [];

    if (!input.postEditVerifier) {
      return { passed: true, signals, verdict: "satisfied" } as PostEditVerificationResult;
    }

    signals.push(this.checkOutputPresent(output));
    signals.push(this.checkBalancedBraces(output));
    signals.push(this.checkBalancedParens(output));
    signals.push(this.checkBalancedDoubleQuotes(output));

    if (input.completionCriteria?.length) {
      signals.push(this.checkCompletionCriteria(input.completionCriteria, output));
    }

    if (input.nonGoals?.length) {
      signals.push(this.checkNonGoals(input.nonGoals, output, input.affectedFiles));
    }

    if (input.originalCode && output) {
      signals.push(this.checkBehaviorPreservation(input.originalCode, output));
    }

    const allPassed = signals.every((signal) => signal.passed);
    const needsRevision = signals.some(
      (signal) => !signal.passed && !signal.details.includes("FATAL"),
    );
    const failed = !allPassed && !needsRevision;

    return {
      passed: allPassed,
      signals,
      verdict: allPassed ? "satisfied" : needsRevision ? "needs_revision" : "failed",
    } as PostEditVerificationResult;
  }

  private checkOutputPresent(output: string): VerificationOutcome {
    if (output.length) {
      return { signal: "output-present", passed: true, details: "Output is present." };
    }
    return { signal: "output-present", passed: false, details: "Empty output." };
  }

  private checkBalancedBraces(output: string): VerificationOutcome {
    const open = (output.match(/\{/g) || []).length;
    const close = (output.match(/\}/g) || []).length;
    if (open === close) {
      return { signal: "balanced-braces", passed: true, details: "Braces are balanced." };
    }
    return {
      signal: "balanced-braces",
      passed: false,
      details: `Unmatched braces: ${open} open, ${close} close.`,
    };
  }

  private checkBalancedParens(output: string): VerificationOutcome {
    const open = (output.match(/\(/g) || []).length;
    const close = (output.match(/\)/g) || []).length;
    if (open === close) {
      return { signal: "balanced-parens", passed: true, details: "Parentheses are balanced." };
    }
    return {
      signal: "balanced-parens",
      passed: false,
      details: `Unmatched parentheses: ${open} open, ${close} close.`,
    };
  }

  private checkBalancedDoubleQuotes(output: string): VerificationOutcome {
    const count = (output.match(/"/g) || []).length;
    if (count % 2 === 0) {
      return { signal: "balanced-quotes", passed: true, details: "Double quotes are balanced." };
    }
    return {
      signal: "balanced-quotes",
      passed: false,
      details: `Unmatched double quotes: ${count} found.`,
    };
  }

  private checkCompletionCriteria(
    criteria: readonly string[],
    output: string,
  ): VerificationOutcome {
    const loweredOutput = output.toLowerCase();
    const unmet = criteria.filter((criterion) => !loweredOutput.includes(criterion.toLowerCase()));
    if (!unmet.length) {
      return { signal: "completion-criteria", passed: true, details: "All criteria satisfied." };
    }
    return {
      signal: "completion-criteria",
      passed: false,
      details: `${unmet.length} criteria not met: ${unmet.join(", ")}.`,
    };
  }

  private checkNonGoals(
    nonGoals: readonly string[],
    output: string,
    affectedFiles?: string[],
  ): VerificationOutcome {
    const loweredOutput = output.toLowerCase();
    const violated = new Set<string>();

    for (const nonGoal of nonGoals) {
      if (loweredOutput.includes(nonGoal.toLowerCase())) {
        violated.add(nonGoal);
      }
      if (affectedFiles) {
        for (const file of affectedFiles) {
          if (nonGoal.toLowerCase().includes(file.toLowerCase())) {
            violated.add(`${nonGoal} (file: ${file})`);
          }
        }
      }
    }

    if (!violated.size) {
      return { signal: "non-goals", passed: true, details: "No non-goal violations." };
    }
    return {
      signal: "non-goals",
      passed: false,
      details: `${violated.size} non-goal violation(s): ${[...violated].join("; ")}.`,
    };
  }

  private checkBehaviorPreservation(
    originalCode: string,
    generatedCode: string,
  ): VerificationOutcome {
    const originalFunctions = this.extractFunctionNames(originalCode);
    const modifiedFunctions = this.extractFunctionNames(generatedCode);
    const missing = originalFunctions.filter((fn) => !modifiedFunctions.includes(fn));
    if (!missing.length) {
      return {
        signal: "behavior-preservation",
        passed: true,
        details: "All original function signatures preserved.",
      };
    }
    return {
      signal: "behavior-preservation",
      passed: false,
      details: `Missing functions: ${missing.join(", ")}.`,
    };
  }

  private extractFunctionNames(code: string): string[] {
    const names = new Set<string>();
    const patterns = [
      /\bfunction\s+([A-Za-z_$][\w$]*)\b/g,
      /\b([A-Za-z_$][\w$]*)\s*\(/g,
      /\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/g,
    ];

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(code)) !== null) {
        const name = match[1];
        if (name && !["if", "for", "while", "switch", "catch", "return", "new"].includes(name)) {
          names.add(name);
        }
      }
    }

    return [...names];
  }
}
