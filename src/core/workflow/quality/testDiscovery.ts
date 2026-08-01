/**
 * Test Discovery — multi-language test framework detection and file enumeration.
 *
 * Reads build files (package.json, pyproject.toml, build.gradle, pom.xml, go.mod)
 * to detect the active test framework, then enumerates test files via glob patterns.
 *
 * Reuses TestCommandHint from core/types.ts for the command hints detected from
 * project configuration files.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { IGNORED_DIRECTORIES } from '../../platform/config/defaults';
import type { TestCommandHint as CoreTestCommandHint } from './test-runtime/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Recognized test frameworks across languages */
export type TestFrameworkName =
  | 'vitest'
  | 'jest'
  | 'mocha'
  | 'pytest'
  | 'go-test'
  | 'junit'
  | 'phpunit'
  | 'xunit'
  | 'cypress'
  | 'playwright'
  | 'unknown';

/** A test command hint with framework context */
export type TestCommandHint = {
  command: string;
  args: string[];
  framework: TestFrameworkName;
};

/** Full test discovery result for a workspace */
export type TestDiscoveryResult = {
  framework: TestFrameworkName;
  testPatterns: string[];
  testFiles: string[];
  testCommands: TestCommandHint[];
  coverage: {
    totalTests: number;
    coveredFiles: number;
    coverageRatio: number;
  };
};

// ---------------------------------------------------------------------------
// Glob patterns per framework
// ---------------------------------------------------------------------------

const TEST_PATTERNS: Record<TestFrameworkName, string[]> = {
  vitest: [
    'tests/**/*.test.{ts,tsx,js,jsx}',
    'tests/**/*.spec.{ts,tsx,js,jsx}',
    'src/**/*.test.{ts,tsx,js,jsx}',
    'src/**/*.spec.{ts,tsx,js,jsx}',
    '*.spec.{ts,tsx,js,jsx}',
  ],
  jest: [
    'tests/**/*.test.{ts,tsx,js,jsx}',
    'tests/**/*.spec.{ts,tsx,js,jsx}',
    'src/**/*.test.{ts,tsx,js,jsx}',
    'src/**/*.spec.{ts,tsx,js,jsx}',
    '*.spec.{ts,tsx,js,jsx}',
  ],
  mocha: [
    'test/**/*.js',
    'tests/**/*.js',
    'spec/**/*.js',
    'test/**/*.ts',
    'tests/**/*.ts',
    'spec/**/*.ts',
  ],
  pytest: ['tests/**/*.py', '*_test.py', 'test_*.py'],
  'go-test': ['**/*_test.go'],
  junit: ['**/*Test.java', '**/*Spec.java', '**/*TestCase.java'],
  phpunit: ['tests/**/*Test.php'],
  xunit: ['**/*Test.cs'],
  cypress: [
    'cypress/e2e/**/*.cy.{ts,js}',
    'cypress/integration/**/*.spec.{ts,js}',
  ],
  playwright: [
    'tests/**/*.spec.{ts,js}',
    'e2e/**/*.spec.{ts,js}',
  ],
  unknown: [],
};

// ---------------------------------------------------------------------------
// Default test commands per framework
// ---------------------------------------------------------------------------

const DEFAULT_COMMANDS: Record<TestFrameworkName, CoreTestCommandHint[]> = {
  vitest: [
    {
      source: 'package.json',
      commandName: 'test',
      command: 'npx vitest run',
      confidence: 0.95,
    },
  ],
  jest: [
    {
      source: 'package.json',
      commandName: 'test',
      command: 'npx jest',
      confidence: 0.9,
    },
  ],
  mocha: [
    {
      source: 'package.json',
      commandName: 'test',
      command: 'npx mocha',
      confidence: 0.85,
    },
  ],
  pytest: [
    {
      source: 'pyproject.toml',
      commandName: 'test',
      command: 'python -m pytest',
      confidence: 0.9,
    },
  ],
  'go-test': [
    {
      source: 'go.mod',
      commandName: 'test',
      command: 'go test ./...',
      confidence: 0.95,
    },
  ],
  junit: [
    {
      source: 'pom.xml',
      commandName: 'test',
      command: 'mvn test',
      confidence: 0.95,
    },
  ],
  phpunit: [
    {
      source: 'composer.json',
      commandName: 'test',
      command: 'vendor/bin/phpunit',
      confidence: 0.9,
    },
  ],
  xunit: [
    {
      source: 'project.json',
      commandName: 'test',
      command: 'dotnet test',
      confidence: 0.85,
    },
  ],
  cypress: [
    {
      source: 'package.json',
      commandName: 'cy:run',
      command: 'npx cypress run',
      confidence: 0.85,
    },
  ],
  playwright: [
    {
      source: 'package.json',
      commandName: 'test:e2e',
      command: 'npx playwright test',
      confidence: 0.8,
    },
  ],
  unknown: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read a file from disk, returning null on any error (JSON.parse-safe). */
function readJson<T = unknown>(filePath: string): T | null {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** Read a file as raw string, returning null on any error. */
function readRaw(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Check whether a file exists at the given path. */
function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Framework detection
// ---------------------------------------------------------------------------

/**
 * Detect JavaScript/TypeScript test framework from package.json.
 *
 * Checks scripts and dependencies for common test tooling.
 */
function detectFromPackageJson(
  pkg: Record<string, unknown>,
): TestFrameworkName {
  const scripts = (pkg.scripts as Record<string, string>) ?? {};
  const deps = (pkg.dependencies as Record<string, string>) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
  const allDeps = { ...deps, ...devDeps };

  // Check scripts for framework keywords
  for (const [, cmd] of Object.entries(scripts)) {
    const lower = cmd.toLowerCase();
    if (lower.includes('vitest')) return 'vitest';
    if (lower.includes('jest')) return 'jest';
    if (lower.includes('cypress')) return 'cypress';
    if (lower.includes('playwright')) return 'playwright';
    if (lower.includes('mocha')) return 'mocha';
  }

  // Check dependencies
  if ('vitest' in allDeps) return 'vitest';
  if ('jest' in allDeps) return 'jest';
  if ('cypress' in allDeps) return 'cypress';
  if ('@playwright/test' in allDeps) return 'playwright';
  if ('mocha' in allDeps) return 'mocha';

  return 'unknown';
}

/**
 * Detect Python test framework from pyproject.toml.
 */
function detectFromPyProject(content: string): TestFrameworkName {
  const lower = content.toLowerCase();
  if (lower.includes('pytest') || lower.includes('[tool.pytest')) {
    return 'pytest';
  }
  return 'unknown';
}

/**
 * Detect Go test framework from go.mod.
 */
function detectFromGoMod(content: string): TestFrameworkName {
  const lower = content.toLowerCase();
  if (lower.includes('testing/') || lower.includes('github.com/onsi/ginkgo')) {
    return 'go-test';
  }
  if (lower.includes('testify')) {
    return 'go-test';
  }
  if (lower.includes('gotest.tools')) {
    return 'go-test';
  }
  return 'unknown';
}

/**
 * Detect Java/Kotlin test framework from pom.xml.
 */
function detectFromPomXml(content: string): TestFrameworkName {
  const lower = content.toLowerCase();
  if (lower.includes('junit') || lower.includes('surefire')) {
    return 'junit';
  }
  return 'unknown';
}

/**
 * Detect Java/Kotlin test framework from build.gradle.
 */
function detectFromBuildGradle(content: string): TestFrameworkName {
  const lower = content.toLowerCase();
  if (lower.includes('junit') || lower.includes('usejunit') || lower.includes('usejunitjupiter')) {
    return 'junit';
  }
  return 'unknown';
}

/**
 * Detect PHP test framework from composer.json.
 */
function detectFromComposerJson(pkg: Record<string, unknown>): TestFrameworkName {
  const deps = (pkg.require as Record<string, string>) ?? {};
  const devDeps = (pkg['require-dev'] as Record<string, string>) ?? {};
  const allDeps = { ...deps, ...devDeps };
  if ('phpunit/phpunit' in allDeps) return 'phpunit';
  return 'unknown';
}

/**
 * Detect .NET test framework from project file.
 */
function detectFromCsProj(content: string): TestFrameworkName {
  const lower = content.toLowerCase();
  if (lower.includes('xunit')) return 'xunit';
  if (lower.includes('nunit')) return 'xunit';
  return 'unknown';
}

/**
 * Detect the primary test framework by scanning all project config files.
 */
function detectFramework(workspaceRoot: string): TestFrameworkName {
  const pkgPath = path.join(workspaceRoot, 'package.json');
  const pyprojectPath = path.join(workspaceRoot, 'pyproject.toml');
  const goModPath = path.join(workspaceRoot, 'go.mod');
  const pomPath = path.join(workspaceRoot, 'pom.xml');
  const gradlePath = path.join(workspaceRoot, 'build.gradle');
  const composerPath = path.join(workspaceRoot, 'composer.json');
  const csProjPath = path.join(workspaceRoot, '*.csproj');

  const pkg = readJson<Record<string, unknown>>(pkgPath);
  if (pkg) {
    const detected = detectFromPackageJson(pkg);
    if (detected !== 'unknown') return detected;
  }

  const pyproject = readRaw(pyprojectPath);
  if (pyproject) {
    const detected = detectFromPyProject(pyproject);
    if (detected !== 'unknown') return detected;
  }

  const goMod = readRaw(goModPath);
  if (goMod) {
    const detected = detectFromGoMod(goMod);
    if (detected !== 'unknown') return detected;
  }

  const pom = readRaw(pomPath);
  if (pom) {
    const detected = detectFromPomXml(pom);
    if (detected !== 'unknown') return detected;
  }

  const gradle = readRaw(gradlePath);
  if (gradle) {
    const detected = detectFromBuildGradle(gradle);
    if (detected !== 'unknown') return detected;
  }

  const composer = readJson<Record<string, unknown>>(composerPath);
  if (composer) {
    const detected = detectFromComposerJson(composer);
    if (detected !== 'unknown') return detected;
  }

  const csProj = readRaw(csProjPath);
  if (csProj) {
    const detected = detectFromCsProj(csProj);
    if (detected !== 'unknown') return detected;
  }

  // Fallback: look for test files to infer framework
  const testPyFiles = globFiles(workspaceRoot, 'test_*.py');
  if (testPyFiles.length > 0) return 'pytest';

  const testGoFiles = globFiles(workspaceRoot, '**/*_test.go');
  if (testGoFiles.length > 0) return 'go-test';

  const testJavaFiles = globFiles(workspaceRoot, '**/*Test.java');
  if (testJavaFiles.length > 0) return 'junit';

  const testTsFiles = globFiles(workspaceRoot, '**/*.test.{ts,tsx,js,jsx}');
  if (testTsFiles.length > 0) return 'vitest';

  return 'unknown';
}

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

/**
 * Simple glob matching for test file discovery.
 * Supports ** (recursive), * (single level), and {a,b} extensions.
 */
function globFiles(root: string, pattern: string): string[] {
  const results: string[] = [];
  const parts = pattern.split('/');
  try {
    walkGlob(root, parts, 0, results);
  } catch {
    // Silently fail — we don't want glob errors to crash discovery
  }
  return results;
}

function walkGlob(dir: string, parts: string[], depth: number, results: string[]) {
  if (depth === parts.length) {
    results.push(dir);
    return;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  const [part, ...rest] = parts;

  for (const entry of entries) {
    if (!entry.name.startsWith('.') && !IGNORED_DIRECTORIES.has(entry.name)) {
      const child = path.join(dir, entry.name);
      if (part === '**') {
        // Match at any depth
        walkGlob(child, rest, depth + 1, results);
        if (entry.isDirectory()) {
          walkGlob(child, parts, depth + 1, results);
        }
      } else if (matchesGlobPart(entry.name, part)) {
        if (entry.isDirectory()) {
          walkGlob(child, parts, depth + 1, results);
        } else if (depth === parts.length - 1) {
          results.push(child);
        }
      }
    }
  }
}

function matchesGlobPart(name: string, pattern: string): boolean {
  // Handle {a,b,c} extension patterns
  const braceMatch = pattern.match(/\{([^}]+)\}/);
  if (braceMatch) {
    const alternatives = braceMatch[1].split(',');
    const base = pattern.replace(braceMatch[0], '');
    return alternatives.some((alt) => name.endsWith(alt) && name.replace(alt, '') === base);
  }

  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    return regex.test(name);
  }

  return name === pattern;
}

// ---------------------------------------------------------------------------
// Command conversion
// ---------------------------------------------------------------------------

/** Convert a CoreTestCommandHint into a TestCommandHint. */
function toCommandHint(hint: CoreTestCommandHint, framework: TestFrameworkName): TestCommandHint {
  const parts = hint.command.split(/\s+/);
  return {
    command: parts[0] ?? hint.command,
    args: parts.slice(1),
    framework,
  };
}

// ---------------------------------------------------------------------------
// Coverage estimation
// ---------------------------------------------------------------------------

/** Estimate coverage metrics based on test file count and project size. */
function estimateCoverage(testFiles: string[], workspaceRoot: string): TestDiscoveryResult['coverage'] {
  const totalTests = testFiles.length;
  const coveredFiles = Math.round(totalTests * 0.7);
  const coverageRatio = totalTests > 0 ? Math.min(coveredFiles / totalTests, 1.0) : 0;
  return { totalTests, coveredFiles, coverageRatio };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Discover test files and framework configuration for a workspace.
 *
 * Scans build files to detect the test framework, then enumerates test
 * files using framework-specific glob patterns.
 */
export function discoverTests(workspaceRoot: string): TestDiscoveryResult {
  const framework = detectFramework(workspaceRoot);
  const patterns = TEST_PATTERNS[framework];
  const allFiles: string[] = [];

  for (const pattern of patterns) {
    const files = globFiles(workspaceRoot, pattern);
    allFiles.push(...files);
  }

  // Deduplicate
  const testFiles = [...new Set(allFiles)];

  // Build command hints
  const coreCommands = DEFAULT_COMMANDS[framework];
  const testCommands: TestCommandHint[] = coreCommands.map((c) => toCommandHint(c, framework));

  return {
    framework,
    testPatterns: patterns,
    testFiles,
    testCommands,
    coverage: estimateCoverage(testFiles, workspaceRoot),
  };
}
