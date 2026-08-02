import type { TestCommandHint, TestCommandResult, TestCommandSource, TestRunResult } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default test commands for common package managers and frameworks */
const PACKAGE_JSON_DEFAULTS: Record<string, TestCommandHint> = {
  jest: {
    source: "package.json",
    commandName: "test",
    command: "npx jest",
    confidence: 0.9
  },
  vitest: {
    source: "package.json",
    commandName: "test",
    command: "npx vitest run",
    confidence: 0.95
  },
  "react-scripts": {
    source: "package.json",
    commandName: "test",
    command: "npx react-scripts test --watchAll=false",
    confidence: 0.85
  },
  playwright: {
    source: "package.json",
    commandName: "test:e2e",
    command: "npx playwright test",
    confidence: 0.8
  }
};

const POM_XML_DEFAULTS: Record<string, TestCommandHint> = {
  maven: {
    source: "pom.xml",
    commandName: "test",
    command: "mvn test",
    confidence: 0.95
  },
  surefire: {
    source: "pom.xml",
    commandName: "test",
    command: "mvn surefire:test",
    confidence: 0.9
  }
};

const BUILD_GRADLE_DEFAULTS: Record<string, TestCommandHint> = {
  junit5: {
    source: "build.gradle",
    commandName: "test",
    command: "./gradlew test",
    confidence: 0.9
  },
  spock: {
    source: "build.gradle",
    commandName: "test",
    command: './gradlew test --tests "*Spec"',
    confidence: 0.85
  }
};

const PYPROJECT_DEFAULTS: Record<string, TestCommandHint> = {
  pytest: {
    source: "pyproject.toml",
    commandName: "test",
    command: "python -m pytest",
    confidence: 0.9
  }
};

const GOMOD_DEFAULTS: Record<string, TestCommandHint> = {
  default: {
    source: "go.mod",
    commandName: "test",
    command: "go test ./...",
    confidence: 0.95
  },
  "race-detector": {
    source: "go.mod",
    commandName: "test-race",
    command: "go test -race ./...",
    confidence: 0.85
  }
};

// ---------------------------------------------------------------------------
// Detection functions
// ---------------------------------------------------------------------------

/**
 * Detect test commands from package.json by inspecting scripts and dependencies.
 */
export function detectFromPackageJson(
  packageJson: Record<string, unknown>,
  rootPath: string
): TestCommandResult[] {
  const commands: TestCommandResult[] = [];

  const scripts = (packageJson.scripts as Record<string, string>) ?? {};

  for (const [name, cmd] of Object.entries(scripts)) {
    const cmdLower = cmd.toLowerCase();
    if (
      cmdLower.includes("jest") ||
      cmdLower.includes("vitest") ||
      cmdLower.includes("mocha") ||
      cmdLower.includes("ava") ||
      cmdLower.includes("karma") ||
      cmdLower.includes("test")
    ) {
      commands.push({
        command: cmd,
        source: "package.json",
        confidence: 0.9,
        impactedTestFiles: [],
        canRunAutomatically: true
      });
    }
  }

  // Fallback to defaults based on dependencies
  const dependencies = (packageJson.dependencies as Record<string, string>) ?? {};
  for (const [dep] of Object.entries(dependencies)) {
    const depLower = dep.toLowerCase();
    if (depLower in PACKAGE_JSON_DEFAULTS) {
      const hint = PACKAGE_JSON_DEFAULTS[depLower];
      if (!commands.some((c) => c.command === hint.command)) {
        commands.push({
          command: hint.command,
          source: "package.json",
          confidence: hint.confidence,
          impactedTestFiles: [],
          canRunAutomatically: true
        });
      }
    }
  }

  return commands;
}

/**
 * Detect test commands from pom.xml by inspecting the Maven configuration.
 */
export function detectFromPomXml(pomContent: string, rootPath: string): TestCommandResult[] {
  const commands: TestCommandResult[] = [];
  const lower = pomContent.toLowerCase();

  if (lower.includes("maven-surefire-plugin") || lower.includes("surefire")) {
    commands.push({
      command: "mvn surefire:test",
      source: "pom.xml",
      confidence: 0.9,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  if (lower.includes("<artifactId>junit")) {
    commands.push({
      command: "mvn test",
      source: "pom.xml",
      confidence: 0.95,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  return commands;
}

/**
 * Detect test commands from build.gradle by inspecting the Gradle configuration.
 */
export function detectFromBuildGradle(
  gradleContent: string,
  rootPath: string
): TestCommandResult[] {
  const commands: TestCommandResult[] = [];
  const lower = gradleContent.toLowerCase();

  if (lower.includes("test {") || lower.includes("useJUnit") || lower.includes("useJUnitJupiter")) {
    commands.push({
      command: "./gradlew test",
      source: "build.gradle",
      confidence: 0.9,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  if (lower.includes("spock") || lower.includes("Spock")) {
    commands.push({
      command: './gradlew test --tests "*Spec"',
      source: "build.gradle",
      confidence: 0.85,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  return commands;
}

/**
 * Detect test commands from pyproject.toml by inspecting the Python project configuration.
 */
export function detectFromPyProject(
  pyprojectContent: string,
  rootPath: string
): TestCommandResult[] {
  const commands: TestCommandResult[] = [];
  const lower = pyprojectContent.toLowerCase();

  if (lower.includes("pytest")) {
    commands.push({
      command: "python -m pytest",
      source: "pyproject.toml",
      confidence: 0.9,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  if (lower.includes("[tool.pytest") || lower.includes("tool.pytest")) {
    commands.push({
      command: "python -m pytest",
      source: "pyproject.toml",
      confidence: 0.95,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  return commands;
}

/**
 * Detect test commands from go.mod by inspecting the Go module configuration.
 */
export function detectFromGoMod(goModContent: string, rootPath: string): TestCommandResult[] {
  const commands: TestCommandResult[] = [];
  const lower = goModContent.toLowerCase();

  if (lower.includes("testing/") || lower.includes("github.com/onsi/ginkgo")) {
    commands.push({
      command: "go test ./...",
      source: "go.mod",
      confidence: 0.95,
      impactedTestFiles: [],
      canRunAutomatically: true
    });
  }

  commands.push({
    command: "go test -race ./...",
    source: "go.mod",
    confidence: 0.85,
    impactedTestFiles: [],
    canRunAutomatically: true
  });

  return commands;
}

/**
 * Aggregate test commands from all available project sources.
 */
export function getAllTestCommands(
  packageJson?: Record<string, unknown>,
  pomContent?: string,
  gradleContent?: string,
  pyprojectContent?: string,
  goModContent?: string,
  rootPath: string = "."
): TestCommandResult[] {
  const allCommands: TestCommandResult[] = [];

  if (packageJson) {
    allCommands.push(...detectFromPackageJson(packageJson, rootPath));
  }

  if (pomContent) {
    allCommands.push(...detectFromPomXml(pomContent, rootPath));
  }

  if (gradleContent) {
    allCommands.push(...detectFromBuildGradle(gradleContent, rootPath));
  }

  if (pyprojectContent) {
    allCommands.push(...detectFromPyProject(pyprojectContent, rootPath));
  }

  if (goModContent) {
    allCommands.push(...detectFromGoMod(goModContent, rootPath));
  }

  return allCommands;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Get the highest-confidence test command from the detected results.
 */
export function getBestTestCommand(results: TestCommandResult[]): TestCommandResult | null {
  if (results.length === 0) {
    return null;
  }
  return results.reduce((best, current) => (current.confidence > best.confidence ? current : best));
}
