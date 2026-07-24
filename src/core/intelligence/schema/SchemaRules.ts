/**
 * SchemaRules — deterministic detection of migration frameworks and ORM
 * tooling from file paths/names and light content probes.
 *
 * Pure + dependency free. Mirrors the keyword-driven style of TechnologyRegistry
 * (Phase B) but focused on the schema/migration surface (Phase C).
 */

export type MigrationFramework =
  | "alembic"
  | "django-migrations"
  | "flyway"
  | "liquibase"
  | "rails-migrations"
  | "prisma-migrate"
  | "typeorm-migration"
  | "sql-migration";

export interface MigrationFrameworkMatch {
  framework: MigrationFramework;
  confidence: number;
}

/** True when the relative path sits inside a known migrations directory. */
export function detectMigrationFramework(relativePath: string, content: string): MigrationFrameworkMatch | undefined {
  const lower = relativePath.toLowerCase();
  if (/\/versions\/.+\.py$/.test(lower) || /alembic/.test(lower)) {
    return { framework: "alembic", confidence: 1 };
  }
  // Prisma/TypeORM paths contain "/migrations/" too, so they must be checked
  // BEFORE the generic django "/migrations/" branch below.
  if (/prisma\/migrations\//.test(lower) || /migration_lock\.toml/.test(lower)) {
    return { framework: "prisma-migrate", confidence: 1 };
  }
  if (/typeorm\/migrations\//.test(lower) || /typeorm.*migration/i.test(lower)) {
    return { framework: "typeorm-migration", confidence: 1 };
  }
  if (/\/migrations\/\d{4}_.+\.py$/.test(lower) || /(^|\/)migrations\//.test(lower)) {
    return { framework: "django-migrations", confidence: 1 };
  }
  if (/^v\d+__.*\.sql$/i.test(basename(lower)) || /flyway/.test(lower)) {
    return { framework: "flyway", confidence: 1 };
  }
  if (/liquibase/.test(lower) || /\.xml$/.test(lower)) {
    if (/<changeSet|<databaseChangeLog/.test(content)) return { framework: "liquibase", confidence: 1 };
  }
  if (/\/db\/migrate\/\d+_.*\.rb$/.test(lower) || /(^|\/)db\/migrate\/\d+_.*\.rb$/.test(lower) || /rails/.test(lower)) {
    return { framework: "rails-migrations", confidence: 1 };
  }
  if (/migration(_engine)?\.sql$/.test(lower) || /migration\.sql$/.test(lower)) {
    return { framework: "sql-migration", confidence: 0.8 };
  }
  if (/migration/.test(lower)) return { framework: "sql-migration", confidence: 0.5 };
  return undefined;
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] ?? p;
}

/** Detect the active ORM framework from a source file's content. */
export function detectOrmFramework(language: string, content: string): string | undefined {
  if (language === "python") {
    if (/\bdeclarative_base\(|class .*\(Base\)|\bColumn\(|__tablename__/.test(content)) return "sqlalchemy";
    if (/models\.Model|django\.db/.test(content)) return "django";
  }
  if (language === "typescript" || language === "javascript") {
    if (/@Entity\(|from "typeorm"|from 'typeorm'/.test(content)) return "typeorm";
    if (/\bmodel\s+\w+\s*\{|\bprovider\s*=\s*"|\bschema\s+\w+/.test(content)) return "prisma";
  }
  if (language === "java") {
    if (/@Entity|@Table\(|javax\.persistence|jakarta\.persistence/.test(content)) return "hibernate";
  }
  return undefined;
}

/** True when a file looks like a web/routing surface. */
export function looksLikeRouteSurface(language: string, content: string): boolean {
  if (language === "python") return /@app\.(get|post|put|delete|patch)|@router\.(get|post|put|delete|patch)|@app\.route/.test(content);
  if (language === "typescript" || language === "javascript") {
    return /\.(get|post|put|delete|patch)\(\s*["'`]/.test(content) || /@(Get|Post|Put|Delete|Patch|Controller)\(/.test(content);
  }
  if (language === "java") return /@(GetMapping|PostMapping|PutMapping|DeleteMapping|RequestMapping|RestController)/.test(content);
  if (language === "csharp") {
    return /\[(HttpGet|HttpPost|HttpPut|HttpDelete|HttpPatch|Route)(\(|\])/.test(content) || /\.Map(Get|Post|Put|Delete|Patch)\(\s*["'`]/.test(content);
  }
  return false;
}

/** True when a file is SQL DDL. */
export function looksLikeSqlDdl(relativePath: string, language: string, content: string): boolean {
  if (language === "sql") return true;
  if (/\.sql$/.test(relativePath.toLowerCase())) return true;
  return /\bcreate\s+table\b/i.test(content) || /\balter\s+table\b/i.test(content);
}
