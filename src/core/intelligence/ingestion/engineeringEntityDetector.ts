import path from "node:path";
import type {
  EngineeringEntityFact,
  EngineeringEntityKind,
  EvidenceMetadata
} from "../../domain/types";

const SOURCE_ENTITY_EXTENSIONS =
  /\.(?:[cm]?[jt]sx?|py|go|java|rs|rb|php|cs|kt|scala|swift|sql|prisma)$/i;

/**
 * Deterministically discovers repository engineering entities from already-read file text.
 * This is intentionally an ingestion adapter: it records evidence and honest confidence, while
 * the OKF converter owns identity, lifecycle, and relationship validation.
 */
export function detectEngineeringEntities(
  filePath: string,
  language: string,
  source: string
): EngineeringEntityFact[] {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const lowerPath = normalizedPath.toLowerCase();
  const lines = source.split(/\r?\n/);
  const facts: EngineeringEntityFact[] = [];
  const seen = new Set<string>();
  const add = (
    kind: EngineeringEntityKind,
    name: string,
    line: number,
    properties: Record<string, unknown> = {},
    sourceKind: EvidenceMetadata["source"] = "heuristic",
    confidence = 0.72
  ): void => {
    const cleanName = name.trim();
    if (!cleanName) return;
    const key = `${kind}:${cleanName.toLowerCase()}:${line}`;
    if (seen.has(key)) return;
    seen.add(key);
    facts.push({
      kind,
      name: cleanName,
      filePath: normalizedPath,
      line: Math.max(1, line),
      properties,
      evidence: {
        source: sourceKind,
        confidence,
        evidencePath: normalizedPath,
        evidenceLine: Math.max(1, line),
        extractorVersion: "engineering-entities:v1"
      }
    });
  };
  const lineNumber = (offset: number): number => source.slice(0, offset).split(/\r?\n/).length;
  const basename = path.posix.basename(normalizedPath);
  const stem = basename.replace(/\.[^.]+$/, "");
  const databaseLike =
    /\.(?:sql|prisma)$/i.test(normalizedPath) ||
    /(?:^|\/)(?:db|database|databases|migrations?|schemas?|models?|entities?)(?:\/|$)/i.test(
      normalizedPath
    ) ||
    /\b(?:prisma|sequelize|typeorm|drizzle|knex|mongoose|sqlalchemy|hibernate|jdbc)\b/i.test(
      source
    );

  if (basename === "package.json") {
    add(
      "package-manager",
      "npm",
      1,
      { manager: "npm", manifest: normalizedPath },
      "filesystem",
      0.96
    );
    add(
      "build-system",
      "npm scripts",
      1,
      { system: "npm", manifest: normalizedPath },
      "filesystem",
      0.94
    );
  } else if (/^(?:package-lock\.json|npm-shrinkwrap\.json)$/i.test(basename)) {
    add(
      "package-manager",
      "npm",
      1,
      { manager: "npm", lockfile: normalizedPath },
      "filesystem",
      0.96
    );
  } else if (/^yarn\.lock$/i.test(basename)) {
    add(
      "package-manager",
      "yarn",
      1,
      { manager: "yarn", lockfile: normalizedPath },
      "filesystem",
      0.96
    );
  } else if (/^(?:pnpm-lock\.yaml|pnpm-workspace\.yaml)$/i.test(basename)) {
    add(
      "package-manager",
      "pnpm",
      1,
      { manager: "pnpm", lockfile: normalizedPath },
      "filesystem",
      0.96
    );
  } else if (/^bun\.lockb?$/i.test(basename)) {
    add(
      "package-manager",
      "bun",
      1,
      { manager: "bun", lockfile: normalizedPath },
      "filesystem",
      0.96
    );
  }

  if (
    /(?:^|\/)(?:makefile|dockerfile|pom\.xml|build\.gradle|build\.gradle\.kts|go\.mod|cargo\.toml|pyproject\.toml|setup\.py|vite\.config\.|webpack\.config\.|rollup\.config\.|tsconfig.*\.json)$/i.test(
      normalizedPath
    ) ||
    /(?:^|\/)(?:scripts?|build|gradle|maven)(?:\/|$)/i.test(normalizedPath)
  ) {
    add(
      "build-system",
      buildSystemName(basename),
      1,
      { path: normalizedPath, language },
      "filesystem",
      0.9
    );
  }

  if (
    /(?:^|\/)(?:\.github\/workflows|\.gitlab|jenkins|buildkite|circleci|azure-pipelines|ci)(?:\/|$)/i.test(
      normalizedPath
    ) ||
    /(?:^|\/)(?:jenkinsfile|\.gitlab-ci\.yml|azure-pipelines\.ya?ml|buildkite\.ya?ml|circle\.yml)$/i.test(
      normalizedPath
    )
  ) {
    add(
      "ci-cd",
      basename,
      1,
      { path: normalizedPath, provider: ciProvider(normalizedPath) },
      "filesystem",
      0.95
    );
  }

  if (
    /(?:^|\/)(?:infra|infrastructure|terraform|terragrunt|k8s|kubernetes|helm|charts|ansible|docker)(?:\/|$)/i.test(
      normalizedPath
    ) ||
    /(?:^|\/)(?:dockerfile|docker-compose(?:\.[^.]+)?\.ya?ml|terraform\.tf)$/i.test(normalizedPath)
  ) {
    add(
      "infrastructure",
      stem,
      1,
      { path: normalizedPath, provider: infrastructureProvider(normalizedPath) },
      "filesystem",
      0.92
    );
  }

  if (databaseLike) {
    const databaseName = databaseNameFor(normalizedPath);
    add(
      "database",
      databaseName,
      1,
      { path: normalizedPath, databaseName, sourceKind: language },
      "filesystem",
      0.88
    );
  }

  for (const match of source.matchAll(
    /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["'`]?([\w.-]+)["'`]?/gi
  )) {
    add("table", match[1], lineNumber(match.index), {
      databaseName: databaseNameFor(normalizedPath)
    });
  }
  for (const match of source.matchAll(/^\s*model\s+([A-Za-z_]\w*)/gim)) {
    add("orm-entity", match[1], lineNumber(match.index), {
      tableName: match[1],
      orm: "prisma",
      databaseName: databaseNameFor(normalizedPath)
    });
    add("table", match[1], lineNumber(match.index), {
      databaseName: databaseNameFor(normalizedPath)
    });
  }
  for (const match of source.matchAll(/@(?:Entity|Table)\s*\(\s*["'`]([^"'`]+)["'`]/g)) {
    add("orm-entity", match[1], lineNumber(match.index), {
      tableName: match[1],
      orm: "decorator",
      databaseName: databaseNameFor(normalizedPath)
    });
    add("table", match[1], lineNumber(match.index), {
      databaseName: databaseNameFor(normalizedPath)
    });
  }
  if (databaseLike && /(?:^|\/)(?:entities?|models?)(?:\/|$)/i.test(normalizedPath)) {
    for (const match of source.matchAll(/\bclass\s+([A-Za-z_]\w*)/g))
      add("orm-entity", match[1], lineNumber(match.index), {
        tableName: match[1],
        orm: "class-model",
        databaseName: databaseNameFor(normalizedPath)
      });
  }

  for (const match of source.matchAll(
    /\b(select|insert\s+into|update|delete\s+from|merge\s+into)\b[^;\n]*/gi
  )) {
    const statement = match[0].trim().replace(/\s+/g, " ").slice(0, 180);
    const table = statement.match(/\b(?:from|into|update)\s+["'`]?([\w.-]+)/i)?.[1];
    add(
      "query",
      `${match[1].toUpperCase()} @ ${normalizedPath}:${lineNumber(match.index)}`,
      lineNumber(match.index),
      {
        operation: match[1].toLowerCase(),
        tableNames: table ? [table] : [],
        statement
      }
    );
  }
  for (const match of source.matchAll(
    /\b(findMany|findUnique|findFirst|findOne|findAll|insertMany|insertOne|updateMany|deleteMany|queryRaw|execute|select)\s*\(/g
  )) {
    add(
      "query",
      `${match[1]} @ ${normalizedPath}:${lineNumber(match.index)}`,
      lineNumber(match.index),
      { operation: match[1], orm: true }
    );
  }

  for (const [index, line] of lines.entries()) {
    const featureNames = new Set<string>();
    for (const match of line.matchAll(/\b[A-Z][A-Z0-9_]*(?:FEATURE|FLAG)[A-Z0-9_]*\b/g))
      featureNames.add(match[0]);
    for (const match of line.matchAll(
      /\b(?:feature[_-]?flag|featureFlags?|isFeatureEnabled|launchDarkly)\s*(?:[.:[(]\s*)?["'`]([A-Za-z0-9_.:-]+)["'`]/gi
    ))
      featureNames.add(match[1]);
    for (const name of featureNames)
      add("feature-flag", name, index + 1, { flag: name, sourcePath: normalizedPath });
    for (const match of line.matchAll(
      /\b(?:emit|publish|dispatch|send)\s*\(\s*["'`]([^"'`]+)["'`]/g
    ))
      add("event", match[1], index + 1, { operation: "emit", sourcePath: normalizedPath });
  }
  for (const match of source.matchAll(/\bclass\s+([A-Za-z_]\w*Event)\b/g))
    add("event", match[1], lineNumber(match.index), { operation: "class" });

  if (/(?:^|\/)(?:__fixtures__|fixtures?|mocks?|factories|seeds?)(?:\/|$)/i.test(normalizedPath))
    add("fixture", stem, 1, { path: normalizedPath }, "filesystem", 0.92);
  if (
    SOURCE_ENTITY_EXTENSIONS.test(normalizedPath) &&
    /(?:^|\/)(?:components?|views?|pages?)(?:\/|$)/i.test(normalizedPath)
  )
    add("component", stem, 1, { path: normalizedPath, language });
  if (
    SOURCE_ENTITY_EXTENSIONS.test(normalizedPath) &&
    /\.(?:tsx|jsx|vue|svelte)$/i.test(normalizedPath) &&
    /\b(?:React|defineComponent|<template|export\s+default)\b/.test(source)
  )
    add("component", stem, 1, { path: normalizedPath, language });

  return facts;
}

function databaseNameFor(filePath: string): string {
  const base = path.posix.basename(filePath).replace(/\.(?:sql|prisma)$/i, "");
  const migration = filePath.match(/(?:^|\/)(?:migrations?|schemas?)[\/]([^/]+)/i)?.[1];
  return migration ? `database:${migration}` : `database:${base || "workspace"}`;
}

function buildSystemName(fileName: string): string {
  if (/dockerfile/i.test(fileName)) return "Docker";
  if (/makefile/i.test(fileName)) return "Make";
  if (/pom\.xml/i.test(fileName)) return "Maven";
  if (/gradle/i.test(fileName)) return "Gradle";
  if (/cargo\.toml/i.test(fileName)) return "Cargo";
  if (/go\.mod/i.test(fileName)) return "Go modules";
  if (/vite/i.test(fileName)) return "Vite";
  if (/webpack/i.test(fileName)) return "Webpack";
  if (/rollup/i.test(fileName)) return "Rollup";
  if (/tsconfig/i.test(fileName)) return "TypeScript compiler";
  return fileName;
}

function ciProvider(filePath: string): string {
  if (/github/i.test(filePath)) return "GitHub Actions";
  if (/gitlab/i.test(filePath)) return "GitLab CI";
  if (/jenkins/i.test(filePath)) return "Jenkins";
  if (/buildkite/i.test(filePath)) return "Buildkite";
  if (/circle/i.test(filePath)) return "CircleCI";
  if (/azure/i.test(filePath)) return "Azure Pipelines";
  return "CI/CD";
}

function infrastructureProvider(filePath: string): string {
  if (/terraform|terragrunt/i.test(filePath)) return "Terraform";
  if (/k8s|kubernetes|helm|charts/i.test(filePath)) return "Kubernetes";
  if (/ansible/i.test(filePath)) return "Ansible";
  if (/docker/i.test(filePath)) return "Docker";
  return "Infrastructure as code";
}
