export type ParsedValidationSummary = {
  testsPassed?: number;
  testsFailed?: number;
  testsSkipped?: number;
  testsErrored?: number;
  testSuitesPassed?: number;
  testSuitesFailed?: number;
  assertionsPassed?: number;
  assertionsFailed?: number;
  snapshotsPassed?: number;
  snapshotsFailed?: number;
  lintErrors?: number;
  lintWarnings?: number;
  typeErrors?: number;
  errors: string[];
};

export function parseValidationOutput(stdout: string, stderr: string): ParsedValidationSummary {
  const combined = `${stdout}\n${stderr}`;
  const pytest = parsePytestSummary(combined);
  const goTest = parseGoTestSummary(combined);
  const cargo = parseCargoTestSummary(combined);
  const maven = parseMavenSurefireSummary(combined);
  const eslint = parseEslintSummary(combined);
  const tsc = parseTypeScriptSummary(combined);

  return {
    testsPassed: firstDefined(
      readFirstNumber(combined, [
        /(\d+)\s+tests?\s+passed/i,
        /Tests:.*?(\d+)\s+passed/i,
        /Tests:\s+(\d+)\s+passed/i,
        /Tests\s+(\d+)\s+passed/i,
        /Test Files\s+\d+\s+passed.*?Tests\s+(\d+)\s+passed/is
      ]),
      pytest.testsPassed,
      goTest.testsPassed,
      cargo.testsPassed,
      maven.testsPassed
    ),
    testsFailed: firstDefined(
      readFirstNumber(combined, [
        /(\d+)\s+tests?\s+failed/i,
        /Tests:\s+(\d+)\s+failed/i,
        /Tests\s+(\d+)\s+failed/i,
        /Test Files\s+\d+\s+failed/is
      ]),
      pytest.testsFailed,
      goTest.testsFailed,
      cargo.testsFailed,
      maven.testsFailed
    ),
    testsSkipped: firstDefined(pytest.testsSkipped, cargo.testsSkipped, maven.testsSkipped),
    testsErrored: firstDefined(pytest.testsErrored, maven.testsErrored),
    testSuitesPassed: firstDefined(
      readFirstNumber(combined, [/Test Suites:.*?(\d+)\s+passed/i, /(\d+)\s+test suites?\s+passed/i]),
      goTest.testSuitesPassed
    ),
    testSuitesFailed: firstDefined(
      readFirstNumber(combined, [/Test Suites:\s+(\d+)\s+failed/i, /(\d+)\s+test suites?\s+failed/i]),
      goTest.testSuitesFailed
    ),
    assertionsPassed: readFirstNumber(combined, [/(\d+)\s+assertions?\s+passed/i]),
    assertionsFailed: readFirstNumber(combined, [/(\d+)\s+assertions?\s+failed/i]),
    snapshotsPassed: readFirstNumber(combined, [/Snapshots:.*?(\d+)\s+passed/i, /(\d+)\s+snapshots?\s+passed/i]),
    snapshotsFailed: readFirstNumber(combined, [/Snapshots:\s+(\d+)\s+failed/i, /(\d+)\s+snapshots?\s+failed/i]),
    lintErrors: eslint.lintErrors,
    lintWarnings: eslint.lintWarnings,
    typeErrors: tsc.typeErrors,
    errors: readErrorLines(combined)
  };
}

export function formatParsedValidationSummary(summary: ParsedValidationSummary): string {
  const parts = [
    formatOptionalCount("testsPassed", summary.testsPassed),
    formatOptionalCount("testsFailed", summary.testsFailed),
    formatOptionalCount("testsSkipped", summary.testsSkipped),
    formatOptionalCount("testsErrored", summary.testsErrored),
    formatOptionalCount("testSuitesPassed", summary.testSuitesPassed),
    formatOptionalCount("testSuitesFailed", summary.testSuitesFailed),
    formatOptionalCount("assertionsPassed", summary.assertionsPassed),
    formatOptionalCount("assertionsFailed", summary.assertionsFailed),
    formatOptionalCount("snapshotsPassed", summary.snapshotsPassed),
    formatOptionalCount("snapshotsFailed", summary.snapshotsFailed),
    formatOptionalCount("lintErrors", summary.lintErrors),
    formatOptionalCount("lintWarnings", summary.lintWarnings),
    formatOptionalCount("typeErrors", summary.typeErrors)
  ].filter((part): part is string => Boolean(part));

  if (summary.errors.length > 0) {
    parts.push(`errors=${summary.errors.length}`);
  }

  return parts.length > 0 ? parts.join("; ") : "No structured validation summary detected.";
}

function parsePytestSummary(value: string): Partial<ParsedValidationSummary> {
  const summaryLine = readLastMatchingLine(value, /=+\s+.*\s+in\s+[\d.]+s\s+=+/i);
  if (!summaryLine) {
    return {};
  }

  return {
    testsPassed: readFirstNumber(summaryLine, [/(\d+)\s+passed/i]),
    testsFailed: readFirstNumber(summaryLine, [/(\d+)\s+failed/i]),
    testsSkipped: readFirstNumber(summaryLine, [/(\d+)\s+skipped/i]),
    testsErrored: readFirstNumber(summaryLine, [/(\d+)\s+errors?/i])
  };
}

function parseGoTestSummary(value: string): Partial<ParsedValidationSummary> {
  const passed = countMatches(value, /^--- PASS:/gm);
  const failed = countMatches(value, /^--- FAIL:/gm);
  const packagePassed = countMatches(value, /^ok\s+\S+/gm);
  const packageFailed = countMatches(value, /^FAIL\s+\S+/gm);

  return {
    testsPassed: passed > 0 ? passed : undefined,
    testsFailed: failed > 0 ? failed : undefined,
    testSuitesPassed: packagePassed > 0 ? packagePassed : undefined,
    testSuitesFailed: packageFailed > 0 ? packageFailed : undefined
  };
}

function parseCargoTestSummary(value: string): Partial<ParsedValidationSummary> {
  const match = /test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed;(?:\s+\d+\s+ignored;)?(?:\s+\d+\s+measured;)?(?:\s+(\d+)\s+filtered out;)?/i.exec(value);
  if (!match) {
    return {};
  }

  return {
    testsPassed: Number.parseInt(match[1], 10),
    testsFailed: Number.parseInt(match[2], 10),
    testsSkipped: match[3] ? Number.parseInt(match[3], 10) : undefined
  };
}

function parseMavenSurefireSummary(value: string): Partial<ParsedValidationSummary> {
  const match = /Tests run:\s+(\d+),\s+Failures:\s+(\d+),\s+Errors:\s+(\d+),\s+Skipped:\s+(\d+)/i.exec(value);
  if (!match) {
    return {};
  }

  const total = Number.parseInt(match[1], 10);
  const failed = Number.parseInt(match[2], 10);
  const errored = Number.parseInt(match[3], 10);
  const skipped = Number.parseInt(match[4], 10);

  return {
    testsPassed: Math.max(0, total - failed - errored - skipped),
    testsFailed: failed,
    testsErrored: errored,
    testsSkipped: skipped
  };
}

function parseEslintSummary(value: string): Partial<ParsedValidationSummary> {
  const match = /[x✖]\s+\d+\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/i.exec(value);
  if (!match) {
    return {};
  }

  return {
    lintErrors: Number.parseInt(match[1], 10),
    lintWarnings: Number.parseInt(match[2], 10)
  };
}

function parseTypeScriptSummary(value: string): Partial<ParsedValidationSummary> {
  return {
    typeErrors: readFirstNumber(value, [/Found\s+(\d+)\s+errors?/i])
  };
}

function readFirstNumber(value: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) {
      continue;
    }

    if (match[1]) {
      return Number.parseInt(match[1], 10);
    }

    return 1;
  }

  return undefined;
}

function readErrorLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /(^error\b|failed|exception|traceback)/i.test(line))
    .slice(0, 10);
}

function readLastMatchingLine(value: string, pattern: RegExp): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
    .at(-1);
}

function countMatches(value: string, pattern: RegExp): number {
  return [...value.matchAll(pattern)].length;
}

function firstDefined(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => value !== undefined);
}

function formatOptionalCount(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label}=${value}`;
}
