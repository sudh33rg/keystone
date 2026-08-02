import { describe, expect, it } from "../../../support/testkit";

import {
  formatParsedValidationSummary,
  parseValidationOutput
} from "@core/workflow/validation/validationParser";

describe("parseValidationOutput", () => {
  it("extracts vitest-style passed test counts", () => {
    const summary = parseValidationOutput("Test Files  2 passed\nTests  4 passed", "");

    expect(summary.testsPassed).toBe(4);
    expect(formatParsedValidationSummary(summary)).toContain("testsPassed=4");
  });

  it("extracts errors from stderr", () => {
    const summary = parseValidationOutput("", "Error: failed to compile\nTraceback line");

    expect(summary.errors).toEqual(["Error: failed to compile", "Traceback line"]);
    expect(formatParsedValidationSummary(summary)).toContain("errors=2");
  });

  it("extracts jest-style suite, test, and snapshot counts", () => {
    const summary = parseValidationOutput(
      [
        "Test Suites: 1 failed, 3 passed, 4 total",
        "Tests:       2 failed, 18 passed, 20 total",
        "Snapshots:   1 failed, 5 passed, 6 total"
      ].join("\n"),
      ""
    );

    expect(summary).toMatchObject({
      testSuitesFailed: 1,
      testSuitesPassed: 3,
      testsFailed: 2,
      testsPassed: 18,
      snapshotsFailed: 1,
      snapshotsPassed: 5
    });
  });

  it("extracts pytest summary counts", () => {
    const summary = parseValidationOutput(
      "===== 2 failed, 10 passed, 1 skipped, 3 errors in 1.23s =====",
      ""
    );

    expect(summary).toMatchObject({
      testsFailed: 2,
      testsPassed: 10,
      testsSkipped: 1,
      testsErrored: 3
    });
    expect(formatParsedValidationSummary(summary)).toContain("testsErrored=3");
  });

  it("extracts Go test package and test counts", () => {
    const summary = parseValidationOutput(
      [
        "--- PASS: TestLogin (0.01s)",
        "--- FAIL: TestLogout (0.02s)",
        "ok   example.com/app/auth 0.10s",
        "FAIL example.com/app/session 0.03s"
      ].join("\n"),
      ""
    );

    expect(summary).toMatchObject({
      testsPassed: 1,
      testsFailed: 1,
      testSuitesPassed: 1,
      testSuitesFailed: 1
    });
  });

  it("extracts cargo test result counts", () => {
    const summary = parseValidationOutput(
      "test result: FAILED. 8 passed; 2 failed; 0 ignored; 0 measured; 1 filtered out;",
      ""
    );

    expect(summary).toMatchObject({
      testsPassed: 8,
      testsFailed: 2,
      testsSkipped: 1
    });
  });

  it("extracts Maven Surefire counts", () => {
    const summary = parseValidationOutput("Tests run: 12, Failures: 1, Errors: 2, Skipped: 3", "");

    expect(summary).toMatchObject({
      testsPassed: 6,
      testsFailed: 1,
      testsErrored: 2,
      testsSkipped: 3
    });
  });

  it("extracts ESLint and TypeScript compiler counts", () => {
    const summary = parseValidationOutput(
      "x 3 problems (2 errors, 1 warning)\nFound 4 errors in 3 files.",
      ""
    );

    expect(summary).toMatchObject({
      lintErrors: 2,
      lintWarnings: 1,
      typeErrors: 4
    });
    expect(formatParsedValidationSummary(summary)).toContain("typeErrors=4");
  });
});
