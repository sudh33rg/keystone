/* eslint-disable no-useless-escape -- SQL identifier regexes keep explicit bracket escapes for dialect readability. */
import { posix } from "node:path";
import type { AdapterCapability, AdapterDetection } from "../../../shared/contracts/adapters";
import type { IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import { rangeAt, safePropertyName, wholeRange } from "./AdapterEvidenceFactory";
import type { AdapterOutputBuilder} from "./BaseAdapter";
import { DeterministicAdapter, detection, importsModule, lines } from "./BaseAdapter";
import { capability } from "./UniversalAdapters";

export class DeterministicDatabaseAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.database.sql";
  readonly version = "1.0.0";
  capability(): AdapterCapability { return capability(this, "database", ["sql", "sql-migration"], "tier-4", "structural", ["keystone.core.Database", "keystone.core.Schema", "keystone.core.Table", "keystone.core.Column", "keystone.core.Index", "keystone.core.ForeignKey", "keystone.core.Migration", "keystone.core.Query", "keystone.core.View", "keystone.core.StoredProcedure"], ["keystone.core.CONTAINS", "keystone.core.HAS_COLUMN", "keystone.core.HAS_INDEX", "keystone.core.REFERENCES_COLUMN", "keystone.core.CREATES", "keystone.core.ALTERS", "keystone.core.DROPS", "keystone.core.READS_FROM", "keystone.core.WRITES_TO"], ["Common ANSI/PostgreSQL/MySQL/SQLite DDL is recognized.", "Procedural bodies and unsupported dialect clauses are diagnosed and not interpreted."]); }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const sql = files.filter((file) => /\.sql$/i.test(file.relativePath)); const migrations = sql.filter((file) => file.category === "migration" || /(^|\/)migrations?\//i.test(file.relativePath));
    return [...(sql.length ? [detection(this.id, "sql", "structural", sql, "extension", "SQL extension matched.", 1, this.capability().limitations)] : []), ...(migrations.length ? [detection(this.id, "sql-migration", "structural", migrations, "format", "Migration classification and SQL DDL matched.")] : [])];
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) this.extractSql(file, output);
  }
  private extractSql(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const database = output.entity(file, "keystone.core.Database", "database", `${file.relativePath}#database`, wholeRange(file.content), { dialect: detectDialect(file.content) });
    const schema = output.entity(file, "keystone.core.Schema", "default", `${file.relativePath}#schema:default`, wholeRange(file.content), { schemaKind: "database", dialect: detectDialect(file.content) });
    output.relationship(database, schema, "keystone.core.CONTAINS", file, schema.range);
    const migration = file.category === "migration" || /(^|\/)migrations?\//i.test(file.relativePath) ? output.entity(file, "keystone.core.Migration", posix.basename(file.relativePath), file.relativePath, wholeRange(file.content), { dialect: detectDialect(file.content) }) : undefined;
    const tableByName = new Map<string, IntelligenceSymbolRecord>(); const columnByName = new Map<string, IntelligenceSymbolRecord>();
    for (const match of file.content.matchAll(/CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)\s*\(([\s\S]*?)\)\s*;/gi)) if (match.index !== undefined && match[1]) {
      const rawName = cleanSqlName(match[1]); const start = match.index + match[0].indexOf(match[1]);
      const table = output.entity(file, "keystone.core.Table", rawName.split(".").at(-1) ?? rawName, `${file.relativePath}#table:${rawName.toLowerCase()}`, rangeAt(file.content, start, start + match[1].length), { databaseName: rawName, canonicalName: rawName.toLowerCase(), dialect: detectDialect(file.content) });
      tableByName.set(rawName.toLowerCase(), table); output.relationship(schema, table, "keystone.core.CONTAINS", file, table.range);
      if (migration) output.relationship(migration, table, "keystone.core.CREATES", file, table.range);
      const body = match[2] ?? ""; const bodyStart = match.index + match[0].indexOf(body);
      for (const part of splitSqlColumns(body)) {
        const column = part.text.match(/^\s*([`"\[]?[A-Za-z_]\w*[`"\]]?)\s+([A-Za-z][\w]*(?:\s*\([^)]*\))?)/i);
        if (!column?.[1] || /^(?:CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|INDEX|KEY)$/i.test(cleanSqlName(column[1]))) continue;
        const name = cleanSqlName(column[1]); const startColumn = bodyStart + part.start + part.text.indexOf(column[1]);
        const entity = output.entity(file, "keystone.core.Column", name, `${table.qualifiedName}.${name.toLowerCase()}`, rangeAt(file.content, startColumn, startColumn + column[1].length), { columnType: safePropertyName(column[2] ?? ""), nullable: !/NOT\s+NULL/i.test(part.text), canonicalName: `${rawName.toLowerCase()}.${name.toLowerCase()}` });
        columnByName.set(`${rawName.toLowerCase()}.${name.toLowerCase()}`, entity); output.relationship(table, entity, "keystone.core.HAS_COLUMN", file, entity.range);
      }
      for (const fk of body.matchAll(/FOREIGN\s+KEY\s*\(\s*([`"\[]?\w+[`"\]]?)\s*\)\s*REFERENCES\s+([`"\[]?[\w.]+[`"\]]?)\s*\(\s*([`"\[]?\w+[`"\]]?)\s*\)/gi)) if (fk.index !== undefined && fk[1] && fk[2] && fk[3]) {
        const fkEntity = output.entity(file, "keystone.core.ForeignKey", `${cleanSqlName(fk[1])}->${cleanSqlName(fk[2])}.${cleanSqlName(fk[3])}`, `${table.qualifiedName}#fk:${fk.index}`, rangeAt(file.content, bodyStart + fk.index, bodyStart + fk.index + fk[0].length), { sourceTable: rawName, sourceColumn: cleanSqlName(fk[1]), targetTable: cleanSqlName(fk[2]), targetColumn: cleanSqlName(fk[3]) });
        output.relationship(table, fkEntity, "keystone.core.HAS_FOREIGN_KEY", file, fkEntity.range);
      }
    }
    for (const match of file.content.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+([`"\[]?\w+[`"\]]?)\s+ON\s+([`"\[]?[\w.]+[`"\]]?)/gi)) if (match.index !== undefined && match[1] && match[2]) {
      const table = tableByName.get(cleanSqlName(match[2]).toLowerCase()); if (!table) continue;
      const entity = output.entity(file, "keystone.core.Index", cleanSqlName(match[1]), `${table.qualifiedName}#index:${cleanSqlName(match[1])}`, rangeAt(file.content, match.index, match.index + match[0].length), { unique: /CREATE\s+UNIQUE/i.test(match[0]) });
      output.relationship(table, entity, "keystone.core.HAS_INDEX", file, entity.range);
    }
    for (const fk of file.content.matchAll(/FOREIGN\s+KEY\s*\(\s*([`"\[]?\w+[`"\]]?)\s*\)\s*REFERENCES\s+([`"\[]?[\w.]+[`"\]]?)\s*\(\s*([`"\[]?\w+[`"\]]?)\s*\)/gi)) if (fk.index !== undefined && fk[1] && fk[2] && fk[3]) {
      const prefix = file.content.slice(0, fk.index); const declarations = [...prefix.matchAll(/CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([`"\[]?[\w.]+[`"\]]?)/gi)]; const sourceTable = cleanSqlName(declarations.at(-1)?.[1] ?? ""); const table = tableByName.get(sourceTable.toLowerCase()); if (!table) continue;
      const fkEntity = output.entity(file, "keystone.core.ForeignKey", `${cleanSqlName(fk[1])}->${cleanSqlName(fk[2])}.${cleanSqlName(fk[3])}`, `${table.qualifiedName}#fk-global:${fk.index}`, rangeAt(file.content, fk.index, fk.index + fk[0].length), { sourceTable, sourceColumn: cleanSqlName(fk[1]), targetTable: cleanSqlName(fk[2]), targetColumn: cleanSqlName(fk[3]) }); output.relationship(table, fkEntity, "keystone.core.HAS_FOREIGN_KEY", file, fkEntity.range);
      const source = columnByName.get(`${sourceTable.toLowerCase()}.${cleanSqlName(fk[1]).toLowerCase()}`); const target = columnByName.get(`${cleanSqlName(fk[2]).toLowerCase()}.${cleanSqlName(fk[3]).toLowerCase()}`); if (source && target) output.relationship(source, target, "keystone.core.REFERENCES_COLUMN", file, fkEntity.range);
    }
    for (const match of file.content.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+([`"\[]?[\w.]+[`"\]]?)/gi)) if (match.index !== undefined && match[1]) {
      const view = output.entity(file, "keystone.core.View", cleanSqlName(match[1]), `${file.relativePath}#view:${cleanSqlName(match[1])}`, rangeAt(file.content, match.index, match.index + match[0].length), { dialect: detectDialect(file.content) }); output.relationship(database, view, "keystone.core.CONTAINS", file, view.range);
    }
    if (migration) for (const match of file.content.matchAll(/ALTER\s+TABLE\s+([`"\[]?[\w.]+[`"\]]?)/gi)) if (match.index !== undefined && match[1]) {
      const target = tableByName.get(cleanSqlName(match[1]).toLowerCase()) ?? output.entity(file, "keystone.core.Table", cleanSqlName(match[1]), `${file.relativePath}#table-reference:${cleanSqlName(match[1]).toLowerCase()}`, rangeAt(file.content, match.index, match.index + match[0].length), { canonicalName: cleanSqlName(match[1]).toLowerCase(), declarationStatus: "referenced" }, 0.9);
      output.relationship(migration, target, "keystone.core.ALTERS", file, rangeAt(file.content, match.index, match.index + match[0].length), { resolution: tableByName.has(cleanSqlName(match[1]).toLowerCase()) ? "exact" : "syntactic", confidence: tableByName.has(cleanSqlName(match[1]).toLowerCase()) ? 1 : 0.9 });
    }
    for (const match of file.content.matchAll(/\b(SELECT[\s\S]*?\bFROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([`"\[]?[\w.]+[`"\]]?)/gi)) if (match.index !== undefined && match[1] && match[2]) {
      const table = tableByName.get(cleanSqlName(match[2]).toLowerCase()); if (!table) continue;
      const query = output.entity(file, "keystone.core.Query", `${match[1].split(/\s/)[0]?.toUpperCase()} ${cleanSqlName(match[2])}`, `${file.relativePath}#query:${match.index}`, rangeAt(file.content, match.index, match.index + match[0].length), { operation: match[1].split(/\s/)[0]?.toUpperCase() ?? "QUERY" });
      output.relationship(query, table, /^SELECT/i.test(match[1]) ? "keystone.core.READS_FROM" : "keystone.core.WRITES_TO", file, query.range);
    }
    for (const fk of output.entities.values()) if (fk.type === "keystone.core.ForeignKey") {
      const target = columnByName.get(`${String(fk.properties?.targetTable).toLowerCase()}.${String(fk.properties?.targetColumn).toLowerCase()}`); const source = columnByName.get(`${String(fk.properties?.sourceTable).toLowerCase()}.${String(fk.properties?.sourceColumn).toLowerCase()}`);
      if (source && target) output.relationship(source, target, "keystone.core.REFERENCES_COLUMN", file, fk.range);
    }
    if (/\b(?:DELIMITER|PL\/SQL|LANGUAGE\s+plpgsql|GO\s*$)/im.test(file.content)) output.diagnostic("unsupported-sql-procedural-body", "info", "Vendor procedural SQL bodies are not interpreted.", file, undefined, { technologyId: "sql", limitation: true });
  }
}

export class DeterministicOrmAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.orm";
  readonly version = "1.0.0";
  capability(): AdapterCapability { return capability(this, "orm", ["prisma", "jpa", "entity-framework", "django-orm", "sqlalchemy", "typeorm", "sequelize", "rails-activerecord", "eloquent", "gorm", "diesel", "mongoose"], "tier-4", "structural", ["keystone.core.OrmEntity", "keystone.core.OrmField", "keystone.core.RepositoryPattern", "keystone.core.Migration"], ["keystone.core.HAS_FIELD", "keystone.core.RELATES_TO", "keystone.core.MAPS_TO", "keystone.core.PERSISTS"], ["Explicit mappings are exact; naming-convention mappings are confidence 0.65.", "Runtime model mutation and implicit query behavior are unsupported."]); }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const groups: Array<[string, SemanticSourceFileInput[], "extension" | "syntax"]> = [
      ["prisma", files.filter((file) => /\.prisma$/i.test(file.relativePath)), "extension"],
      ["jpa", files.filter((file) => /@(?:Entity|Table)\b/.test(file.content) && /\.java$/i.test(file.relativePath)), "syntax"],
      ["entity-framework", files.filter((file) => /\bDbContext\b|\[Table\s*\(/.test(file.content) && /\.cs$/i.test(file.relativePath)), "syntax"],
      ["django-orm", files.filter((file) => /models\.Model\b/.test(file.content) && /\.py$/i.test(file.relativePath)), "syntax"],
      ["sqlalchemy", files.filter((file) => /__tablename__\s*=|declarative_base\s*\(/.test(file.content) && /\.py$/i.test(file.relativePath)), "syntax"],
      ["typeorm", files.filter((file) => importsModule(file, ["typeorm"]) && /@Entity\s*\(/.test(file.content)), "syntax"],
      ["gorm", files.filter((file) => /gorm\.Model|TableName\s*\(/.test(file.content) && /\.go$/i.test(file.relativePath)), "syntax"]
    ];
    return groups.filter(([, selected]) => selected.length).map(([technology, selected, kind]) => detection(this.id, technology, "structural", selected, kind, `Explicit ${technology} schema syntax matched.`, 0.95, this.capability().limitations));
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) if (/\.prisma$/i.test(file.relativePath)) this.prisma(file, output); else this.annotated(file, output);
  }
  private prisma(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const models = new Map<string, IntelligenceSymbolRecord>();
    for (const match of file.content.matchAll(/model\s+([A-Za-z_]\w*)\s*\{([\s\S]*?)\}/g)) if (match.index !== undefined && match[1]) {
      const body = match[2] ?? ""; const explicitTable = body.match(/@@map\(\s*["']([^"']+)["']\s*\)/)?.[1]; const table = explicitTable ?? pluralizeConvention(match[1]);
      const start = match.index + match[0].indexOf(match[1]); const entity = output.entity(file, "keystone.core.OrmEntity", match[1], `${file.relativePath}#model:${match[1]}`, rangeAt(file.content, start, start + match[1].length), { orm: "prisma", tableName: table, mappingKind: explicitTable ? "explicit" : "convention" }); models.set(match[1], entity);
      const bodyStart = match.index + match[0].indexOf(body);
      for (const line of lines(body)) {
        const field = line.text.match(/^\s*([A-Za-z_]\w*)\s+([A-Za-z_]\w*)(\[\])?(\?)?(.*)$/); if (!field?.[1] || !field[2] || field[1].startsWith("@@")) continue;
        const explicitColumn = field[5]?.match(/@map\(\s*["']([^"']+)["']\s*\)/)?.[1]; const column = explicitColumn ?? field[1]; const fieldStart = bodyStart + line.start + line.text.indexOf(field[1]);
        const value = output.entity(file, "keystone.core.OrmField", field[1], `${entity.qualifiedName}.${field[1]}`, rangeAt(file.content, fieldStart, fieldStart + field[1].length), { orm: "prisma", fieldType: field[2], columnName: column, mappingKind: explicitColumn ? "explicit" : "convention", optional: Boolean(field[4]), list: Boolean(field[3]) });
        output.relationship(entity, value, "keystone.core.HAS_FIELD", file, value.range);
      }
    }
    for (const model of models.values()) for (const field of output.entities.values()) if (field.type === "keystone.core.OrmField" && field.qualifiedName.startsWith(`${model.qualifiedName}.`)) {
      const target = models.get(String(field.properties?.fieldType)); if (target) output.relationship(model, target, "keystone.core.RELATES_TO", file, field.range, { resolution: "exact", properties: { field: field.name } });
    }
  }
  private annotated(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const expressions = [/@Entity(?:\(\s*(?:name\s*=\s*)?["']([^"']+)["']\s*\))?[\s\S]{0,240}?class\s+([A-Za-z_]\w*)/g, /\[Table\(\s*["']([^"']+)["']\s*\)\][\s\S]{0,160}?class\s+([A-Za-z_]\w*)/g, /class\s+([A-Za-z_]\w*)\s*\([^)]*models\.Model[^)]*\)/g, /class\s+([A-Za-z_]\w*)[\s\S]{0,400}?__tablename__\s*=\s*["']([^"']+)["']/g];
    for (const expression of expressions) for (const match of file.content.matchAll(expression)) if (match.index !== undefined) {
      const className = expression === expressions[2] ? match[1] : expression === expressions[3] ? match[1] : match[2]; const explicit = expression === expressions[2] ? undefined : expression === expressions[3] ? match[2] : match[1]; if (!className) continue;
      const table = explicit ?? pluralizeConvention(className); const start = match.index + match[0].lastIndexOf(className);
      output.entity(file, "keystone.core.OrmEntity", className, `${file.relativePath}#orm:${className}`, rangeAt(file.content, start, start + className.length), { orm: ormName(file), tableName: table, mappingKind: explicit ? "explicit" : "convention" }, explicit ? 1 : 0.65);
    }
  }
}

export class DeterministicTestFrameworkAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.test-framework";
  readonly version = "1.0.0";
  capability(): AdapterCapability { return capability(this, "test", ["junit", "testng", "pytest", "unittest", "xunit", "nunit", "mstest", "go-testing", "rust-test", "rspec", "phpunit", "playwright", "cypress", "vitest", "jest", "mocha"], "tier-3", "structural", ["keystone.core.TestSuite", "keystone.core.TestCase", "keystone.core.Fixture", "keystone.core.Mock", "keystone.core.TestHook"], ["keystone.core.CONTAINS", "keystone.core.TESTS", "keystone.core.MOCKS"], ["Naming-only production mappings are candidates at confidence 0.35.", "Coverage-file ingestion is not implemented."]); }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const signatures: Record<string, RegExp> = { junit: /org\.junit|@ParameterizedTest|@Test\b/, testng: /org\.testng/, pytest: /pytest|@pytest\./, unittest: /unittest\.TestCase/, xunit: /\[(?:Fact|Theory)\]/, nunit: /\[(?:Test|TestCase)\]/, mstest: /\[TestMethod\]/, "go-testing": /\*testing\.T|func\s+Test\w+/, "rust-test": /#\[test\]/, rspec: /RSpec\.describe|\bdescribe\s+["']/, phpunit: /PHPUnit|extends\s+TestCase/, playwright: /@playwright\/test|\btest\s*\(/, cypress: /\bcy\./, vitest: /from\s+["']vitest["']/, jest: /@jest\/|jest\./, mocha: /from\s+["']mocha["']|\bdescribe\s*\(/ };
    return Object.entries(signatures).flatMap(([technology, expression]) => { const selected = files.filter((file) => testFrameworkMatches(file, technology, expression)); return selected.length ? [detection(this.id, technology, "structural", selected, "syntax", `Explicit ${technology} import or syntax matched.`, 0.95)] : []; });
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      const suiteName = posix.basename(file.relativePath); const suite = output.entity(file, "keystone.core.TestSuite", suiteName, `${file.relativePath}#suite`, wholeRange(file.content), { framework: detectedTestFramework(file) });
      const expressions = [/(?:^|\n)\s*(?:@(?:Test|ParameterizedTest|TestCase|Fact|Theory|TestMethod)[^\n]*\n\s*)*(?:public\s+|private\s+|protected\s+|async\s+)*(?:void\s+|def\s+|fun\s+|func\s+|fn\s+)?(test[A-Za-z_0-9]*|Test[A-Za-z_0-9]+)\s*\(/g, /\b(?:it|test|specify)\s*\(\s*["'`]([^"'`]+)["'`]/g];
      for (const expression of expressions) for (const match of file.content.matchAll(expression)) if (match.index !== undefined && match[1]) {
        const start = match.index + match[0].lastIndexOf(match[1]); const test = output.entity(file, "keystone.core.TestCase", match[1], `${file.relativePath}#test:${match[1]}:${start}`, rangeAt(file.content, start, start + match[1].length), { framework: detectedTestFramework(file), parameterized: /Parameterized|TestCase|Theory/.test(match[0]), skipped: /skip|disabled|ignore/i.test(match[0]) }); output.relationship(suite, test, "keystone.core.CONTAINS", file, test.range);
      }
      for (const hook of file.content.matchAll(/\b(beforeEach|afterEach|beforeAll|afterAll|setUp|tearDown)\s*\(/g)) if (hook.index !== undefined && hook[1]) {
        const entity = output.entity(file, "keystone.core.TestHook", hook[1], `${file.relativePath}#hook:${hook[1]}:${hook.index}`, rangeAt(file.content, hook.index, hook.index + hook[0].length), { framework: detectedTestFramework(file) }); output.relationship(suite, entity, "keystone.core.CONTAINS", file, entity.range);
      }
    }
  }
}

function cleanSqlName(value: string): string { return value.replace(/^[`"\[]|[`"\]]$/g, ""); }
function splitSqlColumns(body: string): Array<{ text: string; start: number }> { const result = []; let depth = 0; let start = 0; for (let index = 0; index < body.length; index++) { const char = body[index]; if (char === "(") depth++; else if (char === ")") depth--; else if (char === "," && depth === 0) { result.push({ text: body.slice(start, index), start }); start = index + 1; } } result.push({ text: body.slice(start), start }); return result; }
function detectDialect(content: string): string { if (/\bSERIAL\b|\bplpgsql\b|::\w+/.test(content)) return "postgresql"; if (/\bAUTO_INCREMENT\b|ENGINE\s*=/.test(content)) return "mysql"; if (/\bAUTOINCREMENT\b|PRAGMA\b/.test(content)) return "sqlite"; return "ansi"; }
function pluralizeConvention(name: string): string { const snake = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(); return snake.endsWith("s") ? snake : `${snake}s`; }
function ormName(file: SemanticSourceFileInput): string { if (/\.java$/i.test(file.relativePath)) return "jpa"; if (/\.cs$/i.test(file.relativePath)) return "entity-framework"; if (/\.py$/i.test(file.relativePath)) return /__tablename__/.test(file.content) ? "sqlalchemy" : "django-orm"; if (/\.go$/i.test(file.relativePath)) return "gorm"; return "typeorm"; }
function detectedTestFramework(file: SemanticSourceFileInput): string {
  const checks: Array<[string, RegExp]> = [["playwright", /@playwright\/test/], ["cypress", /\bcy\./], ["vitest", /from\s+["']vitest/], ["jest", /jest\./], ["mocha", /\bdescribe\s*\(/], ["junit", /org\.junit|@ParameterizedTest|@Test\b/], ["pytest", /pytest|@pytest/], ["xunit", /\[(?:Fact|Theory)\]/], ["go-testing", /\*testing\.T/], ["rust-test", /#\[test\]/], ["phpunit", /PHPUnit/]];
  return checks.find(([technology, expression]) => testFrameworkMatches(file, technology, expression))?.[0] ?? "unknown";
}
function testFrameworkMatches(file: SemanticSourceFileInput, technology: string, expression: RegExp): boolean {
  const languageFamilies: Record<string, string[]> = { junit: ["java", "kotlin"], testng: ["java", "kotlin"], pytest: ["python"], unittest: ["python"], xunit: ["csharp"], nunit: ["csharp"], mstest: ["csharp"], "go-testing": ["go"], "rust-test": ["rust"], rspec: ["ruby"], phpunit: ["php"] };
  const allowed = languageFamilies[technology];
  if (allowed) return allowed.includes(file.language) && expression.test(file.content);
  if (technology === "playwright") return importsModule(file, ["@playwright/test"]);
  if (technology === "vitest") return importsModule(file, ["vitest"]);
  if (technology === "mocha") return importsModule(file, ["mocha"]);
  if (technology === "jest") return importsModule(file, ["@jest/globals", "jest"]);
  if (technology === "cypress") return importsModule(file, ["cypress"]) || /(?:^|\/)cypress(?:\/|$)|\.cy\.[jt]sx?$/.test(file.relativePath);
  return false;
}
