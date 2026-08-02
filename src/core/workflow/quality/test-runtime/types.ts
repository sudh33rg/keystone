/** Minimal, current-release test runtime contracts. */
export type TestCommandSource =
  | "package.json"
  | "pom.xml"
  | "build.gradle"
  | "pyproject.toml"
  | "pytest.ini"
  | "go.mod"
  | ".csproj"
  | "Makefile"
  | "Rakefile"
  | "composer.json"
  | "project.json";
export interface TestCommandHint {
  source: string;
  commandName: string;
  command: string;
  confidence: number;
}
export interface TestCommandResult {
  command: string;
  source: TestCommandSource;
  confidence: number;
  impactedTestFiles: string[];
  canRunAutomatically: boolean;
  manualAction?: string;
}
export interface TestFailure {
  testName: string;
  message: string;
  stackTrace?: string;
}
export interface TestRunResult {
  testFile: string;
  status: "passed" | "failed" | "skipped" | "pending";
  durationMs: number;
  assertions: number;
  failures?: TestFailure[];
  coverage?: number;
  startedAt: number;
}
