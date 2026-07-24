/**
 * SchemaSurfaceExtractor — Phase C of polyglot repository intelligence.
 *
 * Derives a sql/migration/orm/route schema surface deterministically, using
 * lightweight keyword + manifest driven scans (no network, no LLM). It emits:
 *   - SchemaTable / SchemaColumn / SchemaForeignKey / ORMEntity / ORMField /
 *     Route / Migration symbols
 *   - Relationship edges (DB_TABLE_HAS_COLUMN, FOREIGN_KEY, ORM_HAS_FIELD,
 *     ROUTE_EXPOSES, MIGRATION_APPLIES)
 *
 * Like Phase A/B it is inert by default (`enabled = false`) and consumed by
 * RepositoryIndexService.indexFile, so enabling it never replaces existing
 * document-symbol or Phase B output. Every symbol/relationship id is produced
 * through the supplied id provider so that cross-references (FK, migration,
 * route edges) resolve deterministically within a snapshot.
 */

import type { IntelligenceDiagnostic } from "../../../shared/contracts/intelligence";
import {
  detectMigrationFramework,
  detectOrmFramework,
  looksLikeRouteSurface,
  looksLikeSqlDdl,
  type MigrationFramework,
} from "./SchemaRules";

export const SCHEMA_SURFACE_EXTRACTOR_ID = "keystone.schema-surface";
export const SCHEMA_SURFACE_EXTRACTOR_VERSION = "1";

export type SchemaSurfaceKind =
  | "table"
  | "column"
  | "foreign-key"
  | "orm-entity"
  | "orm-field"
  | "route"
  | "migration";

export interface SchemaSurfaceSymbol {
  id: string;
  kind: SchemaSurfaceKind;
  name: string;
  qualifiedName: string;
  language: string;
  line: number;
  confidence: number;
  properties?: Record<string, string | number | boolean | string[]>;
}

export interface SchemaSurfaceRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: string;
  line: number;
  confidence: number;
  /** Filled by RepositoryIndexService before the record is published. */
  evidenceIds?: string[];
}

export interface SchemaSurfaceResult {
  available: boolean;
  extractorId: string;
  extractorVersion: string;
  parseStatus: "parsed" | "partial" | "unsupported";
  symbols: SchemaSurfaceSymbol[];
  relationships: SchemaSurfaceRelationship[];
  diagnostics: IntelligenceDiagnostic[];
}

export interface SchemaSurfaceIdProvider {
  repositoryId: string;
  fileId: string;
  generation: number;
  entity(kind: SchemaSurfaceKind, name: string, discriminator: string): Promise<string>;
  relationship(sourceId: string, targetId: string, type: string, discriminator: string): Promise<string>;
}

export const TABLE_TYPE = "keystone.core.SchemaTable";
export const COLUMN_TYPE = "keystone.core.SchemaColumn";
export const FK_TYPE = "keystone.core.SchemaForeignKey";
export const ORM_ENTITY_TYPE = "keystone.core.ORMEntity";
export const ORM_FIELD_TYPE = "keystone.core.ORMField";
export const ROUTE_TYPE = "keystone.core.Route";
export const MIGRATION_TYPE = "keystone.core.Migration";

export const HAS_COLUMN = "keystone.core.DB_TABLE_HAS_COLUMN";
export const FK_EDGE = "keystone.core.FOREIGN_KEY";
export const ORM_HAS_FIELD = "keystone.core.ORM_HAS_FIELD";
export const ROUTE_EXPOSES = "keystone.core.ROUTE_EXPOSES";
export const MIGRATION_APPLIES = "keystone.core.MIGRATION_APPLIES";

const SQL_TYPE_RE = /^([A-Za-z][A-Za-z0-9]*(?:\s*\([^)]*\))?)/;

/** Parse SQL DDL into tables, columns, and foreign keys (ids via provider). */
async function parseSqlDdl(
  content: string,
  provider: SchemaSurfaceIdProvider,
): Promise<{ symbols: SchemaSurfaceSymbol[]; relationships: SchemaSurfaceRelationship[] }> {
  const symbols: SchemaSurfaceSymbol[] = [];
  const relationships: SchemaSurfaceRelationship[] = [];
  const lines = content.split("\n");
  let currentTable: string | undefined;
  let currentTableId: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const createTable = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
    if (createTable) {
      currentTable = createTable[1]!;
      currentTableId = await provider.entity("table", currentTable, currentTable.toLowerCase());
      symbols.push({
        id: currentTableId,
        kind: "table",
        name: currentTable,
        qualifiedName: currentTable,
        language: "sql",
        line: i + 1,
        confidence: 1,
      });
      continue;
    }

    // FOREIGN KEY may appear as its own ALTER TABLE statement (outside a
    // CREATE TABLE block), so resolve the source table from ALTER TABLE when
    // the in-block table context is no longer available.
    const fk = /\bforeign\s+key\s*\(([^)]+)\)\s*references\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
    if (fk) {
      const refTable = fk[2]!;
      const refId = await provider.entity("table", refTable, refTable.toLowerCase());
      const srcTableMatch = /alter\s+table\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/i.exec(line);
      const srcTable = srcTableMatch?.[1] ?? currentTable;
      const srcId = srcTable ? await provider.entity("table", srcTable, srcTable.toLowerCase()) : currentTableId;
      if (srcId) {
        const fkId = `fk#${srcTable}#${refTable}#${i}`;
        symbols.push({
          id: fkId,
          kind: "foreign-key",
          name: `${srcTable}->${refTable}`,
          qualifiedName: `${srcTable}->${refTable}`,
          language: "sql",
          line: i + 1,
          confidence: 1,
          properties: { references: refTable },
        });
        relationships.push({
          id: await provider.relationship(srcId, refId, FK_EDGE, `${refTable}#${i}`),
          sourceId: srcId,
          targetId: refId,
          type: FK_EDGE,
          line: i + 1,
          confidence: 1,
        });
      }
      continue;
    }

    // End of a CREATE TABLE column block (a line that is just a closing paren)
    // or a standalone ALTER TABLE statement that is not a FK.
    if (/^\s*alter\s+table\b/i.test(line) || /^\s*\)\s*;?\s*$/.test(line)) {
      currentTable = undefined;
      currentTableId = undefined;
      continue;
    }

    if (!currentTable || !currentTableId) continue;

    const col = /^\s*["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?\s+([A-Za-z][A-Za-z0-9]*(?:\s*\([^)]*\))?)/.exec(line);
    if (col) {
      const colName = col[1]!;
      const colType = SQL_TYPE_RE.test(col[2]!) ? col[2]!.trim() : "unknown";
      const colId = await provider.entity("column", `${currentTable}.${colName}`, colName.toLowerCase());
      symbols.push({
        id: colId,
        kind: "column",
        name: colName,
        qualifiedName: `${currentTable}.${colName}`,
        language: "sql",
        line: i + 1,
        confidence: 1,
        properties: { columnType: colType },
      });
      relationships.push({
        id: await provider.relationship(currentTableId, colId, HAS_COLUMN, `${colName}#${i}`),
        sourceId: currentTableId,
        targetId: colId,
        type: HAS_COLUMN,
        line: i + 1,
        confidence: 1,
      });
    }
  }

  return { symbols, relationships };
}

/** Parse an ORM model file (SQLAlchemy/Django/TypeORM/Prisma/Hibernate) into entities + fields. */
async function parseOrmModel(
  language: string,
  content: string,
  provider: SchemaSurfaceIdProvider,
): Promise<{ symbols: SchemaSurfaceSymbol[]; relationships: SchemaSurfaceRelationship[] }> {
  const symbols: SchemaSurfaceSymbol[] = [];
  const relationships: SchemaSurfaceRelationship[] = [];
  const lines = content.split("\n");
  const orm = detectOrmFramework(language, content);
  if (!orm) return { symbols, relationships };

  const entityRe: RegExp =
    language === "python"
      ? /class\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*Base[^)]*\)|class\s+([A-Za-z_][A-Za-z0-9_]*)\(models\.Model\)/
      : language === "java"
        ? /@Entity\s*(?:@Table\([^)]*\)\s*)?public\s+class\s+([A-Za-z_][A-Za-z0-9_]*)/
        : /@Entity\(\)\s*export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)|export\s+class\s+([A-Za-z_][A-Za-z0-9_]*)\s+extends\s+\(\)\s*=>\s*BaseEntity/;

  let currentEntity: string | undefined;
  let currentEntityId: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const ent = entityRe.exec(line);
    if (ent) {
      currentEntity = ent[1] ?? ent[2];
      if (!currentEntity) continue;
      currentEntityId = await provider.entity("orm-entity", currentEntity, currentEntity.toLowerCase());
      symbols.push({
        id: currentEntityId,
        kind: "orm-entity",
        name: currentEntity,
        qualifiedName: `${orm}:${currentEntity}`,
        language,
        line: i + 1,
        confidence: 1,
        properties: { orm },
      });
      continue;
    }
    if (!currentEntity || !currentEntityId) continue;
    const field = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*Column\(|^\s*@Column\([^)]*\)\s*\n?\s*([A-Za-z_][A-Za-z0-9_]*)\s*:|^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(?:string|number|boolean|Date|integer|text|uuid)/.exec(line);
    if (field) {
      const fieldName = (field[1] ?? field[2] ?? field[3])!;
      const fieldId = await provider.entity("orm-field", `${currentEntity}.${fieldName}`, fieldName.toLowerCase());
      symbols.push({
        id: fieldId,
        kind: "orm-field",
        name: fieldName,
        qualifiedName: `${currentEntity}.${fieldName}`,
        language,
        line: i + 1,
        confidence: 0.9,
        properties: { orm },
      });
      relationships.push({
        id: await provider.relationship(currentEntityId, fieldId, ORM_HAS_FIELD, `${fieldName}#${i}`),
        sourceId: currentEntityId,
        targetId: fieldId,
        type: ORM_HAS_FIELD,
        line: i + 1,
        confidence: 0.9,
      });
    }
  }

  return { symbols, relationships };
}

/** Parse a migration file: emit a Migration symbol + references targeted tables. */
async function parseMigration(
  framework: MigrationFramework,
  content: string,
  provider: SchemaSurfaceIdProvider,
): Promise<{ symbols: SchemaSurfaceSymbol[]; relationships: SchemaSurfaceRelationship[] }> {
  const symbols: SchemaSurfaceSymbol[] = [];
  const relationships: SchemaSurfaceRelationship[] = [];
  const migrationId = await provider.entity("migration", framework, framework);
  symbols.push({
    id: migrationId,
    kind: "migration",
    name: framework,
    qualifiedName: framework,
    language: "sql",
    line: 1,
    confidence: 1,
    properties: { framework },
  });
  const tableRefs = new Set<string>();
  const createRe = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = createRe.exec(content))) tableRefs.add(m[1]!);
  const alterRe = /\balter\s+table\s+["`]?([A-Za-z_][A-Za-z0-9_]*)/gi;
  while ((m = alterRe.exec(content))) tableRefs.add(m[1]!);
  for (const table of tableRefs) {
    const refId = await provider.entity("table", table, table.toLowerCase());
    relationships.push({
      id: await provider.relationship(migrationId, refId, MIGRATION_APPLIES, `${table}`),
      sourceId: migrationId,
      targetId: refId,
      type: MIGRATION_APPLIES,
      line: 1,
      confidence: 1,
    });
  }
  return { symbols, relationships };
}

/** Parse a route surface file, emitting Route symbols + ROUTE_EXPOSES edges to tables/entities. */
async function parseRoutes(
  language: string,
  content: string,
  provider: SchemaSurfaceIdProvider,
): Promise<{ symbols: SchemaSurfaceSymbol[]; relationships: SchemaSurfaceRelationship[] }> {
  const symbols: SchemaSurfaceSymbol[] = [];
  const relationships: SchemaSurfaceRelationship[] = [];
  const lines = content.split("\n");
  const routeRe: RegExp =
    language === "python"
      ? /@(app|router)\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/
      : language === "java"
        ? /@(Get|Post|Put|Delete|Patch|Request)Mapping\(\s*["'`]([^"'`]+)["'`]/
        : language === "csharp"
          ? /\[Http(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]+)["'`]|\.Map(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]+)["'`]/
          : /\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]|@(Get|Post|Put|Delete|Patch)\(\s*["'`]([^"'`]+)["'`]/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const r = routeRe.exec(line);
    if (!r) continue;
    const verb =
      language === "python"
        ? (r[2] ?? r[1] ?? "get")
        : language === "java"
          ? (r[1] ?? "get")
          : language === "csharp"
            ? (r[1] ?? r[3] ?? "get")
            : (r[1] ?? r[3] ?? r[4] ?? "get");
    const path =
      language === "python"
        ? (r[3] ?? "/")
        : language === "java"
          ? (r[2] ?? "/")
          : language === "csharp"
            ? (r[2] ?? r[4] ?? "/")
            : (r[2] ?? r[4] ?? "/");
    const method = verb.toUpperCase();
    const routeId = await provider.entity("route", `${method} ${path}`, `${method}#${path}`);
    symbols.push({
      id: routeId,
      kind: "route",
      name: `${method} ${path}`,
      qualifiedName: `${method} ${path}`,
      language,
      line: i + 1,
      confidence: 0.9,
      properties: { method, path },
    });
    const window = lines.slice(i, i + 12).join("\n");
    const tableRe = /\b([A-Z][A-Za-z0-9_]*)(\s*\.\s*query|\s*\.\s*all|\s*\.\s*first)\(|\.from\(["'`]?([A-Z][A-Za-z0-9_]*)|(db|repo|session)\.query\(([A-Z][A-Za-z0-9_]*)/g;
    // SQLAlchemy/SQL-core tokens that look like entity references but are not.
    const NON_ENTITY = new Set([
      "sa", "op", "db", "func", "select", "text", "cast", "case", "and", "or", "not",
      "Column", "Integer", "String", "Text", "Boolean", "Float", "Numeric", "DateTime",
      "Date", "Time", "JSON", "BigInteger", "SmallInteger", "LargeBinary", "Enum",
      "Base", "Table", "MetaData", "Column", "PrimaryKey", "ForeignKey", "Unique",
      "Index", "Check", "UUID", "DECIMAL", "TIMESTAMP", "NULL", "TRUE", "FALSE",
    ]);
    let t: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((t = tableRe.exec(window))) {
      const target = (t[1] ?? t[3] ?? t[5])!;
      if (seen.has(target) || NON_ENTITY.has(target) || target.toLowerCase() === "select") continue;
      seen.add(target);
      // Routes query ORM entity classes (Capitalized) or raw tables (lowercase);
      // reference the matching symbol namespace so the edge resolves at merge.
      const ns = target[0] === target[0]!.toUpperCase() ? "orm-entity" : "table";
      const refId = await provider.entity(ns, target, target.toLowerCase());
      relationships.push({
        id: await provider.relationship(routeId, refId, ROUTE_EXPOSES, `${target}`),
        sourceId: routeId,
        targetId: refId,
        type: ROUTE_EXPOSES,
        line: i + 1,
        confidence: 0.6,
      });
    }
  }
  return { symbols, relationships };
}

export class SchemaSurfaceExtractor {
  enabled = false;

  async extract(
    relativePath: string,
    language: string,
    content: string,
    provider: SchemaSurfaceIdProvider,
  ): Promise<SchemaSurfaceResult> {
    if (!this.enabled) {
      return {
        available: false,
        extractorId: SCHEMA_SURFACE_EXTRACTOR_ID,
        extractorVersion: SCHEMA_SURFACE_EXTRACTOR_VERSION,
        parseStatus: "unsupported",
        symbols: [],
        relationships: [],
        diagnostics: [],
      };
    }
    const diagnostics: IntelligenceDiagnostic[] = [];
    const symbols: SchemaSurfaceSymbol[] = [];
    const relationships: SchemaSurfaceRelationship[] = [];

    try {
      if (looksLikeSqlDdl(relativePath, language, content)) {
        const sql = await parseSqlDdl(content, provider);
        symbols.push(...sql.symbols);
        relationships.push(...sql.relationships);
      }
      const orm = await parseOrmModel(language, content, provider);
      symbols.push(...orm.symbols);
      relationships.push(...orm.relationships);
      const migration = detectMigrationFramework(relativePath, content);
      if (migration) {
        const mig = await parseMigration(migration.framework, content, provider);
        symbols.push(...mig.symbols);
        relationships.push(...mig.relationships);
      }
      if (looksLikeRouteSurface(language, content)) {
        const routes = await parseRoutes(language, content, provider);
        symbols.push(...routes.symbols);
        relationships.push(...routes.relationships);
      }
    } catch (error) {
      diagnostics.push({
        code: "schema-surface-extract-failed",
        severity: "warning",
        message: `Schema surface extraction failed: ${error instanceof Error ? error.message : String(error)}`,
        relativePath,
      });
    }

    return {
      available: symbols.length > 0,
      extractorId: SCHEMA_SURFACE_EXTRACTOR_ID,
      extractorVersion: SCHEMA_SURFACE_EXTRACTOR_VERSION,
      parseStatus: symbols.length > 0 ? "parsed" : "partial",
      symbols,
      relationships,
      diagnostics,
    };
  }
}
