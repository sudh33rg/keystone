import type { AdapterOutput } from "../../../shared/contracts/adapters";
import type {
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import { AdapterOutputBuilder } from "./BaseAdapter";
import type { AdapterContext, AdapterInput } from "./IntelligenceAdapter";

export class CrossTechnologyLinker {
  readonly id = "keystone.adapter.cross-technology";
  readonly version = "1.0.0";

  link(
    context: AdapterContext,
    outputs: readonly AdapterOutput[],
    existingEntities: readonly IntelligenceSymbolRecord[],
    existingRelationships: readonly IntelligenceRelationshipRecord[],
  ): AdapterOutput {
    const input: AdapterInput = {
      files: context.allFiles,
      context: { ...context, detections: [] },
    };
    const builder = new AdapterOutputBuilder(this.id, this.version, input, context.allFiles);
    const entities = [...existingEntities, ...outputs.flatMap((output) => output.entities)];
    const relationships = [
      ...existingRelationships,
      ...outputs.flatMap((output) => output.relationships),
    ];
    const entityById = new Map(entities.map((entity) => [entity.id, entity]));
    const fileById = new Map(context.allFiles.map((file) => [file.fileId, file]));

    this.linkRoutes(builder, entities, relationships, entityById, fileById);
    this.linkOrm(builder, entities, fileById);
    this.linkMigrations(builder, entities, relationships, entityById, fileById);
    this.linkBuildSteps(builder, entities, fileById);
    this.linkConfiguration(builder, entities, fileById);
    return builder.finish(0);
  }

  private linkRoutes(
    builder: AdapterOutputBuilder,
    entities: IntelligenceSymbolRecord[],
    relationships: IntelligenceRelationshipRecord[],
    entityById: Map<string, IntelligenceSymbolRecord>,
    fileById: Map<string, SemanticSourceFileInput>,
  ): void {
    const endpoints = groupBy(
      entities.filter((item) => item.type === "keystone.core.Endpoint"),
      (item) => routeKey(item.properties?.httpMethod, item.properties?.path),
    );
    for (const relationship of relationships.filter(
      (item) =>
        [
          "keystone.core.ROUTES_TO",
          "keystone.core.HANDLES",
          "keystone.core.REGISTERS_HANDLER",
        ].includes(item.type) &&
        item.properties?.method &&
        item.properties?.path,
    )) {
      const key = routeKey(relationship.properties?.method, relationship.properties?.path);
      const matches = endpoints.get(key) ?? [];
      const handler =
        entityById.get(relationship.targetId) ?? entityById.get(relationship.sourceId);
      const owner = relationship.ownerFileId ? fileById.get(relationship.ownerFileId) : undefined;
      if (!handler || !owner) continue;
      if (matches.length === 1 && matches[0]) {
        const endpoint = matches[0];
        const targetFile = fileById.get(endpoint.fileId);
        builder.relationship(
          handler,
          endpoint,
          "keystone.core.IMPLEMENTS_CONTRACT_OPERATION",
          owner,
          handler.range,
          {
            derivation: "calculated",
            resolution: "exact",
            confidence: 1,
            properties: { linkRule: "exact-http-method-path", classification: "exact" },
            ...(targetFile ? { secondary: targetFile } : {}),
          },
        );
      } else if (matches.length > 1)
        builder.diagnostic(
          "ambiguous-cross-link",
          "warning",
          `Exact route key ${key} matches multiple contract endpoints; no link was created.`,
          owner,
          handler.range,
          { technologyId: "openapi", ambiguity: true },
        );
    }
  }

  private linkOrm(
    builder: AdapterOutputBuilder,
    entities: IntelligenceSymbolRecord[],
    fileById: Map<string, SemanticSourceFileInput>,
  ): void {
    const tables = groupBy(
      entities.filter(
        (item) =>
          item.type === "keystone.core.Table" &&
          item.properties?.canonicalName &&
          item.properties.declarationStatus !== "referenced",
      ),
      (item) => normalizeName(item.properties?.canonicalName),
    );
    for (const orm of entities.filter(
      (item) => item.type === "keystone.core.OrmEntity" && item.properties?.tableName,
    )) {
      const matches = tables.get(normalizeName(orm.properties?.tableName)) ?? [];
      const owner = fileById.get(orm.fileId);
      if (!owner) continue;
      if (matches.length === 1 && matches[0]) {
        const table = matches[0];
        const mappingKind = orm.properties?.mappingKind === "explicit" ? "exact" : "convention";
        const targetFile = fileById.get(table.fileId);
        builder.relationship(orm, table, "keystone.core.MAPS_TO", owner, orm.range, {
          derivation: "calculated",
          resolution: mappingKind,
          confidence: mappingKind === "exact" ? 1 : 0.65,
          properties: {
            linkRule:
              mappingKind === "exact"
                ? "explicit-table-mapping"
                : "documented-orm-naming-convention",
            classification: mappingKind,
          },
          ...(targetFile ? { secondary: targetFile } : {}),
        });
      } else if (matches.length > 1)
        builder.diagnostic(
          "ambiguous-cross-link",
          "warning",
          `ORM table key ${String(orm.properties?.tableName)} matches multiple tables; no mapping was created.`,
          owner,
          orm.range,
          { technologyId: String(orm.properties?.orm ?? "orm"), ambiguity: true },
        );
    }
  }

  private linkBuildSteps(
    builder: AdapterOutputBuilder,
    entities: IntelligenceSymbolRecord[],
    fileById: Map<string, SemanticSourceFileInput>,
  ): void {
    const scripts = groupBy(
      entities.filter(
        (item) =>
          typeof item.properties?.scriptName === "string" &&
          [
            "keystone.core.BuildCommand",
            "keystone.core.TestCommand",
            "keystone.core.LintCommand",
            "keystone.core.Command",
          ].includes(item.type),
      ),
      (item) => String(item.properties?.scriptName),
    );
    for (const step of entities.filter(
      (item) =>
        item.type === "keystone.core.Step" && typeof item.properties?.scriptName === "string",
    )) {
      const matches = scripts.get(String(step.properties?.scriptName)) ?? [];
      const owner = fileById.get(step.fileId);
      if (!owner) continue;
      if (matches.length === 1 && matches[0]) {
        const script = matches[0];
        const targetFile = fileById.get(script.fileId);
        builder.relationship(step, script, "keystone.core.EXECUTES", owner, step.range, {
          derivation: "calculated",
          resolution: "exact",
          confidence: 1,
          properties: { linkRule: "exact-package-script-name", classification: "exact" },
          ...(targetFile ? { secondary: targetFile } : {}),
        });
      } else if (matches.length > 1)
        builder.diagnostic(
          "ambiguous-cross-link",
          "warning",
          `CI script ${String(step.properties?.scriptName)} exists in multiple packages; no link was created.`,
          owner,
          step.range,
          { technologyId: String(step.properties?.provider ?? "ci"), ambiguity: true },
        );
    }
  }

  private linkMigrations(
    builder: AdapterOutputBuilder,
    entities: IntelligenceSymbolRecord[],
    relationships: IntelligenceRelationshipRecord[],
    entityById: Map<string, IntelligenceSymbolRecord>,
    fileById: Map<string, SemanticSourceFileInput>,
  ): void {
    const ormByTable = groupBy(
      entities.filter(
        (item) => item.type === "keystone.core.OrmEntity" && item.properties?.tableName,
      ),
      (item) => normalizeName(item.properties?.tableName),
    );
    for (const relationship of relationships.filter((item) =>
      ["keystone.core.CREATES", "keystone.core.ALTERS", "keystone.core.DROPS"].includes(item.type),
    )) {
      const migration = entityById.get(relationship.sourceId);
      const table = entityById.get(relationship.targetId);
      if (!migration || migration.type !== "keystone.core.Migration" || !table) continue;
      const matches =
        ormByTable.get(normalizeName(table.properties?.canonicalName ?? table.name)) ?? [];
      const owner = fileById.get(migration.fileId);
      if (!owner) continue;
      if (matches.length === 1 && matches[0]) {
        const orm = matches[0];
        const explicit = orm.properties?.mappingKind === "explicit";
        const targetFile = fileById.get(orm.fileId);
        builder.relationship(migration, orm, "keystone.core.MIGRATES", owner, migration.range, {
          derivation: "calculated",
          resolution: explicit ? "exact" : "convention",
          confidence: explicit ? 1 : 0.65,
          properties: {
            linkRule: explicit
              ? "migration-table-explicit-orm-map"
              : "migration-table-orm-convention",
            classification: explicit ? "exact" : "convention",
          },
          ...(targetFile ? { secondary: targetFile } : {}),
        });
      } else if (matches.length > 1)
        builder.diagnostic(
          "ambiguous-cross-link",
          "warning",
          `Migration table ${table.name} maps to multiple ORM entities; no link was created.`,
          owner,
          migration.range,
          { technologyId: "sql-migration", ambiguity: true },
        );
    }
  }

  private linkConfiguration(
    builder: AdapterOutputBuilder,
    entities: IntelligenceSymbolRecord[],
    fileById: Map<string, SemanticSourceFileInput>,
  ): void {
    const declarations = groupBy(
      entities.filter(
        (item) => item.type === "keystone.core.ConfigurationKey" && item.properties?.keyPath,
      ),
      (item) => normalizeName(item.name),
    );
    for (const reference of entities.filter(
      (item) =>
        item.type === "keystone.core.ConfigurationKey" &&
        item.properties?.configurationClass === "sensitive-name-only",
    )) {
      const matches = (declarations.get(normalizeName(reference.name)) ?? []).filter(
        (item) => item.id !== reference.id,
      );
      const owner = fileById.get(reference.fileId);
      if (!owner) continue;
      if (matches.length === 1 && matches[0]) {
        const declaration = matches[0];
        const targetFile = fileById.get(declaration.fileId);
        builder.relationship(
          reference,
          declaration,
          "keystone.core.REFERENCES",
          owner,
          reference.range,
          {
            derivation: "calculated",
            resolution: "exact",
            confidence: 1,
            properties: { linkRule: "exact-configuration-key", classification: "exact" },
            ...(targetFile ? { secondary: targetFile } : {}),
          },
        );
      } else if (matches.length > 1)
        builder.diagnostic(
          "ambiguous-cross-link",
          "warning",
          `Configuration key ${reference.name} has multiple declarations; no link was created.`,
          owner,
          reference.range,
          { technologyId: "configuration", ambiguity: true },
        );
    }
  }
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const itemKey = key(value);
    if (!itemKey) continue;
    const items = result.get(itemKey) ?? [];
    items.push(value);
    result.set(itemKey, items);
  }
  return result;
}
function routeKey(method: unknown, path: unknown): string {
  return `${primitive(method).toUpperCase()} ${
    primitive(path)
      .replace(/:[A-Za-z_]\w*/g, "{}")
      .replace(/\{[^}]+\}/g, "{}")
      .replace(/\/+$/, "") || "/"
  }`;
}
function normalizeName(value: unknown): string {
  return primitive(value)
    .replace(/^[`"[]|[`"\]]$/g, "")
    .toLowerCase();
}
function primitive(value: unknown): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}
