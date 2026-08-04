/**
 * TechnologyRegistry — deterministic, keyword + manifest driven detection rules
 * for frameworks, ORMs, databases, and external services.
 *
 * This module is pure: no filesystem, no network, no LLM. It maps normalized
 * dependency/service names to canonical technology symbols so that detection is
 * reproducible and evidence-backed (every emitted fact carries a sourceKind).
 */

export type TechnologyKind = "framework" | "orm" | "database" | "external-service";

export interface Detection {
  /** Stable, canonical technology name (e.g. "PostgreSQL", "FastAPI"). */
  readonly name: string;
  readonly kind: TechnologyKind;
  /** The raw keyword/dependency that triggered this detection (for evidence). */
  readonly source: string;
  readonly confidence: number;
}

export interface RawDependency {
  readonly name: string;
  readonly version?: string;
}

export const TECHNOLOGY_EXTRACTOR_ID = "keystone.technology-detection";
export const TECHNOLOGY_EXTRACTOR_VERSION = "1";

/**
 * Keyword → canonical technology. Matching is performed on the normalized
 * dependency/service name (lowercased, scope stripped). One keyword maps to
 * exactly one canonical name so detection is idempotent across manifests.
 */
const FRAMEWORK_RULES: Record<string, string> = {
  // Python
  fastapi: "FastAPI",
  flask: "Flask",
  django: "Django",
  tornado: "Tornado",
  aiohttp: "AioHTTP",
  starlette: "Starlette",
  // Node / TypeScript
  express: "Express",
  fastify: "Fastify",
  "@nestjs/core": "NestJS",
  nestjs: "NestJS",
  koa: "Koa",
  next: "Next.js",
  "@angular/core": "Angular",
  react: "React",
  vue: "Vue",
  // Go
  gin: "Gin",
  echo: "Echo",
  fiber: "Fiber",
  "gorilla/mux": "GorillaMux",
  chi: "Chi",
  beego: "Beego",
  // Rust
  actix: "Actix",
  "actix-web": "Actix",
  rocket: "Rocket",
  axum: "Axum",
  // Java / JVM
  spring: "Spring",
  "spring-boot": "Spring Boot",
  springboot: "Spring Boot",
  micronaut: "Micronaut",
  quarkus: "Quarkus",
  // Ruby
  rails: "Rails",
  sinatra: "Sinatra",
  hanami: "Hanami",
  // PHP
  laravel: "Laravel",
  symfony: "Symfony",
};

const ORM_RULES: Record<string, string> = {
  // Python
  sqlalchemy: "SQLAlchemy",
  "sqlalchemy.orm": "SQLAlchemy",
  "django.db": "Django ORM",
  "django.db.models": "Django ORM",
  tortoise: "Tortoise ORM",
  // Node / TS
  typeorm: "TypeORM",
  prisma: "@prisma/client",
  "@prisma/client": "Prisma",
  sequelize: "Sequelize",
  mongoose: "Mongoose",
  knex: "Knex",
  bookshelf: "Bookshelf",
  // Go
  gorm: "GORM",
  sqlx: "SQLx",
  "go-sqlx": "SQLx",
  ent: "Ent",
  // Rust
  diesel: "Diesel",
  "diesel-async": "Diesel",
  // Java / JVM
  hibernate: "Hibernate",
  "jakarta.persistence": "JPA",
  "javax.persistence": "JPA",
  mybatis: "MyBatis",
  // Ruby
  activerecord: "ActiveRecord",
  "active_record": "ActiveRecord",
  // PHP
  doctrine: "Doctrine",
  eloquent: "Eloquent",
};

/**
 * Database driver / engine keywords. When detected from a manifest dependency
 * they denote a database engine the project talks to. When detected from a
 * docker-compose / terraform service they also denote a managed external
 * service (see {@link detectComposeServices}).
 */
const DATABASE_RULES: Record<string, string> = {
  postgres: "PostgreSQL",
  postgresql: "PostgreSQL",
  psycopg2: "PostgreSQL",
  "psycopg2-binary": "PostgreSQL",
  "pgx": "PostgreSQL",
  mysql: "MySQL",
  "mysql2": "MySQL",
  pymysql: "MySQL",
  mariadb: "MariaDB",
  sqlite: "SQLite",
  "sqlite3": "SQLite",
  mongodb: "MongoDB",
  mongoose: "MongoDB",
  redis: "Redis",
  "redis-py": "Redis",
  cassandra: "Cassandra",
  "cassandra-driver": "Cassandra",
  dynamodb: "DynamoDB",
  "boto3": "AWS",
  elasticsearch: "Elasticsearch",
  "elasticsearch-dsl": "Elasticsearch",
  neo4j: "Neo4j",
  "neo4j-driver": "Neo4j",
  cockroach: "CockroachDB",
  "cockroachdb": "CockroachDB",
  "mssql": "SQL Server",
  sqlserver: "SQL Server",
  "pyodbc": "SQL Server",
  oracle: "Oracle",
  "oracledb": "Oracle",
  "google-cloud-bigquery": "BigQuery",
  bigquery: "BigQuery",
  snowflake: "Snowflake",
  "snowflake-sqlalchemy": "Snowflake",
};

/**
 * Managed-service / infrastructure keywords. These are external services a
 * repository depends on (message brokers, caches, gateways, clouds).
 */
const EXTERNAL_SERVICE_RULES: Record<string, string> = {
  "rabbitmq": "RabbitMQ",
  "amqp": "RabbitMQ",
  "kafka": "Kafka",
  "kafka-python": "Kafka",
  "confluent-kafka": "Kafka",
  "nginx": "Nginx",
  "apache": "Apache HTTPD",
  "consul": "Consul",
  "vault": "Vault",
  "etcd": "etcd",
  "minio": "MinIO",
  "s3": "AWS S3",
  "google-cloud-storage": "GCS",
  "stripe": "Stripe",
  "twilio": "Twilio",
  "sendgrid": "SendGrid",
  "auth0": "Auth0",
  "okta": "Okta",
};

/** Resolve a single normalized keyword to a detection (if any rule matches). */
export function matchKeyword(normalized: string): Detection | undefined {
  const framework = FRAMEWORK_RULES[normalized];
  if (framework) return { name: framework, kind: "framework", source: normalized, confidence: 1 };
  const orm = ORM_RULES[normalized];
  if (orm) return { name: orm, kind: "orm", source: normalized, confidence: 1 };
  const database = DATABASE_RULES[normalized];
  if (database) return { name: database, kind: "database", source: normalized, confidence: 1 };
  const external = EXTERNAL_SERVICE_RULES[normalized];
  if (external)
    return { name: external, kind: "external-service", source: normalized, confidence: 1 };
  return undefined;
}

/**
 * Run keyword matching over a parsed dependency list. A matched dependency may
 * produce a database detection AND (for compose/terraform managed services) an
 * external-service detection of the same name. Returns one Detection per
 * resolved technology (callers dedupe by name).
 */
export function detectFromDependencies(deps: RawDependency[]): Detection[] {
  const out: Detection[] = [];
  for (const dep of deps) {
    const normalized = normalizeDependencyName(dep.name);
    const matched = matchKeyword(normalized);
    if (matched) out.push(matched);
  }
  return out;
}

/**
 * docker-compose / terraform service detection. A service image that resolves
 * to a known database engine yields both a `database` detection and an
 * `external-service` detection (the managed instance). Other known infra images
 * yield an `external-service` detection only.
 */
export function detectComposeServices(content: string): Detection[] {
  const deps = parseComposeImageNames(content).concat(parseTerraformResources(content));
  const out: Detection[] = [];
  for (const dep of deps) {
    const normalized = normalizeDependencyName(dep.name);
    const db = DATABASE_RULES[normalized];
    if (db) {
      out.push({ name: db, kind: "database", source: normalized, confidence: 1 });
      out.push({ name: normalized, kind: "external-service", source: normalized, confidence: 0.9 });
      continue;
    }
    const external = EXTERNAL_SERVICE_RULES[normalized];
    if (external)
      out.push({ name: external, kind: "external-service", source: normalized, confidence: 0.9 });
  }
  return out;
}

/** Strip a scope/namespace prefix so "org:pkg" / "@scope/pkg" match on "pkg". */
export function normalizeDependencyName(raw: string): string {
  const withoutScope = raw.replace(/^@[^/]+\//, "");
  const lastSegment = withoutScope.split("/").at(-1) ?? withoutScope;
  return lastSegment.toLowerCase();
}

/** Parse the list of dependency names from a known manifest file. */
export function parseManifestDependencies(fileName: string, content: string): RawDependency[] {
  const lower = fileName.toLowerCase();
  if (lower.endsWith("package.json")) return parsePackageJson(content);
  if (lower.endsWith("requirements.txt")) return parseRequirementsTxt(content);
  if (lower.endsWith("pyproject.toml")) return parseRequirementsTxt(content);
  if (lower.endsWith("go.mod")) return parseGoMod(content);
  if (lower.endsWith("cargo.toml")) return parseCargoToml(content);
  if (lower.endsWith("pom.xml")) return parseXmlGroupIds(content);
  if (lower.endsWith("build.gradle") || lower.endsWith("build.gradle.kts"))
    return parseGradle(content);
  if (lower.endsWith("gemfile")) return parseGemfile(content);
  if (lower.endsWith("mix.exs")) return parseMixExs(content);
  if (lower.endsWith("composer.json")) return parseComposerJson(content);
  if (lower.endsWith(".csproj") || lower.endsWith(".fsproj")) return parseCsProj(content);
  if (lower.endsWith("package.swift")) return parsePackageSwift(content);
  if (lower.endsWith("pubspec.yaml") || lower.endsWith("pubspec.yml")) return parsePubspec(content);
  if (lower.endsWith("docker-compose.yml") || lower.endsWith("docker-compose.yaml"))
    return parseComposeImageNames(content);
  if (lower.endsWith(".tf") || lower.endsWith(".tfvars")) return parseTerraformResources(content);
  return [];
}

function parsePackageJson(content: string): RawDependency[] {
  try {
    const doc = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const out: RawDependency[] = [];
    for (const section of [doc.dependencies, doc.devDependencies, doc.peerDependencies]) {
      if (!section) continue;
      for (const [name, version] of Object.entries(section)) out.push({ name, version });
    }
    return out;
  } catch {
    return [];
  }
}

function parseComposerJson(content: string): RawDependency[] {
  try {
    const doc = JSON.parse(content) as {
      require?: Record<string, string>;
      "require-dev"?: Record<string, string>;
    };
    const out: RawDependency[] = [];
    for (const section of [doc.require, doc["require-dev"]]) {
      if (!section) continue;
      for (const [name, version] of Object.entries(section)) out.push({ name, version });
    }
    return out;
  } catch {
    return [];
  }
}

/** requirements.txt / pyproject [project].dependencies are line oriented. */
function parseRequirementsTxt(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  for (const rawLine of content.split("\n")) {
    // Remove comments, surrounding quotes, and trailing commas.
    const cleaned = rawLine
      .split("#")[0]!
      .trim()
      .replace(/^["']/, "")
      .replace(/["'],?$/, "");
    if (!cleaned) continue;
    const match = /^([A-Za-z0-9_.-]+)\s*(?:[=<>!~]=?\s*([^\s;]+))?/.exec(cleaned);
    if (!match) continue;
    out.push({ name: match[1]!, version: match[2] });
  }
  return out;
}

function parseGoMod(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
  const blocks = [requireBlock?.[1] ?? ""];
  // Also capture single-line requires.
  for (const line of content.split("\n")) {
    const single = /^require\s+([^\s]+)\s+([^\s]+)/.exec(line);
    if (single) blocks.push(`${single[1]} ${single[2]}`);
  }
  for (const block of blocks) {
    for (const line of block.split("\n")) {
      const m = /^([^\s]+)\s+v?([^\s]+)/.exec(line.trim());
      if (m && m[1]) out.push({ name: m[1], version: m[2] });
    }
  }
  return out;
}

function parseCargoToml(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  let inDeps = false;
  for (const line of content.split("\n")) {
    if (/^\s*\[(?:dev-)?dependencies/.test(line)) {
      inDeps = true;
      continue;
    }
    if (/^\s*\[/.test(line)) {
      inDeps = false;
      continue;
    }
    if (!inDeps) continue;
    const m = /^([A-Za-z0-9_-]+)\s*=\s*["{]/.exec(line);
    if (m && m[1]) out.push({ name: m[1] });
  }
  return out;
}

/** Maven pom.xml: capture groupId:artifactId coordinates. */
function parseXmlGroupIds(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const coords = content.matchAll(/<(?:groupId|artifactId)>([^<]+)<\/(?:groupId|artifactId)>/g);
  const values = [...coords].map((m) => m[1]!.trim()).filter(Boolean);
  // Pair groupId/artifactId conservatively: take every artifactId-looking token.
  for (const v of values) {
    if (/^[a-z][a-zA-Z0-9_.-]*$/.test(v) && !v.includes(".")) out.push({ name: v });
  }
  return out;
}

function parseGradle(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const deps = content.matchAll(/['"]([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+):?([^'"]*)['"]/g);
  for (const m of deps) out.push({ name: m[2]!, version: m[3] || undefined });
  // Also catch 'group:artifact' short forms without version.
  const short = content.matchAll(/['"]([a-zA-Z0-9_.-]+):([a-zA-Z0-9_.-]+)['"]/g);
  for (const m of short) out.push({ name: m[2]! });
  return out;
}

function parseGemfile(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const gems = content.matchAll(/gem\s+['"]([^'"]+)['"]/g);
  for (const m of gems) out.push({ name: m[1]! });
  return out;
}

function parseMixExs(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const deps = content.matchAll(/\{?\s*:([a-zA-Z0-9_-]+),?\s*(?:["'][^"']*["'])?\s*\}/g);
  for (const m of deps) out.push({ name: m[1]! });
  return out;
}

function parseCsProj(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const pkgs = content.matchAll(/<PackageReference\s+Include="([^"]+)"[^>]*\/?>/g);
  for (const m of pkgs) out.push({ name: m[1]! });
  return out;
}

function parsePackageSwift(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const pkgs = content.matchAll(/url:\s*["']([^"']+)["']/g);
  for (const m of pkgs) {
    const name = m[1]!.split("/").at(-1)?.replace(/\.git$/, "") ?? m[1]!;
    out.push({ name });
  }
  return out;
}

function parsePubspec(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const deps = content.matchAll(/^\s*([a-zA-Z0-9_-]+):\s*(?:[\^~<>]?\s*[\d.]+|any)?\s*$/gm);
  for (const m of deps) out.push({ name: m[1]! });
  return out;
}

/**
 * docker-compose image names. Each service image (e.g. "postgres:16") yields a
 * normalized name (base image before ":"). These are later matched as databases
 * and/or external services.
 */
function parseComposeImageNames(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const images = content.matchAll(/image:\s*['"]?([^'"\s]+)/g);
  for (const m of images) {
    const base = m[1]!.split(":")[0]!.toLowerCase();
    out.push({ name: base });
  }
  return out;
}

/** Terraform resource types like `resource "aws_db_instance" "x"`. */
function parseTerraformResources(content: string): RawDependency[] {
  const out: RawDependency[] = [];
  const types = content.matchAll(/resource\s+["']([a-z0-9_]+)["']/g);
  for (const m of types) {
    const type = m[1]!;
    if (/_db_instance$|_cluster$|_cache$|_queue$|_bucket$|_topic$/.test(type))
      out.push({ name: type });
  }
  return out;
}
