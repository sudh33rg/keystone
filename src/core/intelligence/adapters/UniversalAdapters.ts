/* eslint-disable no-useless-escape -- grammar recognizers keep explicit metacharacter escapes readable. */
import { posix } from "node:path";
import type { AdapterCapability, AdapterDetection } from "../../../shared/contracts/adapters";
import type { IntelligenceSymbolRecord } from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import { rangeAt, safePropertyName, wholeRange } from "./AdapterEvidenceFactory";
import type { AdapterOutputBuilder } from "./BaseAdapter";
import { DeterministicAdapter, detection, importsModule, lines } from "./BaseAdapter";

const ONE_MIB = 1024 * 1024;
const LANGUAGE_BY_ID: Record<string, { extensions: string[]; limitations: string[] }> = {
  java: {
    extensions: [".java"],
    limitations: ["No classpath or overload resolution; calls remain unresolved."],
  },
  python: {
    extensions: [".py"],
    limitations: [
      "No import environment, type inference, decorator execution, or dynamic call resolution.",
    ],
  },
  csharp: {
    extensions: [".cs"],
    limitations: ["No Roslyn compilation or project-reference resolution."],
  },
  go: { extensions: [".go"], limitations: ["No go/types resolution or build-tag evaluation."] },
  rust: {
    extensions: [".rs"],
    limitations: ["No macro expansion, trait selection, or cargo feature evaluation."],
  },
  c: {
    extensions: [".c", ".h"],
    limitations: ["No preprocessor expansion, compilation database, or pointer resolution."],
  },
  cpp: {
    extensions: [".cc", ".cpp", ".cxx", ".hpp", ".hh"],
    limitations: ["No template instantiation, preprocessor expansion, or overload resolution."],
  },
  ruby: {
    extensions: [".rb"],
    limitations: ["No metaprogramming or runtime constant resolution."],
  },
  php: {
    extensions: [".php"],
    limitations: ["No Composer autoload or runtime dispatch resolution."],
  },
  kotlin: {
    extensions: [".kt", ".kts"],
    limitations: ["No Kotlin compiler or Gradle source-set resolution."],
  },
  swift: {
    extensions: [".swift"],
    limitations: ["No Swift compiler, extension merge, or protocol witness resolution."],
  },
  shell: {
    extensions: [".sh", ".bash", ".zsh"],
    limitations: ["No shell expansion, sourced-file resolution, or runtime command resolution."],
  },
};

export class StructuralLanguageAdapter extends DeterministicAdapter {
  readonly id: string;
  readonly version = "1.0.0";
  constructor(private readonly technology: keyof typeof LANGUAGE_BY_ID) {
    super();
    this.id = `keystone.adapter.language.${technology}`;
  }
  capability(): AdapterCapability {
    const definition = LANGUAGE_BY_ID[this.technology];
    return capability(
      this,
      "language",
      [this.technology],
      "tier-1",
      "structural",
      [
        "keystone.core.Module",
        "keystone.core.Class",
        "keystone.core.Interface",
        "keystone.core.Struct",
        "keystone.core.Trait",
        "keystone.core.Enum",
        "keystone.core.Function",
        "keystone.core.Method",
        "keystone.core.TestCase",
        "keystone.core.ExternalDependency",
        "keystone.core.DocumentationBlock",
      ],
      ["keystone.core.DECLARES", "keystone.core.IMPORTS", "keystone.core.DOCUMENTS"],
      definition?.limitations ?? [],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const definition = LANGUAGE_BY_ID[this.technology];
    if (!definition) return [];
    const selected = files.filter((file) =>
      definition.extensions.some((extension) =>
        file.relativePath.toLowerCase().endsWith(extension),
      ),
    );
    return selected.length
      ? [
          detection(
            this.id,
            this.technology,
            "structural",
            selected,
            "extension",
            `${this.technology} source extension matched.`,
            1,
            definition.limitations,
          ),
        ]
      : [];
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) this.extractFile(file, output);
  }
  private extractFile(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const moduleName = moduleNameFor(file);
    const module = output.entity(
      file,
      "keystone.core.Module",
      moduleName,
      `${file.relativePath}#module:${moduleName}`,
      wholeRange(file.content),
      { capabilityLevel: "structural", resolution: "syntactic" },
    );
    const declared: IntelligenceSymbolRecord[] = [];
    const declarationPatterns: Array<{ type: string; expression: RegExp; nameIndex: number }> = [
      {
        type: "keystone.core.Namespace",
        expression: /\b(?:package|namespace|module)\s+([A-Za-z_][\w.]*)/g,
        nameIndex: 1,
      },
      {
        type: "keystone.core.Class",
        expression:
          /\b(?:public\s+|private\s+|protected\s+|internal\s+|abstract\s+|open\s+|sealed\s+|data\s+|final\s+|static\s+)*(?:class|record)\s+([A-Za-z_]\w*)/g,
        nameIndex: 1,
      },
      {
        type: "keystone.core.Interface",
        expression:
          /\b(?:public\s+|private\s+|protected\s+|internal\s+)*(?:interface|protocol)\s+([A-Za-z_]\w*)/g,
        nameIndex: 1,
      },
      {
        type: "keystone.core.Struct",
        expression: /\b(?:pub(?:\([^)]*\))?\s+|public\s+)*struct\s+([A-Za-z_]\w*)/g,
        nameIndex: 1,
      },
      {
        type: "keystone.core.Trait",
        expression: /\b(?:pub\s+)?trait\s+([A-Za-z_]\w*)/g,
        nameIndex: 1,
      },
      {
        type: "keystone.core.Enum",
        expression: /\b(?:pub\s+|public\s+)*enum\s+([A-Za-z_]\w*)/g,
        nameIndex: 1,
      },
    ];
    for (const pattern of declarationPatterns)
      for (const match of file.content.matchAll(pattern.expression)) {
        const name = match[pattern.nameIndex];
        if (!name || match.index === undefined) continue;
        const start = match.index + match[0].lastIndexOf(name);
        const entity = output.entity(
          file,
          pattern.type,
          name,
          `${moduleName}.${name}`,
          rangeAt(file.content, start, start + name.length),
          { capabilityLevel: "structural", resolution: "syntactic" },
        );
        declared.push(entity);
        output.relationship(module, entity, "keystone.core.DECLARES", file, entity.range, {
          resolution: "syntactic",
        });
      }
    for (const item of functionMatches(file)) {
      const isTest = isTestDeclaration(file, item.name, item.start);
      const type = isTest
        ? "keystone.core.TestCase"
        : item.method
          ? "keystone.core.Method"
          : "keystone.core.Function";
      const entity = output.entity(
        file,
        type,
        item.name,
        `${moduleName}.${item.name}`,
        rangeAt(file.content, item.start, item.start + item.name.length),
        {
          capabilityLevel: "structural",
          resolution: "syntactic",
          ...(isTest ? { testFramework: testFramework(file) } : {}),
        },
      );
      declared.push(entity);
      output.relationship(module, entity, "keystone.core.DECLARES", file, entity.range, {
        resolution: "syntactic",
      });
    }
    for (const item of importMatches(file)) {
      const dependency = output.entity(
        file,
        "keystone.core.ExternalDependency",
        item.name,
        `${file.relativePath}#dependency:${item.name}`,
        rangeAt(file.content, item.start, item.start + item.name.length),
        { resolution: "unresolved", moduleSpecifier: item.name },
        0.8,
      );
      output.relationship(module, dependency, "keystone.core.IMPORTS", file, dependency.range, {
        confidence: 0.8,
        resolution: "syntactic",
        properties: { moduleSpecifier: item.name, targetStatus: "unresolved" },
      });
    }
    for (const doc of documentationBlocks(file.content)) {
      const block = output.entity(
        file,
        "keystone.core.DocumentationBlock",
        "documentation",
        `${file.relativePath}#documentation:${doc.start}`,
        rangeAt(file.content, doc.start, doc.end),
        { format: doc.format },
      );
      output.relationship(module, block, "keystone.core.CONTAINS", file, block.range);
      const target = declared
        .filter(
          (item) =>
            item.range.startLine >= block.range.endLine &&
            item.range.startLine - block.range.endLine <= 3,
        )
        .sort((left, right) => left.range.startLine - right.range.startLine)[0];
      if (target)
        output.relationship(block, target, "keystone.core.DOCUMENTS", file, block.range, {
          resolution: "syntactic",
          confidence: 0.9,
        });
    }
    if (declared.length === 0)
      output.diagnostic(
        "no-structural-declarations",
        "info",
        "The structural adapter found no reliable declarations; file inventory remains available.",
        file,
        undefined,
        { technologyId: file.language, limitation: true },
      );
  }
}

export class DeterministicDocumentationAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.documentation";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "documentation",
      ["markdown", "mdx", "asciidoc", "restructuredtext", "text", "adr"],
      "tier-1",
      "structural",
      [
        "keystone.core.Document",
        "keystone.core.Section",
        "keystone.core.ArchitectureDecision",
        "keystone.core.Requirement",
        "keystone.core.CodeBlock",
      ],
      [
        "keystone.core.CONTAINS",
        "keystone.core.LINKS_TO",
        "keystone.core.REFERENCES",
        "keystone.core.SUPERSEDES",
      ],
      [
        "Business meaning and informal requirements are not inferred.",
        "Symbol references require an explicit qualified token and are resolved later.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const docs = files.filter((file) =>
      /\.(?:md|mdx|adoc|asciidoc|rst|txt)$/i.test(file.relativePath),
    );
    const result = docs.length
      ? [
          detection(
            this.id,
            "documentation",
            "structural",
            docs,
            "extension",
            "Recognized documentation extension.",
          ),
        ]
      : [];
    const adrs = docs.filter(
      (file) =>
        /(^|\/)(?:adr|adrs|decisions?)\//i.test(file.relativePath) ||
        (/\bstatus\s*:/i.test(file.content) && /\bdecision\b/i.test(file.content)),
    );
    if (adrs.length)
      result.push(
        detection(
          this.id,
          "adr",
          "structural",
          adrs,
          "syntax",
          "ADR path or explicit decision/status markers matched.",
          0.95,
        ),
      );
    return result;
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    const documentByPath = new Map<string, IntelligenceSymbolRecord>();
    for (const file of files) {
      const isAdr =
        /(^|\/)(?:adr|adrs|decisions?)\//i.test(file.relativePath) ||
        (/\bstatus\s*:/i.test(file.content) && /\bdecision\b/i.test(file.content));
      const type = isAdr ? "keystone.core.ArchitectureDecision" : "keystone.core.Document";
      const title = documentTitle(file);
      const document = output.entity(
        file,
        type,
        title,
        file.relativePath,
        wholeRange(file.content),
        {
          format: file.relativePath.split(".").at(-1)?.toLowerCase() ?? "text",
          ...(isAdr ? { status: adrStatus(file.content) } : {}),
        },
      );
      documentByPath.set(file.relativePath, document);
      const headings = headingMatches(file);
      for (const heading of headings) {
        const section = output.entity(
          file,
          "keystone.core.Section",
          heading.name,
          `${file.relativePath}#${slug(heading.name)}`,
          rangeAt(file.content, heading.start, heading.end),
          { level: heading.level },
        );
        output.relationship(document, section, "keystone.core.CONTAINS", file, section.range);
      }
      for (const block of file.content.matchAll(/```([^\n]*)\n([\s\S]*?)```/g))
        if (block.index !== undefined) {
          const language = safePropertyName(block[1] ?? "");
          const code = output.entity(
            file,
            "keystone.core.CodeBlock",
            language || "code",
            `${file.relativePath}#code:${block.index}`,
            rangeAt(file.content, block.index, block.index + block[0].length),
            { language },
          );
          output.relationship(document, code, "keystone.core.CONTAINS", file, code.range);
        }
      for (const requirement of file.content.matchAll(
        /^\s*(?:[-*]\s*)?(REQ[-_ ]?\d+|Requirement\s*:)\s*(.+)$/gim,
      ))
        if (requirement.index !== undefined) {
          const name = safePropertyName(requirement[1] ?? "requirement");
          const entity = output.entity(
            file,
            "keystone.core.Requirement",
            name,
            `${file.relativePath}#${name}`,
            rangeAt(file.content, requirement.index, requirement.index + requirement[0].length),
            { explicit: true },
          );
          output.relationship(document, entity, "keystone.core.CONTAINS", file, entity.range);
        }
    }
    for (const file of files) {
      const source = documentByPath.get(file.relativePath);
      if (!source) continue;
      for (const link of markdownLinks(file)) {
        if (/^(?:https?:|mailto:|#)/.test(link.target)) continue;
        const normalized = posix.normalize(
          posix.join(posix.dirname(file.relativePath), link.target.split("#")[0] ?? ""),
        );
        const exact = documentByPath.get(normalized);
        const basename = [...documentByPath.entries()].filter(
          ([path]) => posix.basename(path) === posix.basename(normalized),
        );
        const target = exact ?? (basename.length === 1 ? basename[0]?.[1] : undefined);
        if (target)
          output.relationship(
            source,
            target,
            "keystone.core.LINKS_TO",
            file,
            rangeAt(file.content, link.start, link.end),
            {
              resolution: exact ? "exact" : "convention",
              confidence: exact ? 1 : 0.7,
              secondary: files.find((item) => item.fileId === target.fileId),
            },
          );
        else if (basename.length > 1)
          output.diagnostic(
            "ambiguous-document-link",
            "warning",
            `Document link ${link.target} has multiple repository targets.`,
            file,
            rangeAt(file.content, link.start, link.end),
            { technologyId: "documentation", ambiguity: true },
          );
      }
    }
  }
}

export class DeterministicContractAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.contract";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "contract",
      ["openapi", "swagger", "graphql", "json-schema", "protobuf", "avro"],
      "tier-4",
      "structural",
      [
        "keystone.core.ApiContract",
        "keystone.core.Endpoint",
        "keystone.core.Operation",
        "keystone.core.Schema",
        "keystone.core.Field",
        "keystone.core.Enum",
        "keystone.core.RequestModel",
        "keystone.core.ResponseModel",
        "keystone.core.SecurityRequirement",
      ],
      [
        "keystone.core.DECLARES",
        "keystone.core.ACCEPTS",
        "keystone.core.RETURNS",
        "keystone.core.HAS_FIELD",
        "keystone.core.REQUIRES_SECURITY",
      ],
      [
        "YAML anchors and templating are not expanded.",
        "Resolver does not fetch remote schema references.",
        "Avro logical types beyond explicit records/enums are metadata-only.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const groups: Array<
      [string, SemanticSourceFileInput[], AdapterDetection["evidence"][number]["kind"]]
    > = [
      [
        "openapi",
        files.filter(
          (file) =>
            /(?:openapi|swagger).*\.(?:json|ya?ml)$/i.test(file.relativePath) ||
            /^\s*(?:openapi|swagger)\s*:/m.test(file.content),
        ),
        "format",
      ],
      [
        "graphql",
        files.filter((file) => /\.(?:graphql|gql)$/i.test(file.relativePath)),
        "extension",
      ],
      [
        "json-schema",
        files.filter(
          (file) => /\.json$/i.test(file.relativePath) && /["']\$schema["']\s*:/.test(file.content),
        ),
        "syntax",
      ],
      ["protobuf", files.filter((file) => /\.proto$/i.test(file.relativePath)), "extension"],
      [
        "avro",
        files.filter(
          (file) =>
            /\.avsc$/i.test(file.relativePath) ||
            (/"type"\s*:\s*"record"/.test(file.content) && /"fields"\s*:/.test(file.content)),
        ),
        "format",
      ],
    ];
    return groups
      .filter(([, selected]) => selected.length)
      .map(([technology, selected, kind]) =>
        detection(
          this.id,
          technology,
          "structural",
          selected,
          kind,
          `Recognized ${technology} contract evidence.`,
        ),
      );
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files) {
      if (/\.(?:graphql|gql)$/i.test(file.relativePath)) this.graphql(file, output);
      else if (/\.proto$/i.test(file.relativePath)) this.protobuf(file, output);
      else if (/\.avsc$/i.test(file.relativePath)) this.jsonContract(file, output, "avro");
      else if (
        /(?:openapi|swagger)/i.test(file.relativePath) ||
        /^\s*(?:openapi|swagger)\s*:/m.test(file.content)
      )
        this.openapi(file, output);
      else this.jsonContract(file, output, "json-schema");
    }
  }
  private openapi(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const contract = output.entity(
      file,
      "keystone.core.ApiContract",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { contractKind: "openapi" },
    );
    const endpoints: IntelligenceSymbolRecord[] = [];
    let currentPath = "";
    for (const line of lines(file.content)) {
      const pathMatch = line.text.match(/^\s{0,6}(\/[^:]+):\s*$/);
      if (pathMatch?.[1]) {
        currentPath = pathMatch[1];
        continue;
      }
      const method = line.text
        .match(/^\s+(get|post|put|patch|delete|head|options|trace):\s*$/i)?.[1]
        ?.toUpperCase();
      if (currentPath && method) {
        const start = line.start + line.text.toLowerCase().indexOf(method.toLowerCase());
        const endpoint = output.entity(
          file,
          "keystone.core.Endpoint",
          `${method} ${currentPath}`,
          `${file.relativePath}#${method}:${currentPath}`,
          rangeAt(file.content, start, start + method.length),
          { httpMethod: method, path: currentPath, contractKind: "openapi" },
        );
        endpoints.push(endpoint);
        output.relationship(contract, endpoint, "keystone.core.DECLARES", file, endpoint.range);
      }
    }
    if (endpoints.length === 0) {
      try {
        const value = JSON.parse(file.content) as {
          paths?: Record<string, Record<string, unknown>>;
          components?: { schemas?: Record<string, unknown> };
          definitions?: Record<string, unknown>;
        };
        for (const [path, methods] of Object.entries(value.paths ?? {}))
          for (const method of Object.keys(methods).filter((item) =>
            /^(get|post|put|patch|delete|head|options|trace)$/i.test(item),
          )) {
            const endpoint = output.entity(
              file,
              "keystone.core.Endpoint",
              `${method.toUpperCase()} ${path}`,
              `${file.relativePath}#${method.toUpperCase()}:${path}`,
              wholeRange(file.content),
              { httpMethod: method.toUpperCase(), path, contractKind: "openapi" },
            );
            output.relationship(contract, endpoint, "keystone.core.DECLARES", file, endpoint.range);
          }
        this.schemas(file, output, contract, value.components?.schemas ?? value.definitions ?? {});
      } catch {
        output.diagnostic(
          "unsupported-openapi-yaml-shape",
          "info",
          "Only explicit path/method and schema shapes were extracted from this OpenAPI document.",
          file,
          undefined,
          { technologyId: "openapi", limitation: true },
        );
      }
    }
    for (const schema of file.content.matchAll(/^\s{2,8}([A-Za-z_]\w*):\s*$/gm))
      if (schema.index !== undefined && schema[1] && !schema[1].startsWith("/")) {
        if (
          ["paths", "components", "schemas", "responses", "parameters", "securitySchemes"].includes(
            schema[1],
          )
        )
          continue;
        const entity = output.entity(
          file,
          "keystone.core.Schema",
          schema[1],
          `${file.relativePath}#schema:${schema[1]}`,
          rangeAt(file.content, schema.index, schema.index + schema[0].length),
          { contractKind: "openapi" },
        );
        output.relationship(contract, entity, "keystone.core.DECLARES", file, entity.range);
      }
  }
  private graphql(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const contract = output.entity(
      file,
      "keystone.core.ApiContract",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { contractKind: "graphql" },
    );
    for (const match of file.content.matchAll(
      /(?:^|\n)\s*(type|input|interface|enum|scalar|union)\s+([A-Za-z_]\w*)[^\{\n]*(?:\{([\s\S]*?)\})?/g,
    ))
      if (match.index !== undefined && match[1] && match[2]) {
        const type =
          match[1] === "enum"
            ? "keystone.core.Enum"
            : match[1] === "input"
              ? "keystone.core.RequestModel"
              : "keystone.core.Schema";
        const start = match.index + match[0].indexOf(match[2]);
        const schema = output.entity(
          file,
          type,
          match[2],
          `${file.relativePath}#graphql:${match[2]}`,
          rangeAt(file.content, start, start + match[2].length),
          { contractKind: "graphql", graphqlKind: match[1] },
        );
        output.relationship(contract, schema, "keystone.core.DECLARES", file, schema.range);
        for (const field of (match[3] ?? "").matchAll(
          /^\s*([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*:\s*([^\n#]+)/gm,
        ))
          if (field.index !== undefined && field[1]) {
            const fieldStart =
              start + (match[3]?.indexOf(field[0]) ?? 0) + field[0].indexOf(field[1]);
            const fieldEntity = output.entity(
              file,
              "keystone.core.Field",
              field[1],
              `${schema.qualifiedName}.${field[1]}`,
              rangeAt(file.content, fieldStart, fieldStart + field[1].length),
              { fieldType: safePropertyName(field[2] ?? "") },
            );
            output.relationship(
              schema,
              fieldEntity,
              "keystone.core.HAS_FIELD",
              file,
              fieldEntity.range,
            );
          }
      }
  }
  private protobuf(file: SemanticSourceFileInput, output: AdapterOutputBuilder): void {
    const contract = output.entity(
      file,
      "keystone.core.ApiContract",
      posix.basename(file.relativePath),
      file.relativePath,
      wholeRange(file.content),
      { contractKind: "protobuf" },
    );
    for (const match of file.content.matchAll(/(?:message|enum|service)\s+([A-Za-z_]\w*)\s*\{/g))
      if (match.index !== undefined && match[1]) {
        const keyword = match[0].trim().split(/\s/)[0];
        const type =
          keyword === "service"
            ? "keystone.core.Service"
            : keyword === "enum"
              ? "keystone.core.Enum"
              : "keystone.core.Schema";
        const start = match.index + match[0].indexOf(match[1]);
        const entity = output.entity(
          file,
          type,
          match[1],
          `${file.relativePath}#proto:${match[1]}`,
          rangeAt(file.content, start, start + match[1].length),
          { contractKind: "protobuf" },
        );
        output.relationship(contract, entity, "keystone.core.DECLARES", file, entity.range);
      }
    for (const match of file.content.matchAll(
      /rpc\s+([A-Za-z_]\w*)\s*\(\s*([^)]+)\)\s*returns\s*\(\s*([^)]+)\)/g,
    ))
      if (match.index !== undefined && match[1]) {
        const operation = output.entity(
          file,
          "keystone.core.Operation",
          match[1],
          `${file.relativePath}#rpc:${match[1]}`,
          rangeAt(file.content, match.index, match.index + match[0].length),
          {
            requestType: safePropertyName(match[2] ?? ""),
            responseType: safePropertyName(match[3] ?? ""),
            contractKind: "protobuf",
          },
        );
        output.relationship(contract, operation, "keystone.core.DECLARES", file, operation.range);
      }
  }
  private jsonContract(
    file: SemanticSourceFileInput,
    output: AdapterOutputBuilder,
    kind: string,
  ): void {
    let value: unknown;
    try {
      value = JSON.parse(file.content) as unknown;
    } catch {
      output.failedFiles += 1;
      output.diagnostic(
        "parse-failure",
        "warning",
        `${kind} document is not valid JSON.`,
        file,
        undefined,
        { technologyId: kind },
      );
      return;
    }
    const record = asRecord(value);
    const name =
      stringValue(record.title) ?? stringValue(record.name) ?? posix.basename(file.relativePath);
    const contract = output.entity(
      file,
      "keystone.core.ApiContract",
      name,
      file.relativePath,
      wholeRange(file.content),
      { contractKind: kind },
    );
    const definitions = asRecord(record.$defs ?? record.definitions);
    if (Object.keys(definitions).length) this.schemas(file, output, contract, definitions);
    else {
      const schema = output.entity(
        file,
        "keystone.core.Schema",
        name,
        `${file.relativePath}#schema:${name}`,
        wholeRange(file.content),
        { contractKind: kind },
      );
      output.relationship(contract, schema, "keystone.core.DECLARES", file, schema.range);
      this.fields(file, output, schema, asRecord(record.properties), kind);
    }
    if (kind === "avro")
      for (const field of Array.isArray(record.fields) ? record.fields : []) {
        const fieldRecord = asRecord(field);
        const fieldName = stringValue(fieldRecord.name);
        if (!fieldName) continue;
        const entity = output.entity(
          file,
          "keystone.core.Field",
          fieldName,
          `${file.relativePath}#field:${fieldName}`,
          wholeRange(file.content),
          {
            contractKind: kind,
            fieldType: typeof fieldRecord.type === "string" ? fieldRecord.type : "composite",
          },
        );
        output.relationship(contract, entity, "keystone.core.HAS_FIELD", file, entity.range);
      }
  }
  private schemas(
    file: SemanticSourceFileInput,
    output: AdapterOutputBuilder,
    contract: IntelligenceSymbolRecord,
    definitions: Record<string, unknown>,
  ): void {
    for (const [name, value] of Object.entries(definitions)) {
      const schema = output.entity(
        file,
        "keystone.core.Schema",
        name,
        `${file.relativePath}#schema:${name}`,
        wholeRange(file.content),
        { contractKind: contract.properties?.contractKind ?? "schema" },
      );
      output.relationship(contract, schema, "keystone.core.DECLARES", file, schema.range);
      this.fields(
        file,
        output,
        schema,
        asRecord(asRecord(value).properties),
        String(contract.properties?.contractKind ?? "schema"),
      );
    }
  }
  private fields(
    file: SemanticSourceFileInput,
    output: AdapterOutputBuilder,
    schema: IntelligenceSymbolRecord,
    properties: Record<string, unknown>,
    kind: string,
  ): void {
    for (const [name, value] of Object.entries(properties)) {
      const field = output.entity(
        file,
        "keystone.core.Field",
        name,
        `${schema.qualifiedName}.${name}`,
        wholeRange(file.content),
        { contractKind: kind, fieldType: stringValue(asRecord(value).type) ?? "unknown" },
      );
      output.relationship(schema, field, "keystone.core.HAS_FIELD", file, field.range);
    }
  }
}

export class DeterministicFrameworkAdapter extends DeterministicAdapter {
  readonly id = "keystone.adapter.framework";
  readonly version = "1.0.0";
  capability(): AdapterCapability {
    return capability(
      this,
      "framework",
      [
        "react",
        "express",
        "nestjs",
        "fastify",
        "nextjs",
        "spring",
        "django",
        "flask",
        "rails",
        "laravel",
      ],
      "tier-3",
      "structural",
      ["keystone.core.Route", "keystone.core.Component", "keystone.core.Service"],
      ["keystone.core.ROUTES_TO", "keystone.core.HANDLES", "keystone.core.DECORATES"],
      [
        "Detection does not imply lifecycle or dependency-injection resolution.",
        "Only explicit framework registrations emitted by a language adapter are canonical relationships.",
      ],
    );
  }
  detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[] {
    const indicators: Record<string, (file: SemanticSourceFileInput) => boolean> = {
      react: (file) => importsModule(file, ["react"]),
      express: (file) => importsModule(file, ["express"]),
      nestjs: (file) => importsModule(file, ["@nestjs"]),
      fastify: (file) => importsModule(file, ["fastify"]),
      nextjs: (file) => importsModule(file, ["next"]),
      spring: (file) =>
        ["java", "kotlin"].includes(file.language) &&
        /(?:org\.springframework|@SpringBootApplication|@RestController)/.test(file.content),
      django: (file) =>
        file.language === "python" && /(?:from\s+django\.|import\s+django\b)/.test(file.content),
      flask: (file) =>
        file.language === "python" &&
        /(?:from\s+flask\s+import|import\s+flask\b)/.test(file.content),
      rails: (file) =>
        file.language === "ruby" && /(?:Rails\.application|ApplicationRecord)/.test(file.content),
      laravel: (file) =>
        file.language === "php" &&
        /(?:Illuminate\\|Route::(?:get|post|put|delete))/.test(file.content),
    };
    return Object.entries(indicators).flatMap(([technology, matches]) => {
      const selected = files.filter(matches);
      return selected.length
        ? [
            detection(
              this.id,
              technology,
              "structural",
              selected,
              "import",
              `Explicit ${technology} import or framework marker matched.`,
              0.95,
              this.capability().limitations,
            ),
          ]
        : [];
    });
  }
  protected extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void {
    for (const file of files)
      output.diagnostic(
        "partial-framework-support",
        "info",
        "Framework technology was detected; only explicit language-adapter framework facts are canonical.",
        file,
        undefined,
        {
          technologyId: output.input.context.detections.find(
            (item) => item.adapterId === this.id && item.fileIds.includes(file.fileId),
          )?.technologyId,
          limitation: true,
        },
      );
  }
}

function capability(
  adapter: { id: string; version: string },
  family: AdapterCapability["family"],
  technologies: string[],
  tier: AdapterCapability["tier"],
  level: AdapterCapability["level"],
  entityTypes: string[],
  relationshipTypes: string[],
  limitations: string[],
): AdapterCapability {
  return {
    adapterId: adapter.id,
    version: adapter.version,
    family,
    technologies,
    filePatterns: [],
    manifestIndicators: [],
    dependencyIndicators: [],
    syntaxIndicators: [],
    tier,
    level,
    entityTypes,
    relationshipTypes,
    outputKind:
      level === "metadata-only"
        ? "metadata-only"
        : level === "semantic"
          ? "semantic"
          : "structural",
    incremental: true,
    threadSafe: true,
    maxInputBytes: ONE_MIB,
    limitations,
  };
}

function moduleNameFor(file: SemanticSourceFileInput): string {
  const packageMatch = file.content.match(/^\s*(?:package|namespace|module)\s+([A-Za-z_][\w.]*)/m);
  return packageMatch?.[1] ?? file.relativePath.replace(/\.[^.]+$/, "").replaceAll("/", ".");
}
function functionMatches(
  file: SemanticSourceFileInput,
): Array<{ name: string; start: number; method: boolean }> {
  const patterns =
    file.language === "python"
      ? [/\b(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/g]
      : file.language === "go"
        ? [/\bfunc\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/g]
        : file.language === "rust"
          ? [/\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/g]
          : file.language === "ruby"
            ? [/\bdef\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)\b/g]
            : file.language === "shell"
              ? [/\b(?:function\s+)?([A-Za-z_]\w*)\s*(?:\(\s*\))?\s*\{/g]
              : [
                  /\b(?:(?:public|private|protected|internal|static|final|virtual|override|abstract|async|suspend|inline|extern)\s+)*(?:[A-Za-z_][\w<>,.?\[\]:*&\s]+\s+)?([A-Za-z_]\w*)\s*\([^;{}]*\)\s*(?:\{|=>)/g,
                ];
  const values: Array<{ name: string; start: number; method: boolean }> = [];
  for (const expression of patterns)
    for (const match of file.content.matchAll(expression))
      if (
        match.index !== undefined &&
        match[1] &&
        !["if", "for", "while", "switch", "catch", "return", "new"].includes(match[1])
      ) {
        const start = match.index + match[0].lastIndexOf(match[1]);
        values.push({ name: match[1], start, method: /^\s+/.test(match[0]) });
      }
  return values.filter(
    (item, index) => values.findIndex((other) => other.start === item.start) === index,
  );
}
function importMatches(file: SemanticSourceFileInput): Array<{ name: string; start: number }> {
  const patterns = [
    /\bimport\s+(?:[^"']+\s+from\s+)?["']([^"']+)["']/g,
    /\bfrom\s+([\w.]+)\s+import\s+/g,
    /\bimport\s+([A-Za-z_][\w.]*)/g,
    /\b(?:use|using)\s+([\w:.]+)\s*;/g,
    /#include\s*[<"]([^>"]+)[>"]/g,
    /\brequire\s+["']([^"']+)["']/g,
    /^\s*package\s+([\w./-]+)\s*$/gm,
  ];
  const values: Array<{ name: string; start: number }> = [];
  for (const expression of patterns)
    for (const match of file.content.matchAll(expression))
      if (match.index !== undefined && match[1])
        values.push({ name: match[1], start: match.index + match[0].indexOf(match[1]) });
  return values;
}
function isTestDeclaration(file: SemanticSourceFileInput, name: string, start: number): boolean {
  return (
    file.category === "test" &&
    (/^(?:test|should|it_)/i.test(name) ||
      /@(?:Test|ParameterizedTest|Fact|Theory)|#\[test\]/.test(
        file.content.slice(Math.max(0, start - 120), start),
      ))
  );
}
function testFramework(file: SemanticSourceFileInput): string {
  if (/pytest|@pytest/.test(file.content)) return "pytest";
  if (/@(?:Test|ParameterizedTest)/.test(file.content)) return "junit";
  if (/\[(?:Fact|Theory|Test)\]/.test(file.content)) return "xunit";
  if (/#\[test\]/.test(file.content)) return "rust-test";
  if (/func\s+Test\w+\s*\(.*\*testing\.T/.test(file.content)) return "go-testing";
  return "language-test";
}
function documentTitle(file: SemanticSourceFileInput): string {
  return (
    file.content.match(/^#\s+(.+)$/m)?.[1]?.trim() ??
    file.content.match(/^(.+)\n[=-]{3,}\s*$/m)?.[1]?.trim() ??
    posix.basename(file.relativePath)
  );
}
function adrStatus(content: string): string {
  return safePropertyName(content.match(/^\s*status\s*:\s*(.+)$/im)?.[1] ?? "unknown");
}
function headingMatches(
  file: SemanticSourceFileInput,
): Array<{ name: string; level: number; start: number; end: number }> {
  const result = [];
  for (const line of lines(file.content)) {
    const markdown = line.text.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    const asciidoc = line.text.match(/^(={1,6})\s+(.+)$/);
    const rst = line.text.match(/^(.+)$/);
    const marker = markdown ?? asciidoc;
    if (marker?.[1] && marker[2])
      result.push({
        name: marker[2].trim(),
        level: marker[1].length,
        start: line.start,
        end: line.end,
      });
    else if (rst?.[1]) {
      const next = file.content.slice(line.end + 1).split("\n")[0] ?? "";
      if (/^[=-~^"+#*]{3,}\s*$/.test(next))
        result.push({
          name: rst[1].trim(),
          level: 1,
          start: line.start,
          end: line.end + 1 + next.length,
        });
    }
  }
  return result;
}
function markdownLinks(
  file: SemanticSourceFileInput,
): Array<{ target: string; start: number; end: number }> {
  return [...file.content.matchAll(/\[[^\]]+\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].flatMap((match) =>
    match.index !== undefined && match[1]
      ? [{ target: match[1], start: match.index, end: match.index + match[0].length }]
      : [],
  );
}
function documentationBlocks(
  content: string,
): Array<{ start: number; end: number; format: string }> {
  const expressions: Array<[RegExp, string]> = [
    [/\/\*\*[\s\S]*?\*\//g, "doc-comment"],
    [/(?:^|\n)\s*\/{3}[^\n]*(?:\n\s*\/{3}[^\n]*)*/g, "xml-or-rust-doc"],
    [/(?:^|\n)\s*\/\/[!]\s*[^\n]*(?:\n\s*\/\/[!]\s*[^\n]*)*/g, "rust-doc"],
    [/(?:^|\n)\s*(?:[rubf]*)?(?:\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?''')/gi, "docstring"],
  ];
  return expressions
    .flatMap(([expression, format]) =>
      [...content.matchAll(expression)].flatMap((match) =>
        match.index === undefined
          ? []
          : [{ start: match.index, end: match.index + match[0].length, format }],
      ),
    )
    .sort((left, right) => left.start - right.start);
}
function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export { capability };
