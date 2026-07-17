import { createHash } from "node:crypto";
import { posix } from "node:path";
import ts from "typescript";
import type {
  FileContribution,
  IntelligenceDiagnostic,
  IntelligenceEvidenceRecord,
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
  SourceRange
} from "../../../shared/contracts/intelligence";
import { EvidenceFactory } from "./EvidenceFactory";
import { IntelligenceIdFactory } from "./IntelligenceIdFactory";
import { ResolutionDiagnostics } from "./ResolutionDiagnostics";
import { semanticExtractionStages, type SemanticExtractionContext } from "./SemanticExtractors";
import type { SemanticParser, SemanticProjectRequest, SemanticProjectResult, SemanticSourceFileInput } from "./SemanticModel";
import { TYPESCRIPT_SEMANTIC_PARSER_ID, TYPESCRIPT_SEMANTIC_PARSER_VERSION } from "./SemanticVersion";
import { TypeScriptCpgProvider } from "../cpg/TypeScriptCpgProvider";
import { UniversalAdapterEngine } from "../adapters/UniversalAdapterEngine";

interface ProjectState {
  files: Map<string, SemanticSourceFileInput>;
  program?: ts.Program;
}

const SOURCE_LANGUAGES = new Set(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
const PARSER_ID = TYPESCRIPT_SEMANTIC_PARSER_ID;
const PARSER_VERSION = TYPESCRIPT_SEMANTIC_PARSER_VERSION;

export class TypeScriptJavaScriptParser implements SemanticParser {
  readonly id = PARSER_ID;
  readonly version = PARSER_VERSION;
  private readonly projects = new Map<string, ProjectState>();
  private readonly cpg = new TypeScriptCpgProvider();
  private readonly universal = new UniversalAdapterEngine();

  supports(language: string): boolean { return SOURCE_LANGUAGES.has(language); }

  async extract(request: SemanticProjectRequest): Promise<SemanticProjectResult> {
    let state = this.projects.get(request.projectKey);
    if (request.reset) {
      state = { files: new Map() };
      this.projects.set(request.projectKey, state);
    } else if (!state) {
      throw new Error("SEMANTIC_CONTEXT_MISSING: a complete semantic rebuild is required after worker restart.");
    }
    for (const relativePath of request.removedPaths) {
      for (const [key, file] of state.files) if (file.relativePath === relativePath || file.fileId === relativePath) state.files.delete(key);
    }
    for (const file of request.changedFiles) state.files.set(file.fileId, file);

    const inputs = [...state.files.values()];
    const sourceInputs = inputs.filter((file) => this.supports(file.language));
    const virtual = new Map(sourceInputs.map((file) => [virtualPath(file), file]));
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
      allowJs: true,
      checkJs: true,
      skipLibCheck: true,
      noEmit: true,
      allowSyntheticDefaultImports: true,
      esModuleInterop: true
    };
    const host = createCompilerHost(options, virtual);
    const program = ts.createProgram({ rootNames: [...virtual.keys()], options, host, oldProgram: state.program });
    state.program = program;
    const graph = new GraphAccumulator(request, inputs, program, virtual, options, host);
    graph.extract();
    const result = graph.result();
    const universal = await this.universal.analyze({ ...request, changedFiles: inputs }, result.entities, result.relationships);
    result.entities = mergeById(result.entities, universal.entities);
    result.relationships = mergeById(result.relationships, universal.relationships);
    result.evidence = mergeById(result.evidence, universal.evidence);
    result.diagnostics = [...result.diagnostics, ...universal.diagnostics].sort((left, right) => (left.relativePath ?? "").localeCompare(right.relativePath ?? "") || left.code.localeCompare(right.code));
    result.adapterState = universal.adapterState;
    result.contributions = augmentContributions(result, inputs);
    result.cpg = request.reset
      ? await this.cpg.build({ repositoryId: request.repositoryId, generation: request.generation, program, files: sourceInputs, entities: result.entities, relationships: result.relationships, evidence: result.evidence, analysisLevel: "basic" })
      : await this.cpg.update({ repositoryId: request.repositoryId, generation: request.generation, program, files: sourceInputs, entities: result.entities, relationships: result.relationships, evidence: result.evidence, analysisLevel: "basic", changedFileIds: request.changedFiles.map((file) => file.fileId), removedFileIds: request.removedPaths });
    for (const artifact of [...result.cpg.scopes].sort((left, right) => cpgScopePriority(left.descriptor.kind) - cpgScopePriority(right.descriptor.kind))) {
      const entity = result.entities.find((item) => item.id === artifact.descriptor.semanticSymbolId); if (!entity || entity.codeAnalysis) continue;
      entity.codeAnalysis = { scopeId: artifact.descriptor.id, structuralHash: artifact.descriptor.structuralHash, providerId: artifact.descriptor.providerId, providerVersion: artifact.descriptor.providerVersion, calculationMethod: `${artifact.descriptor.providerId}@${artifact.descriptor.providerVersion}:scope-summary`, confidence: artifact.descriptor.summary.approximateFlows > 0 ? 0.7 : 1, evidenceIds: entity.evidenceIds, branches: artifact.descriptor.summary.branches, calls: artifact.descriptor.summary.calls, reads: artifact.descriptor.summary.reads, writes: artifact.descriptor.summary.writes, unresolvedCalls: artifact.descriptor.summary.unresolvedCalls };
    }
    return result;
  }
}

function mergeById<T extends { id: string }>(left: T[], right: T[]): T[] { return [...new Map([...left, ...right].map((item) => [item.id, item])).values()].sort((first, second) => first.id.localeCompare(second.id)); }

function augmentContributions(result: SemanticProjectResult, inputs: SemanticSourceFileInput[]): FileContribution[] {
  const byFile = new Map(result.contributions.map((item) => [item.fileId, { ...item, entityIds: [...item.entityIds], relationshipIds: [...item.relationshipIds], evidenceIds: [...item.evidenceIds], diagnosticIds: [...item.diagnosticIds], dependencyFileIds: [...item.dependencyFileIds] }]));
  for (const input of inputs) if (!byFile.has(input.fileId)) byFile.set(input.fileId, { fileId: input.fileId, sourceHash: input.contentHash, parserId: PARSER_ID, parserVersion: PARSER_VERSION, entityIds: [], relationshipIds: [], evidenceIds: [], diagnosticIds: [], dependencyFileIds: [], generation: result.generation });
  for (const entity of result.entities) addContributionValue(byFile, entity.ownerFileId ?? entity.fileId, "entityIds", entity.id);
  for (const relationship of result.relationships) { if (!relationship.ownerFileId) continue; addContributionValue(byFile, relationship.ownerFileId, "relationshipIds", relationship.id); if (relationship.targetFileId && relationship.targetFileId !== relationship.ownerFileId) addContributionValue(byFile, relationship.ownerFileId, "dependencyFileIds", relationship.targetFileId); }
  for (const evidence of result.evidence) if (evidence.ownerFileId) addContributionValue(byFile, evidence.ownerFileId, "evidenceIds", evidence.id);
  for (const diagnostic of result.diagnostics) if (diagnostic.ownerFileId && diagnostic.id) addContributionValue(byFile, diagnostic.ownerFileId, "diagnosticIds", diagnostic.id);
  return [...byFile.values()].map((item) => ({ ...item, entityIds: [...new Set(item.entityIds)].sort(), relationshipIds: [...new Set(item.relationshipIds)].sort(), evidenceIds: [...new Set(item.evidenceIds)].sort(), diagnosticIds: [...new Set(item.diagnosticIds)].sort(), dependencyFileIds: [...new Set(item.dependencyFileIds)].sort() })).sort((left, right) => left.fileId.localeCompare(right.fileId));
}

function addContributionValue(values: Map<string, FileContribution>, fileId: string, key: "entityIds" | "relationshipIds" | "evidenceIds" | "diagnosticIds" | "dependencyFileIds", value: string): void { const contribution = values.get(fileId); if (contribution) contribution[key].push(value); }

class GraphAccumulator implements SemanticExtractionContext {
  private readonly ids = new IntelligenceIdFactory();
  private readonly evidenceFactory = new EvidenceFactory(this.ids);
  private readonly resolutionDiagnostics = new ResolutionDiagnostics(this.ids);
  private readonly entities = new Map<string, IntelligenceSymbolRecord>();
  private readonly relationships = new Map<string, IntelligenceRelationshipRecord>();
  private readonly evidence = new Map<string, IntelligenceEvidenceRecord>();
  private readonly declarationIds = new Map<ts.Node, string>();
  private readonly symbolIds = new Map<ts.Symbol, string>();
  private readonly sourceInputs = new Map<ts.SourceFile, SemanticSourceFileInput>();
  private readonly packageByRoot = new Map<string, string>();
  private readonly externalByName = new Map<string, string>();
  private readonly testCases = new Map<ts.CallExpression, string>();
  private readonly fileUpdates = new Map<string, SemanticProjectResult["fileUpdates"][number]>();
  private readonly importTargets = new Map<ts.SourceFile, Map<string, string>>();

  constructor(
    private readonly request: SemanticProjectRequest,
    private readonly inputs: SemanticSourceFileInput[],
    private readonly program: ts.Program,
    private readonly virtual: Map<string, SemanticSourceFileInput>,
    private readonly options: ts.CompilerOptions,
    private readonly host: ts.CompilerHost
  ) {
    for (const source of program.getSourceFiles()) {
      const input = virtual.get(normalizeFileName(source.fileName));
      if (input) this.sourceInputs.set(source, input);
    }
  }

  extract(): void {
    for (const stage of semanticExtractionStages) stage.extract(this);
    for (const [source, input] of this.sourceInputs) this.addCompilerDiagnostics(source, input);
  }

  extractSymbols(): void {
    for (const [source, input] of this.sourceInputs) {
      this.fileUpdates.set(input.fileId, {
        id: input.fileId,
        structuralHash: structuralHash(source),
        parserId: PARSER_ID,
        parserVersion: PARSER_VERSION,
        sourceRoot: sourceRoot(input.relativePath),
        isTest: input.category === "test",
        parseStatus: "parsed",
        shardReferences: [`entities/${input.fileId}`, `relationships/${input.fileId}`, `evidence/${input.fileId}`]
      });
      this.addModule(source, input);
      this.extractDeclarations(source, input);
    }
  }

  extractImportsAndExports(): void { for (const [source, input] of this.sourceInputs) this.extractImportsAndExportsForFile(source, input); }
  resolveTypes(): void { for (const [source, input] of this.sourceInputs) this.extractTypesForFile(source, input); }
  extractTests(): void { for (const [source, input] of this.sourceInputs) this.extractTestsForFile(source, input); }
  extractRoutes(): void { for (const [source, input] of this.sourceInputs) this.extractRoutesForFile(source, input); }
  resolveCalls(): void { for (const [source, input] of this.sourceInputs) this.extractCallsForFile(source, input); }
  resolveReferences(): void { for (const [source, input] of this.sourceInputs) this.extractReferencesForFile(source, input); }
  extractReact(): void { for (const [source, input] of this.sourceInputs) this.extractReactForFile(source, input); }
  extractConfiguration(): void { for (const [source, input] of this.sourceInputs) this.extractConfigurationForFile(source, input); }

  result(): SemanticProjectResult {
    const diagnostics = [...this.resolutionDiagnostics.all()];
    const entities = [...this.entities.values()].sort((left, right) => left.id.localeCompare(right.id));
    const relationships = [...this.relationships.values()].sort((left, right) => left.id.localeCompare(right.id));
    const evidence = [...this.evidence.values()].sort((left, right) => left.id.localeCompare(right.id));
    const contributions = this.buildContributions(entities, relationships, evidence, diagnostics);
    return {
      repositoryId: this.request.repositoryId,
      generation: this.request.generation,
      jobRevision: this.request.jobRevision,
      parserId: PARSER_ID,
      parserVersion: PARSER_VERSION,
      sourceHashes: Object.fromEntries(this.inputs.map((file) => [file.fileId, file.contentHash])),
      fileUpdates: [...this.fileUpdates.values()].sort((left, right) => left.id.localeCompare(right.id)),
      entities,
      relationships,
      evidence,
      diagnostics,
      contributions
    };
  }

  extractPackages(): void {
    for (const input of this.inputs.filter((file) => /(^|\/)package\.json$/.test(file.relativePath))) {
      let value: unknown;
      try { value = JSON.parse(input.content) as unknown; }
      catch {
        this.resolutionDiagnostics.add("parse-failure", "package.json is not valid JSON.", input.fileId, input.workspaceRootId, input.relativePath, undefined, undefined, "error");
        continue;
      }
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name : input.relativePath.replace(/\/package\.json$/, "") || "workspace";
      const packageEntity = this.addInputEntity(input, "keystone.core.Package", name, `package:${name}`, wholeFileRange(input.content), { exported: true });
      this.packageByRoot.set(input.workspaceRootId, packageEntity.id);
      const update = this.fileUpdates.get(input.fileId) ?? { id: input.fileId };
      update.packageId = packageEntity.id;
      update.parseStatus = "parsed";
      update.parserId = PARSER_ID;
      update.parserVersion = PARSER_VERSION;
      this.fileUpdates.set(input.fileId, update);
      for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"] as const) {
        const dependencies = record[section];
        if (!dependencies || typeof dependencies !== "object") continue;
        for (const dependencyName of Object.keys(dependencies).sort()) {
          const dependency = this.ensureExternalDependency(input, dependencyName);
          this.addRelationship(packageEntity.id, dependency.id, "keystone.core.DEPENDS_ON", input, wholeFileRange(input.content), "extracted", 1, "exact", { dependencyKind: section });
        }
      }
      const scripts = record.scripts;
      if (scripts && typeof scripts === "object") {
        for (const scriptName of Object.keys(scripts).sort()) {
          const type = scriptName.includes("test") ? "keystone.core.TestCommand" : scriptName.includes("build") ? "keystone.core.BuildCommand" : scriptName.includes("lint") ? "keystone.core.LintCommand" : "keystone.core.Command";
          const script = this.addInputEntity(input, type, scriptName, `${name}.scripts.${scriptName}`, wholeFileRange(input.content));
          this.addRelationship(packageEntity.id, script.id, "keystone.core.HAS_SCRIPT", input, wholeFileRange(input.content), "extracted", 1, "exact", { scriptName });
        }
      }
    }

    for (const input of this.inputs.filter((file) => /(^|\/)(tsconfig|jsconfig)(?:\.[^/]*)?\.json$/.test(file.relativePath))) {
      const config = this.addInputEntity(input, "keystone.core.ConfigurationFile", input.relativePath.split("/").at(-1) ?? input.relativePath, input.relativePath, wholeFileRange(input.content));
      const packageId = this.packageByRoot.get(input.workspaceRootId);
      if (packageId) this.addRelationship(packageId, config.id, "keystone.core.CONFIGURED_BY", input, wholeFileRange(input.content), "extracted", 1, "exact");
      const parsed = ts.parseConfigFileTextToJson(input.relativePath, input.content);
      const configValue = parsed.config as { compilerOptions?: { paths?: Record<string, unknown> }; references?: Array<{ path?: unknown }> } | undefined;
      for (const alias of Object.keys(configValue?.compilerOptions?.paths ?? {}).sort()) {
        const key = this.addInputEntity(input, "keystone.core.ConfigurationKey", alias, `${input.relativePath}.paths.${alias}`, wholeFileRange(input.content));
        this.addRelationship(config.id, key.id, "keystone.core.DECLARES", input, wholeFileRange(input.content), "extracted", 1, "exact", { configurationKind: "path-alias" });
      }
      for (const reference of configValue?.references ?? []) if (typeof reference.path === "string") {
        const key = this.addInputEntity(input, "keystone.core.ConfigurationKey", reference.path, `${input.relativePath}.references.${reference.path}`, wholeFileRange(input.content));
        this.addRelationship(config.id, key.id, "keystone.core.DECLARES", input, wholeFileRange(input.content), "extracted", 1, "exact", { configurationKind: "project-reference" });
      }
      const update = this.fileUpdates.get(input.fileId) ?? { id: input.fileId };
      update.packageId = packageId;
      update.parseStatus = "parsed";
      update.parserId = PARSER_ID;
      update.parserVersion = PARSER_VERSION;
      this.fileUpdates.set(input.fileId, update);
    }
  }

  private addModule(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const module = this.addNodeEntity(source, input, "keystone.core.Module", input.relativePath, `module:${input.relativePath}`, undefined, { exported: true });
    const update = this.fileUpdates.get(input.fileId);
    if (update) {
      update.moduleId = module.id;
      update.packageId = this.packageByRoot.get(input.workspaceRootId);
      update.exported = ts.isExternalModule(source);
    }
    const packageId = this.packageByRoot.get(input.workspaceRootId);
    if (packageId) {
      this.addRelationship(module.id, packageId, "keystone.core.BELONGS_TO", input, rangeOf(source, source), "resolved", 1, "exact");
      this.addRelationship(input.fileId, packageId, "keystone.core.BELONGS_TO", input, rangeOf(source, source), "resolved", 1, "exact");
    }
  }

  private extractDeclarations(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const visit = (node: ts.Node): void => {
      const type = declarationType(node);
      const nameNode = declarationNameNode(node);
      if (type && nameNode) {
        const name = declarationName(nameNode);
        if (name) {
          const signature = signatureOf(node, this.program.getTypeChecker());
          const kind = reactKind(node, name, type);
          const parentId = findParentId(node.parent, this.declarationIds);
          const entity = this.addNodeEntity(node, input, kind, name, qualifiedName(node, name), signature, declarationProperties(node, this.program.getTypeChecker(), parentId));
          this.declarationIds.set(node, entity.id);
          const symbol = this.program.getTypeChecker().getSymbolAtLocation(nameNode);
          if (symbol) this.symbolIds.set(resolveAlias(symbol, this.program.getTypeChecker()), entity.id);
          if (parentId) this.addRelationship(parentId, entity.id, ts.isParameter(node) ? "keystone.core.HAS_PARAMETER" : "keystone.core.HAS_MEMBER", input, rangeOf(node, source), "extracted", 1, "exact");
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractImportsAndExportsForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const checker = this.program.getTypeChecker();
    for (const statement of source.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const targetId = this.resolveModuleTarget(statement.moduleSpecifier.text, source, input);
        if (targetId) {
          const local = this.inputs.some((file) => file.fileId === targetId);
          this.addRelationship(input.fileId, targetId, "keystone.core.IMPORTS", input, rangeOf(statement.moduleSpecifier, source), "resolved", local ? 1 : 0.9, local ? "compiler" : "external", { moduleSpecifier: statement.moduleSpecifier.text, typeOnly: statement.importClause?.isTypeOnly ?? false });
          const sourceModule = this.fileUpdates.get(input.fileId)?.moduleId;
          const targetModule = this.fileUpdates.get(targetId)?.moduleId;
          if (sourceModule && targetModule) this.addRelationship(sourceModule, targetModule, "keystone.core.DEPENDS_ON", input, rangeOf(statement.moduleSpecifier, source), "resolved", 1, "compiler", { moduleSpecifier: statement.moduleSpecifier.text });
          this.registerImportTargets(statement, targetId, source);
        }
        else this.resolutionDiagnostics.add("unresolved-import", `Could not resolve ${statement.moduleSpecifier.text}.`, input.fileId, input.workspaceRootId, input.relativePath, rangeOf(statement.moduleSpecifier, source));
        const bindings: ts.Identifier[] = [];
        if (statement.importClause?.name) bindings.push(statement.importClause.name);
        const named = statement.importClause?.namedBindings;
        if (named && ts.isNamespaceImport(named)) bindings.push(named.name);
        else if (named) for (const element of named.elements) bindings.push(element.name);
        for (const binding of bindings) {
          const alias = this.addNodeEntity(binding, input, "keystone.core.Alias", binding.text, qualifiedName(binding, binding.text), undefined, { parentId: input.fileId });
          const symbol = checker.getSymbolAtLocation(binding);
          const target = named && ts.isNamespaceImport(named) && named.name === binding ? targetId : symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
          const typeOnly = statement.importClause?.isTypeOnly === true || ts.isImportSpecifier(binding.parent) && binding.parent.isTypeOnly;
          if (target) {
            this.addRelationship(alias.id, target, "keystone.core.ALIASES", input, rangeOf(binding, source), "resolved", 1, "compiler", { alias: binding.text, typeOnly });
            this.addRelationship(alias.id, target, "keystone.core.IMPORTS", input, rangeOf(binding, source), "resolved", 1, "compiler", { alias: binding.text, typeOnly });
          }
        }
      }
      if (ts.isExportDeclaration(statement)) {
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const target = this.resolveModuleTarget(statement.moduleSpecifier.text, source, input);
          if (target) this.addRelationship(input.fileId, target, "keystone.core.RE_EXPORTS", input, rangeOf(statement, source), "resolved", 1, target.startsWith("file:") ? "compiler" : "external", { moduleSpecifier: statement.moduleSpecifier.text, typeOnly: statement.isTypeOnly });
        }
        if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
          for (const element of statement.exportClause.elements) {
            const symbol = checker.getSymbolAtLocation(element.name);
            const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
            if (target) this.addRelationship(input.fileId, target, "keystone.core.EXPORTS", input, rangeOf(element, source), "resolved", 1, "compiler", { exportedName: element.name.text, typeOnly: element.isTypeOnly });
          }
        }
      }
    }
    for (const entity of this.entities.values()) {
      if (entity.fileId !== input.fileId || !entity.exported) continue;
      this.addRelationship(input.fileId, entity.id, "keystone.core.EXPORTS", input, entity.range, "extracted", 1, "exact", { default: entity.defaultExport ?? false });
    }
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const target = this.resolveModuleTarget(node.arguments[0].text, source, input);
        if (target) this.addRelationship(this.enclosingEntity(node, input.fileId), target, "keystone.core.IMPORTS", input, rangeOf(node, source), "resolved", target.startsWith("file:") ? 1 : 0.9, target.startsWith("file:") ? "compiler" : "external", { moduleSpecifier: node.arguments[0].text, commonJs: true });
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
        const target = this.resolveModuleTarget(node.arguments[0].text, source, input);
        if (target) this.addRelationship(this.enclosingEntity(node, input.fileId), target, "keystone.core.IMPORTS", input, rangeOf(node, source), "resolved", 1, target.startsWith("file:") ? "compiler" : "external", { moduleSpecifier: node.arguments[0].text, dynamic: true });
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && isCommonJsExport(node.left)) {
        const symbol = symbolForExpression(node.right, checker);
        const target = this.declarationIds.get(node.right) ?? (symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined);
        if (target) this.addRelationship(input.fileId, target, "keystone.core.EXPORTS", input, rangeOf(node, source), "resolved", 1, "compiler", { commonJs: true });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractTypesForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const checker = this.program.getTypeChecker();
    const visit = (node: ts.Node): void => {
      if ((ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) && node.heritageClauses) {
        const sourceId = this.declarationIds.get(node);
        if (sourceId) for (const clause of node.heritageClauses) for (const type of clause.types) {
          const symbol = checker.getSymbolAtLocation(type.expression);
          const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
          if (target) this.addRelationship(sourceId, target, clause.token === ts.SyntaxKind.ImplementsKeyword ? "keystone.core.IMPLEMENTS" : "keystone.core.EXTENDS", input, rangeOf(type, source), "resolved", 1, "compiler");
        }
      }
      if (isCallableDeclaration(node)) {
        const sourceId = this.declarationIds.get(node);
        if (sourceId) {
          const accepts = this.entities.get(sourceId)?.type === "keystone.core.Component" ? "keystone.core.ACCEPTS_PROPS" : "keystone.core.ACCEPTS_TYPE";
          for (const parameter of node.parameters) this.addTypeRelationship(sourceId, parameter.type, accepts, input, source, checker);
          this.addTypeRelationship(sourceId, node.type, "keystone.core.RETURNS", input, source, checker);
        }
      }
      if ((ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) && node.type) {
        const sourceId = this.declarationIds.get(node);
        if (sourceId) this.addTypeRelationship(sourceId, node.type, "keystone.core.REFERENCES_TYPE", input, source, checker);
      }
      if (ts.isTypeReferenceNode(node)) {
        const owner = this.enclosingEntity(node, input.fileId);
        this.addTypeRelationship(owner, node, "keystone.core.REFERENCES_TYPE", input, source, checker);
      }
      if (ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
        const sourceId = this.declarationIds.get(node);
        if (sourceId) for (const parameter of node.initializer.parameters) this.addTypeRelationship(sourceId, parameter.type, "keystone.core.ACCEPTS_PROPS", input, source, checker);
      }
      if (ts.isMethodDeclaration(node)) this.extractOverride(node, input, source, checker);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractTestsForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const visit = (node: ts.Node, currentSuite?: string): void => {
      let suite = currentSuite;
      if (ts.isCallExpression(node)) {
        const callName = expressionName(node.expression);
        const title = node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) ? node.arguments[0].text : undefined;
        if (title && ["describe", "suite"].includes(callName)) {
          const entity = this.addNodeEntity(node, input, "keystone.core.TestSuite", title, `${input.relativePath}::${title}`);
          suite = entity.id;
          this.testCases.set(node, entity.id);
          this.addRelationship(currentSuite ?? input.fileId, entity.id, "keystone.core.CONTAINS", input, rangeOf(node, source), "framework-rule", 1, "framework", { framework: callName });
        } else if (title && ["it", "test"].includes(callName)) {
          const entity = this.addNodeEntity(node, input, "keystone.core.TestCase", title, `${input.relativePath}::${currentSuite ?? "root"}::${title}`);
          this.testCases.set(node, entity.id);
          this.addRelationship(currentSuite ?? input.fileId, entity.id, "keystone.core.CONTAINS", input, rangeOf(node, source), "framework-rule", 1, "framework", { framework: callName });
          const callback = node.arguments.find((argument): argument is ts.ArrowFunction | ts.FunctionExpression => ts.isArrowFunction(argument) || ts.isFunctionExpression(argument));
          for (const parameter of callback?.parameters ?? []) {
            const name = parameter.name.getText(source);
            const fixture = this.addNodeEntity(parameter, input, "keystone.core.Fixture", name, `${entity.qualifiedName}.fixture.${name}`);
            this.addRelationship(entity.id, fixture.id, "keystone.core.USES_FIXTURE", input, rangeOf(parameter, source), "framework-rule", 1, "framework");
          }
        } else if (["beforeAll", "beforeEach", "afterAll", "afterEach", "before", "after"].includes(callName)) {
          const entity = this.addNodeEntity(node, input, "keystone.core.TestHook", callName, `${input.relativePath}::${currentSuite ?? "root"}::${callName}@${node.getStart(source)}`);
          this.testCases.set(node, entity.id);
          this.addRelationship(currentSuite ?? input.fileId, entity.id, "keystone.core.CONTAINS", input, rangeOf(node, source), "framework-rule", 1, "framework", { framework: callName });
        }
        if (["mock", "spyOn"].includes(callName)) {
          const owner = this.enclosingTest(node) ?? input.fileId;
          const first = node.arguments[0];
          if (first && ts.isStringLiteralLike(first)) {
            const target = this.resolveModuleTarget(first.text, source, input);
            if (target) this.addRelationship(owner, target, "keystone.core.MOCKS", input, rangeOf(node, source), "framework-rule", 1, "framework", { framework: callName });
          }
        }
      }
      ts.forEachChild(node, (child) => visit(child, suite));
    };
    visit(source);
  }

  private extractCallsForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const checker = this.program.getTypeChecker();
    const exactTestTargets = new Map<string, Set<string>>();
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const caller = this.enclosingEntity(node, input.fileId);
        const signature = checker.getResolvedSignature(node);
        const declaration = signature?.declaration;
        let target = this.importCallTarget(node.expression, source) ?? (declaration ? this.declarationIds.get(declaration) ?? this.symbolIds.get(resolveAlias(checker.getSymbolAtLocation(declarationNameNode(declaration) ?? declaration) ?? ({ flags: 0 } as ts.Symbol), checker)) : undefined);
        if (!target && ts.isNewExpression(node)) {
          const symbol = symbolForExpression(node.expression, checker);
          if (symbol) target = this.symbolIds.get(resolveAlias(symbol, checker));
        }
        if (!target && ts.isCallExpression(node)) {
          const symbol = symbolForExpression(node.expression, checker);
          if (symbol) target = this.symbolIds.get(resolveAlias(symbol, checker));
        }
        const relationshipType = ts.isNewExpression(node) ? "keystone.core.INSTANTIATES" : "keystone.core.CALLS";
        if (target) {
          this.addRelationship(caller, target, relationshipType, input, rangeOf(node.expression, source), "resolved", 1, "compiler", { argumentCount: node.arguments?.length ?? 0, optional: ts.isCallExpression(node) && Boolean(node.questionDotToken), dynamicDispatch: false });
          const test = this.enclosingTest(node);
          if (test && !this.isTestEntity(target)) {
            this.addRelationship(test, target, "keystone.core.TESTS", input, rangeOf(node.expression, source), "resolved", 1, "compiler", { evidenceLevel: 1 });
            const targets = exactTestTargets.get(test) ?? new Set<string>(); targets.add(target); exactTestTargets.set(test, targets);
          }
          const targetEntity = this.entities.get(target);
          if (targetEntity?.type === "keystone.core.Hook" || /^use[A-Z0-9]/.test(targetEntity?.name ?? "")) this.addRelationship(caller, target, "keystone.core.USES_HOOK", input, rangeOf(node.expression, source), "framework-rule", 1, "framework");
        } else if (!isKnownFrameworkCall(node) && !isNonRepositoryCall(node, checker)) {
          this.resolutionDiagnostics.add("unresolved-call", `The compiler could not resolve call target ${node.expression.getText(source)}.`, input.fileId, input.workspaceRootId, input.relativePath, rangeOf(node.expression, source), caller);
        }
        if (ts.isCallExpression(node) && expressionName(node.expression) === "useContext" && node.arguments[0]) {
          const contextSymbol = symbolForExpression(node.arguments[0], checker);
          const contextTarget = contextSymbol ? this.symbolIds.get(resolveAlias(contextSymbol, checker)) : undefined;
          if (contextTarget) this.addRelationship(caller, contextTarget, "keystone.core.CONSUMES_CONTEXT", input, rangeOf(node, source), "framework-rule", 1, "compiler");
        }
        if (ts.isCallExpression(node) && isCallbackRegistration(node.expression)) {
          for (const argument of node.arguments) {
            const callbackSymbol = symbolForExpression(argument, checker);
            const callbackTarget = callbackSymbol ? this.symbolIds.get(resolveAlias(callbackSymbol, checker)) : undefined;
            if (callbackTarget) this.addRelationship(caller, callbackTarget, "keystone.core.REGISTERS_HANDLER", input, rangeOf(argument, source), "resolved", 1, "compiler", { registration: expressionName(node.expression) });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    if (input.category === "test") this.addNamingCandidates(input, source, exactTestTargets);
  }

  private extractReferencesForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const checker = this.program.getTypeChecker();
    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && !isDeclarationIdentifier(node) && !isCallCallee(node) && !isJsxTagName(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
        const owner = this.enclosingEntity(node, input.fileId);
        if (target && owner !== target) {
          this.addRelationship(owner, target, "keystone.core.REFERENCES", input, rangeOf(node, source), "resolved", 1, "compiler");
          const test = this.enclosingTest(node);
          if (test && !this.isTestEntity(target)) this.addRelationship(test, target, "keystone.core.TESTS", input, rangeOf(node, source), "resolved", 0.9, "compiler", { evidenceLevel: 2 });
        }
        else if (!symbol && !KNOWN_GLOBALS.has(node.text)) this.resolutionDiagnostics.add("unresolved-symbol", `The compiler could not resolve ${node.text}.`, input.fileId, input.workspaceRootId, input.relativePath, rangeOf(node, source), owner, "info");
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractReactForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const checker = this.program.getTypeChecker();
    const visit = (node: ts.Node): void => {
      if (isJsxTag(node)) {
        const tag = node.tagName;
        if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text)) {
          const symbol = checker.getSymbolAtLocation(tag);
          const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
          if (target) this.addRelationship(this.enclosingEntity(node, input.fileId), target, "keystone.core.RENDERS", input, rangeOf(tag, source), "framework-rule", 1, "compiler");
        }
        if (ts.isPropertyAccessExpression(tag) && tag.name.text === "Provider") {
          const symbol = checker.getSymbolAtLocation(tag.expression);
          const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
          if (target) this.addRelationship(this.enclosingEntity(node, input.fileId), target, "keystone.core.PROVIDES_CONTEXT", input, rangeOf(tag, source), "framework-rule", 1, "compiler");
        }
      }
      if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && /^on[A-Z]/.test(node.name.text) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
        const symbol = symbolForExpression(node.initializer.expression, checker);
        const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
        if (target) this.addRelationship(this.enclosingEntity(node, input.fileId), target, "keystone.core.HANDLES_EVENT", input, rangeOf(node, source), "framework-rule", 1, "compiler", { event: node.name.text });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractRoutesForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const visit = (node: ts.Node): void => { if (ts.isCallExpression(node)) this.extractRoute(node, input, source); ts.forEachChild(node, visit); };
    visit(source);
  }

  private extractConfigurationForFile(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) this.extractConfigurationCall(node, this.enclosingEntity(node, input.fileId), input, source);
      if (ts.isPropertyAccessExpression(node)) this.extractConfigurationAccess(node, input, source);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  private extractRoute(node: ts.CallExpression, input: SemanticSourceFileInput, source: ts.SourceFile): void {
    const checker = this.program.getTypeChecker();
    const name = expressionName(node.expression);
    const first = node.arguments[0];
    const routeMethods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "use"]);
    let routeName: string | undefined;
    let method: string | undefined;
    let handlerArguments: readonly ts.Expression[] = [];
    if (routeMethods.has(name) && first && ts.isStringLiteralLike(first) && (first.text.startsWith("/") || first.text === "*") && ts.isPropertyAccessExpression(node.expression) && isRouterReceiver(node.expression.expression)) {
      method = name.toUpperCase(); routeName = first.text; handlerArguments = node.arguments.slice(1);
    } else if (name === "registerCommand" && first && ts.isStringLiteralLike(first)) {
      method = "COMMAND"; routeName = first.text; handlerArguments = node.arguments.slice(1);
    }
    if (!routeName || !method) return;
    const type = method === "COMMAND" ? "keystone.core.Command" : "keystone.core.Route";
    const route = this.addNodeEntity(node, input, type, routeName, `${method} ${routeName}`, undefined, { exported: true });
    for (let index = 0; index < handlerArguments.length; index++) {
      const argument = handlerArguments[index];
      if (!argument) continue;
      const symbol = symbolForExpression(argument, checker);
      let target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
      if (!target && (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument))) {
        const role = index === handlerArguments.length - 1 ? "handler" : "middleware";
        const callback = this.addNodeEntity(argument, input, role === "middleware" ? "keystone.core.Middleware" : "keystone.core.Function", `${method} ${routeName} ${role}`, `${input.relativePath}::${method} ${routeName}::${role}@${argument.getStart(source)}`, signatureOf(argument, checker));
        this.declarationIds.set(argument, callback.id);
        target = callback.id;
      }
      if (!target) {
        this.resolutionDiagnostics.add("unsupported-framework-pattern", `Could not resolve handler for ${method} ${routeName}.`, input.fileId, input.workspaceRootId, input.relativePath, rangeOf(argument, source), route.id, "info");
        continue;
      }
      const relation = index === handlerArguments.length - 1 ? "keystone.core.ROUTES_TO" : "keystone.core.USES_MIDDLEWARE";
      this.addRelationship(route.id, target, relation, input, rangeOf(argument, source), "framework-rule", 1, "framework", { method, path: routeName });
    }
  }

  private extractConfigurationCall(node: ts.CallExpression, owner: string, input: SemanticSourceFileInput, source: ts.SourceFile): void {
    const key = configurationKey(node);
    if (!key) return;
    const entity = this.addNodeEntity(node, input, "keystone.core.ConfigurationKey", key, `configuration:${key}`);
    this.addRelationship(owner, entity.id, "keystone.core.READS_CONFIGURATION", input, rangeOf(node, source), "extracted", 1, "exact", { key, fallback: node.arguments.length > 1 });
  }

  private extractConfigurationAccess(node: ts.PropertyAccessExpression, input: SemanticSourceFileInput, source: ts.SourceFile): void {
    const text = node.getText(source);
    const match = /^(?:process\.env|import\.meta\.env)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
    if (!match?.[1]) return;
    const key = match[1];
    const owner = this.enclosingEntity(node, input.fileId);
    const entity = this.addNodeEntity(node, input, "keystone.core.ConfigurationKey", key, `environment:${key}`);
    const fallback = ts.isBinaryExpression(node.parent) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(node.parent.operatorToken.kind);
    this.addRelationship(owner, entity.id, "keystone.core.READS_CONFIGURATION", input, rangeOf(node, source), "extracted", 1, "exact", { key, source: text.startsWith("process") ? "process.env" : "import.meta.env", fallback });
  }

  private extractOverride(node: ts.MethodDeclaration, input: SemanticSourceFileInput, source: ts.SourceFile, checker: ts.TypeChecker): void {
    const sourceId = this.declarationIds.get(node);
    const classNode = node.parent;
    if (!sourceId || !ts.isClassDeclaration(classNode) || !node.name) return;
    const classType = checker.getTypeAtLocation(classNode);
    for (const base of checker.getBaseTypes(classType as ts.InterfaceType) ?? []) {
      const property = base.getProperty(node.name.getText(source));
      if (!property) continue;
      const target = this.symbolIds.get(resolveAlias(property, checker));
      if (target) this.addRelationship(sourceId, target, "keystone.core.OVERRIDES", input, rangeOf(node.name, source), "resolved", 1, "compiler");
    }
  }

  private addTypeRelationship(sourceId: string, typeNode: ts.TypeNode | undefined, type: string, input: SemanticSourceFileInput, source: ts.SourceFile, checker: ts.TypeChecker): void {
    if (!typeNode) return;
    const symbol = checker.getSymbolAtLocation(typeNode) ?? checker.getTypeAtLocation(typeNode).getSymbol();
    const target = symbol ? this.symbolIds.get(resolveAlias(symbol, checker)) : undefined;
    if (target) this.addRelationship(sourceId, target, type, input, rangeOf(typeNode, source), "resolved", 1, "compiler", { typeText: typeNode.getText(source) });
  }

  private resolveModuleTarget(specifier: string, source: ts.SourceFile, input: SemanticSourceFileInput): string | undefined {
    if (specifier.startsWith(".")) {
      const base = normalizeFileName(posix.resolve(posix.dirname(source.fileName), specifier));
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`]) {
        const target = this.virtual.get(candidate);
        if (target) return target.fileId;
      }
    }
    const resolved = ts.resolveModuleName(specifier, source.fileName, this.options, { fileExists: (value) => this.host.fileExists(value), readFile: (value) => this.host.readFile(value), directoryExists: (value) => this.host.directoryExists?.(value) ?? false, getCurrentDirectory: () => this.host.getCurrentDirectory(), realpath: (value) => this.host.realpath?.(value) ?? value }).resolvedModule;
    if (resolved) {
      const targetInput = this.virtual.get(normalizeFileName(resolved.resolvedFileName));
      if (targetInput) return targetInput.fileId;
    }
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) return this.ensureExternalDependency(input, packageName(specifier)).id;
    return undefined;
  }

  private ensureExternalDependency(input: SemanticSourceFileInput, name: string): IntelligenceSymbolRecord {
    const existingId = this.externalByName.get(`${input.workspaceRootId}:${name}`);
    if (existingId) return this.entities.get(existingId)!;
    const entity = this.addInputEntity(input, "keystone.core.ExternalDependency", name, `npm:${name}`, wholeFileRange(input.content));
    this.externalByName.set(`${input.workspaceRootId}:${name}`, entity.id);
    return entity;
  }

  private addInputEntity(input: SemanticSourceFileInput, type: string, name: string, qualified: string, range: SourceRange, properties: Partial<IntelligenceSymbolRecord> = {}): IntelligenceSymbolRecord {
    const id = this.ids.entity(this.request.repositoryId, input.fileId, type, qualified, properties.signature);
    const entity: IntelligenceSymbolRecord = {
      id, repositoryId: this.request.repositoryId, fileId: input.fileId, ownerFileId: input.fileId, type, name, qualifiedName: qualified,
      language: input.language, range, confidence: 1, generation: this.request.generation, evidenceIds: [], ...properties
    };
    this.addEntity(entity, input, range, `The ${type.replace("keystone.core.", "")} ${qualified} was extracted.`);
    return this.entities.get(id)!;
  }

  private addNodeEntity(node: ts.Node, input: SemanticSourceFileInput, type: string, name: string, qualified: string, signature?: string, properties: Partial<IntelligenceSymbolRecord> = {}): IntelligenceSymbolRecord {
    const source = node.getSourceFile();
    const range = rangeOf(node, source);
    const nameNode = declarationNameNode(node);
    const docs = (node as ts.Node & { jsDoc?: ts.NodeArray<ts.JSDoc> }).jsDoc;
    const firstDoc = docs?.[0];
    const lastDoc = docs?.at(-1);
    const jsDocRange = firstDoc && lastDoc ? rangeFromOffsets(source, firstDoc.getStart(source), lastDoc.getEnd()) : undefined;
    return this.addInputEntity(input, type, name, qualified, range, { ...(signature ? { signature } : {}), ...(nameNode ? { nameRange: rangeOf(nameNode, source) } : {}), ...(jsDocRange ? { jsDocRange } : {}), ...properties });
  }

  private addEntity(entity: IntelligenceSymbolRecord, input: SemanticSourceFileInput, range: SourceRange, statement: string): void {
    if (this.entities.has(entity.id)) return;
    const evidence = this.evidenceFactory.create({ subjectId: entity.id, ownerFileId: input.fileId, workspaceRootId: input.workspaceRootId, relativePath: input.relativePath, range, sourceKind: entity.type.startsWith("keystone.core.Route") || entity.type.includes("Test") ? "framework-rule" : entity.type === "keystone.core.Package" || entity.type === "keystone.core.ExternalDependency" ? "manifest" : "typescript-compiler", extractorId: PARSER_ID, extractorVersion: PARSER_VERSION, derivation: entity.type.startsWith("keystone.core.Route") || entity.type.includes("Test") ? "framework-rule" : "extracted", contentHash: input.contentHash, branch: this.request.branch, commit: this.request.commit, generation: this.request.generation, confidence: entity.confidence, statement });
    entity.evidenceIds = [evidence.id];
    this.entities.set(entity.id, entity);
    this.evidence.set(evidence.id, evidence);
    this.addRelationship(input.fileId, entity.id, "keystone.core.DECLARES", input, range, "extracted", 1, "exact");
  }

  private addRelationship(sourceId: string, targetId: string, type: string, input: SemanticSourceFileInput, range: SourceRange, derivation: IntelligenceRelationshipRecord["derivation"], confidence: number, resolution: NonNullable<IntelligenceRelationshipRecord["resolution"]>, properties?: IntelligenceRelationshipRecord["properties"]): void {
    if (!sourceId || !targetId) return;
    const discriminatorValue = properties?.moduleSpecifier ?? properties?.path ?? "";
    const discriminator = `${range.startLine}:${range.startColumn}:${String(discriminatorValue)}`;
    const id = this.ids.relationship(this.request.repositoryId, sourceId, targetId, type, input.fileId, discriminator);
    if (this.relationships.has(id)) return;
    const evidence = this.evidenceFactory.create({ subjectId: id, ownerFileId: input.fileId, workspaceRootId: input.workspaceRootId, relativePath: input.relativePath, range, sourceKind: derivation === "framework-rule" ? "framework-rule" : "typescript-compiler", extractorId: PARSER_ID, extractorVersion: PARSER_VERSION, derivation, contentHash: input.contentHash, branch: this.request.branch, commit: this.request.commit, generation: this.request.generation, confidence, statement: `${type.replace("keystone.core.", "")} was ${derivation} from this source range.` });
    const targetFileId = this.entities.get(targetId)?.fileId ?? this.inputs.find((file) => file.fileId === targetId)?.fileId;
    this.relationships.set(id, { id, repositoryId: this.request.repositoryId, sourceId, targetId, type, ownerFileId: input.fileId, ...(targetFileId ? { targetFileId } : {}), resolution, ...(properties ? { properties } : {}), evidenceIds: [evidence.id], derivation, confidence, generation: this.request.generation });
    this.evidence.set(evidence.id, evidence);
  }

  private enclosingEntity(node: ts.Node, fallback: string): string {
    for (let current: ts.Node | undefined = node; current; current = current.parent) {
      const test = ts.isCallExpression(current) ? this.testCases.get(current) : undefined;
      if (test) return test;
      const entity = this.declarationIds.get(current);
      if (entity) return entity;
    }
    return fallback;
  }

  private enclosingTest(node: ts.Node): string | undefined {
    for (let current: ts.Node | undefined = node; current; current = current.parent) if (ts.isCallExpression(current) && this.testCases.has(current) && this.entities.get(this.testCases.get(current)!)?.type === "keystone.core.TestCase") return this.testCases.get(current);
    return undefined;
  }

  private isTestEntity(id: string): boolean { return this.entities.get(id)?.type.startsWith("keystone.core.Test") ?? false; }

  private addNamingCandidates(input: SemanticSourceFileInput, source: ts.SourceFile, exact: Map<string, Set<string>>): void {
    for (const [testNode, testId] of this.testCases) {
      if (testNode.getSourceFile() !== source || this.entities.get(testId)?.type !== "keystone.core.TestCase") continue;
      if ((exact.get(testId)?.size ?? 0) > 0) continue;
      const title = this.entities.get(testId)?.name.toLowerCase() ?? "";
      const candidate = [...this.entities.values()].find((entity) => entity.fileId !== input.fileId && entity.name.length > 2 && title.includes(entity.name.toLowerCase()) && ["keystone.core.Function", "keystone.core.Method", "keystone.core.Class"].includes(entity.type));
      if (candidate) this.addRelationship(testId, candidate.id, "keystone.core.TESTS", input, rangeOf(testNode, source), "calculated", 0.35, "candidate", { evidenceLevel: 4, candidateReason: "test-name" });
    }
  }

  private registerImportTargets(statement: ts.ImportDeclaration, targetFileId: string, source: ts.SourceFile): void {
    if (!targetFileId.startsWith("file:")) return;
    const targets = this.importTargets.get(source) ?? new Map<string, string>();
    const clause = statement.importClause;
    if (clause?.name) {
      const target = [...this.entities.values()].find((entity) => entity.fileId === targetFileId && entity.defaultExport);
      if (target) targets.set(clause.name.text, target.id);
    }
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) targets.set(`${bindings.name.text}.*`, targetFileId);
    else if (bindings) for (const element of bindings.elements) {
      const importedName = element.propertyName?.text ?? element.name.text;
      const target = [...this.entities.values()].find((entity) => entity.fileId === targetFileId && entity.name === importedName && entity.type !== "keystone.core.Parameter");
      if (target) targets.set(element.name.text, target.id);
    }
    this.importTargets.set(source, targets);
  }

  private importCallTarget(expression: ts.Expression, source: ts.SourceFile): string | undefined {
    const targets = this.importTargets.get(source); if (!targets) return undefined;
    if (ts.isIdentifier(expression)) return targets.get(expression.text);
    if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
      const fileId = targets.get(`${expression.expression.text}.*`);
      if (fileId) return [...this.entities.values()].find((entity) => entity.fileId === fileId && entity.name === expression.name.text && entity.type !== "keystone.core.Parameter")?.id;
    }
    return undefined;
  }

  private addCompilerDiagnostics(source: ts.SourceFile, input: SemanticSourceFileInput): void {
    for (const item of this.program.getSyntacticDiagnostics(source)) {
      const range = item.start === undefined ? undefined : rangeFromOffsets(source, item.start, item.start + (item.length ?? 0));
      this.resolutionDiagnostics.add("parse-failure", ts.flattenDiagnosticMessageText(item.messageText, " "), input.fileId, input.workspaceRootId, input.relativePath, range, undefined, "error");
      const update = this.fileUpdates.get(input.fileId); if (update) update.parseStatus = "failed";
    }
  }

  private buildContributions(entities: IntelligenceSymbolRecord[], relationships: IntelligenceRelationshipRecord[], evidence: IntelligenceEvidenceRecord[], diagnostics: IntelligenceDiagnostic[]): FileContribution[] {
    return this.inputs.map((file) => {
      const ownedEntities = entities.filter((item) => item.ownerFileId === file.fileId);
      const ownedRelationships = relationships.filter((item) => item.ownerFileId === file.fileId);
      const ownedEvidence = evidence.filter((item) => item.ownerFileId === file.fileId);
      const ownedDiagnostics = diagnostics.filter((item) => item.ownerFileId === file.fileId);
      const dependencies = new Set(ownedRelationships.map((item) => item.targetFileId).filter((item): item is string => Boolean(item) && item !== file.fileId));
      return { fileId: file.fileId, sourceHash: file.contentHash, structuralHash: this.fileUpdates.get(file.fileId)?.structuralHash, parserId: PARSER_ID, parserVersion: PARSER_VERSION, entityIds: ownedEntities.map((item) => item.id), relationshipIds: ownedRelationships.map((item) => item.id), evidenceIds: ownedEvidence.map((item) => item.id), diagnosticIds: ownedDiagnostics.flatMap((item) => item.id ? [item.id] : []), dependencyFileIds: [...dependencies].sort(), generation: this.request.generation };
    }).sort((left, right) => left.fileId.localeCompare(right.fileId));
  }
}

function createCompilerHost(options: ts.CompilerOptions, virtual: Map<string, SemanticSourceFileInput>): ts.CompilerHost {
  const fallback = ts.createCompilerHost(options, true);
  const content = new Map([...virtual].map(([path, input]) => [normalizeFileName(path), input.content]));
  const libraryRoot = posix.dirname(normalizeFileName(ts.getDefaultLibFilePath(options)));
  const libraryFile = (fileName: string): boolean => {
    const normalized = normalizeFileName(fileName);
    return posix.dirname(normalized) === libraryRoot && /^lib(?:\..+)?\.d\.ts$/.test(posix.basename(normalized));
  };
  return {
    ...fallback,
    fileExists: (fileName) => content.has(normalizeFileName(fileName)) || libraryFile(fileName) && fallback.fileExists(fileName),
    readFile: (fileName) => content.get(normalizeFileName(fileName)) ?? (libraryFile(fileName) ? fallback.readFile(fileName) : undefined),
    getSourceFile: (fileName, languageVersion) => {
      const value = content.get(normalizeFileName(fileName));
      return value === undefined ? (libraryFile(fileName) ? fallback.getSourceFile(fileName, languageVersion) : undefined) : ts.createSourceFile(fileName, value, languageVersion, true, scriptKind(fileName));
    },
    resolveModuleNames: (moduleNames, containingFile) => moduleNames.map((specifier) => {
      if (!specifier.startsWith(".")) return undefined;
      const base = normalizeFileName(posix.resolve(posix.dirname(containingFile), specifier));
      const resolvedFileName = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`, `${base}/index.jsx`].find((candidate) => content.has(candidate));
      return resolvedFileName ? { resolvedFileName, extension: moduleExtension(resolvedFileName), isExternalLibraryImport: false } : undefined;
    }),
    directoryExists: (directoryName) => {
      const normalized = normalizeFileName(directoryName);
      return normalized === libraryRoot || normalized === "/__keystone__" || [...content.keys()].some((path) => path.startsWith(`${normalized}/`));
    },
    getDirectories: () => [],
    realpath: normalizeFileName,
    writeFile: () => undefined,
    getCurrentDirectory: () => "/"
  };
}

function virtualPath(input: SemanticSourceFileInput): string { return normalizeFileName(`/__keystone__/${input.workspaceRootId.replace(/[^a-zA-Z0-9_-]/g, "_")}/${input.relativePath}`); }
function normalizeFileName(value: string): string { return value.replace(/\\/g, "/"); }
function scriptKind(path: string): ts.ScriptKind { return path.endsWith(".tsx") ? ts.ScriptKind.TSX : path.endsWith(".jsx") ? ts.ScriptKind.JSX : path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".cjs") ? ts.ScriptKind.JS : ts.ScriptKind.TS; }
function moduleExtension(path: string): ts.Extension { return path.endsWith(".tsx") ? ts.Extension.Tsx : path.endsWith(".jsx") ? ts.Extension.Jsx : path.endsWith(".js") ? ts.Extension.Js : ts.Extension.Ts; }
function structuralHash(source: ts.SourceFile): string { const scanner = ts.createScanner(ts.ScriptTarget.ES2022, true, source.languageVariant, source.text); const tokens: string[] = []; for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) tokens.push(`${token}:${scanner.getTokenText()}`); return `sha256:${createHash("sha256").update(tokens.join("\u001f")).digest("hex")}`; }
function sourceRoot(path: string): string { const first = path.split("/")[0]; return first && ["src", "lib", "app", "test", "tests"].includes(first) ? first : ""; }
function cpgScopePriority(kind: string): number { return kind === "callback" || kind === "module" ? 1 : 0; }
function wholeFileRange(content: string): SourceRange { const lines = content.split(/\r?\n/); return { startLine: 0, startColumn: 0, endLine: Math.max(0, lines.length - 1), endColumn: lines.at(-1)?.length ?? 0 }; }
function rangeOf(node: ts.Node, source: ts.SourceFile): SourceRange { return rangeFromOffsets(source, node.getStart(source, false), node.getEnd()); }
function rangeFromOffsets(source: ts.SourceFile, startOffset: number, endOffset: number): SourceRange { const start = source.getLineAndCharacterOfPosition(startOffset); const end = source.getLineAndCharacterOfPosition(endOffset); return { startLine: start.line, startColumn: start.character, endLine: end.line, endColumn: end.character }; }

function declarationType(node: ts.Node): string | undefined {
  if (ts.isModuleDeclaration(node)) return "keystone.core.Namespace";
  if (ts.isClassDeclaration(node)) return "keystone.core.Class";
  if (ts.isInterfaceDeclaration(node)) return "keystone.core.Interface";
  if (ts.isTypeAliasDeclaration(node)) return "keystone.core.TypeAlias";
  if (ts.isEnumDeclaration(node)) return "keystone.core.Enum";
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) return "keystone.core.Function";
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) return "keystone.core.Method";
  if (ts.isConstructorDeclaration(node)) return "keystone.core.Constructor";
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) return "keystone.core.Property";
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return isConstVariable(node) ? "keystone.core.Constant" : "keystone.core.Variable";
  if (ts.isParameter(node)) return "keystone.core.Parameter";
  return undefined;
}

function declarationNameNode(node: ts.Node): ts.Node | undefined {
  if ("name" in node) {
    const name = (node as ts.NamedDeclaration).name;
    if (name) return name;
  }
  if (ts.isConstructorDeclaration(node)) return node;
  return undefined;
}
function declarationName(node: ts.Node): string | undefined { return ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : node.kind === ts.SyntaxKind.Constructor ? "constructor" : node.getText().slice(0, 80) || undefined; }
function qualifiedName(node: ts.Node, name: string): string { const names = [name]; for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) { const parentName = declarationNameNode(current); const value = parentName ? declarationName(parentName) : undefined; if (value) names.unshift(value); } return names.join("."); }
function findParentId(node: ts.Node | undefined, ids: Map<ts.Node, string>): string | undefined { for (let current = node; current; current = current.parent) { const id = ids.get(current); if (id) return id; } return undefined; }
function isConstVariable(node: ts.VariableDeclaration): boolean { return ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0; }
function isCallableDeclaration(node: ts.Node): node is ts.SignatureDeclaration { return ts.isFunctionLike(node) && !ts.isFunctionTypeNode(node) && !ts.isConstructorTypeNode(node); }
function signatureOf(node: ts.Node, checker: ts.TypeChecker): string | undefined { if (!isCallableDeclaration(node)) return undefined; const signature = checker.getSignatureFromDeclaration(node); return signature ? checker.signatureToString(signature, node, ts.TypeFormatFlags.NoTruncation) : undefined; }
function reactKind(node: ts.Node, name: string, type: string): string { if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) && expressionName(node.initializer.expression) === "createContext") return "keystone.react.Context"; if ((ts.isFunctionLike(node) || ts.isVariableDeclaration(node)) && /^use[A-Z0-9]/.test(name)) return "keystone.core.Hook"; const componentCandidate = type === "keystone.core.Function" || type === "keystone.core.Class" || ts.isVariableDeclaration(node) && node.initializer !== undefined && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)); if (componentCandidate && /^[A-Z]/.test(name) && containsJsx(node)) return "keystone.core.Component"; return type; }
function containsJsx(node: ts.Node): boolean { let found = false; const visit = (child: ts.Node): void => { if (isJsxTag(child) || ts.isJsxElement(child) || ts.isJsxFragment(child)) found = true; else if (!found) ts.forEachChild(child, visit); }; ts.forEachChild(node, visit); return found; }
function declarationProperties(node: ts.Node, checker: ts.TypeChecker, parentId?: string): Partial<IntelligenceSymbolRecord> {
  const modifierNode = ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent) && ts.isVariableStatement(node.parent.parent) ? node.parent.parent : node;
  const modifiers = ts.canHaveModifiers(modifierNode) ? ts.getModifiers(modifierNode) : undefined;
  const flags = new Set(modifiers?.map((item) => item.kind));
  const parameters = isCallableDeclaration(node) ? node.parameters.map((item) => ({ name: item.name.getText(), ...(item.type ? { type: item.type.getText() } : {}), ...(item.questionToken ? { optional: true } : {}), ...(item.dotDotDotToken ? { rest: true } : {}) })) : undefined;
  const signature = isCallableDeclaration(node) ? checker.getSignatureFromDeclaration(node) : undefined;
  const typeParameters = (node as { typeParameters?: ts.NodeArray<ts.TypeParameterDeclaration> }).typeParameters;
  const decorators = ts.canHaveDecorators(modifierNode) ? ts.getDecorators(modifierNode)?.map((item) => item.expression.getText()) : undefined;
  return {
    ...(parentId ? { parentId } : {}),
    visibility: flags.has(ts.SyntaxKind.PrivateKeyword) ? "private" : flags.has(ts.SyntaxKind.ProtectedKeyword) ? "protected" : parentId ? "public" : "local",
    exported: flags.has(ts.SyntaxKind.ExportKeyword),
    defaultExport: flags.has(ts.SyntaxKind.DefaultKeyword),
    static: flags.has(ts.SyntaxKind.StaticKeyword),
    async: flags.has(ts.SyntaxKind.AsyncKeyword),
    abstract: flags.has(ts.SyntaxKind.AbstractKeyword),
    readonly: flags.has(ts.SyntaxKind.ReadonlyKeyword),
    ...(parameters ? { parameters } : {}),
    ...(signature ? { returnType: checker.typeToString(signature.getReturnType()) } : {}),
    ...(typeParameters ? { typeParameters: [...typeParameters].map((item) => item.name.text) } : {}),
    ...(decorators?.length ? { decorators } : {}),
    deprecated: ts.getJSDocDeprecatedTag(node) !== undefined
  };
}
function resolveAlias(symbol: ts.Symbol, checker: ts.TypeChecker): ts.Symbol { return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol; }
function expressionName(expression: ts.Expression): string { return ts.isIdentifier(expression) ? expression.text : ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.getText().slice(0, 80); }
function symbolForExpression(expression: ts.Expression, checker: ts.TypeChecker): ts.Symbol | undefined { return checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression); }
function packageName(specifier: string): string { const parts = specifier.split("/"); return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0] ?? specifier; }
function isCommonJsExport(node: ts.Expression): boolean { const text = node.getText(); return text === "module.exports" || text.startsWith("exports.") || text.startsWith("module.exports."); }
function isDeclarationIdentifier(node: ts.Identifier): boolean { const parent = node.parent; return ("name" in parent && (parent as ts.NamedDeclaration).name === node) || ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent) || (ts.isPropertyAccessExpression(parent) && parent.name === node); }
function isCallCallee(node: ts.Identifier): boolean { const parent = node.parent; return (ts.isCallExpression(parent) || ts.isNewExpression(parent)) && parent.expression === node; }
function isJsxTag(node: ts.Node): node is ts.JsxOpeningElement | ts.JsxSelfClosingElement { return ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node); }
function isJsxTagName(node: ts.Identifier): boolean { return (isJsxTag(node.parent) && node.parent.tagName === node) || (ts.isJsxClosingElement(node.parent) && node.parent.tagName === node); }
function isKnownFrameworkCall(node: ts.CallExpression | ts.NewExpression): boolean { const name = expressionName(node.expression); return ["describe", "suite", "it", "test", "expect", "mock", "spyOn", "beforeAll", "beforeEach", "afterAll", "afterEach", "before", "after", "registerCommand", "get", "post", "put", "patch", "delete", "use"].includes(name); }
function isCallbackRegistration(expression: ts.Expression): boolean { return ["on", "once", "addEventListener", "subscribe", "then", "catch", "finally"].includes(expressionName(expression)); }
function isNonRepositoryCall(node: ts.CallExpression | ts.NewExpression, checker: ts.TypeChecker): boolean {
  if (ts.isPropertyAccessExpression(node.expression) && NON_REPOSITORY_METHODS.has(node.expression.name.text)) return true;
  const symbol = symbolForExpression(node.expression, checker);
  if (symbol?.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile)) return true;
  const receiver = ts.isPropertyAccessExpression(node.expression) || ts.isElementAccessExpression(node.expression) ? node.expression.expression : node.expression;
  const receiverType = checker.getTypeAtLocation(receiver);
  if ((receiverType.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.ESSymbolLike)) !== 0) return true;
  if (checker.isArrayType(receiverType) || checker.isTupleType(receiverType)) return true;
  if (receiverType.getSymbol()?.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile)) return true;
  const root = rootIdentifier(node.expression);
  if (!root) return false;
  if (KNOWN_GLOBALS.has(root.text)) return true;
  const rootSymbol = checker.getSymbolAtLocation(root);
  if (rootSymbol?.declarations?.some((declaration) => declaration.getSourceFile().isDeclarationFile || isExternalImportDeclaration(declaration)) || rootSymbol && isDerivedFromExternalImport(rootSymbol, checker)) return true;
  return false;
}
function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  let current: ts.Expression = expression;
  while (true) {
    if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current) || ts.isCallExpression(current) || ts.isNewExpression(current)) current = current.expression;
    else if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) current = current.expression;
    else break;
  }
  return ts.isIdentifier(current) ? current : undefined;
}
function isRouterReceiver(expression: ts.Expression): boolean { const root = rootIdentifier(expression); return Boolean(root && /^(?:app|api|router|routes|server)$/i.test(root.text)); }
function isExternalImportDeclaration(node: ts.Declaration): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) if (ts.isImportDeclaration(current)) return ts.isStringLiteralLike(current.moduleSpecifier) && !current.moduleSpecifier.text.startsWith(".") && !current.moduleSpecifier.text.startsWith("/");
  return false;
}
function isDerivedFromExternalImport(symbol: ts.Symbol, checker: ts.TypeChecker): boolean {
  for (const declaration of symbol.declarations ?? []) {
    let current: ts.Node | undefined = declaration;
    while (current && !ts.isVariableDeclaration(current) && !ts.isSourceFile(current)) current = current.parent;
    if (!current || !ts.isVariableDeclaration(current) || !current.initializer) continue;
    const root = rootIdentifier(current.initializer);
    const source = root ? checker.getSymbolAtLocation(root) : undefined;
    if (source?.declarations?.some(isExternalImportDeclaration)) return true;
  }
  return false;
}
function configurationKey(node: ts.CallExpression): string | undefined { if (!ts.isPropertyAccessExpression(node.expression)) return undefined; if (node.expression.name.text === "getConfiguration" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) return node.arguments[0].text; if (node.expression.name.text === "get" && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && ts.isCallExpression(node.expression.expression)) { const parent = node.expression.expression; if (ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "getConfiguration" && parent.arguments[0] && ts.isStringLiteralLike(parent.arguments[0])) return `${parent.arguments[0].text}.${node.arguments[0].text}`; } return undefined; }
const NON_REPOSITORY_METHODS = new Set(["at", "catch", "charCodeAt", "concat", "endsWith", "every", "filter", "finally", "find", "findIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "join", "lastIndexOf", "localeCompare", "map", "match", "matchAll", "pop", "push", "reduce", "reduceRight", "replace", "replaceAll", "reverse", "shift", "slice", "some", "sort", "splice", "split", "startsWith", "substring", "then", "toISOString", "toLocaleString", "toLowerCase", "toString", "toUpperCase", "trim", "trimEnd", "trimStart", "unshift"]);
const KNOWN_GLOBALS = new Set(["AbortController", "AbortSignal", "Array", "ArrayBuffer", "BigInt", "BigInt64Array", "BigUint64Array", "Boolean", "Buffer", "DataView", "Date", "DOMException", "Error", "EvalError", "Float32Array", "Float64Array", "FormData", "Function", "Infinity", "Int16Array", "Int32Array", "Int8Array", "Intl", "JSON", "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy", "RangeError", "ReferenceError", "Reflect", "RegExp", "Set", "String", "Symbol", "SyntaxError", "TextDecoder", "TextEncoder", "TypeError", "URIError", "URL", "URLSearchParams", "Uint16Array", "Uint32Array", "Uint8Array", "Uint8ClampedArray", "WeakMap", "WeakSet", "WebSocket", "__dirname", "__filename", "atob", "btoa", "clearImmediate", "clearInterval", "clearTimeout", "console", "crypto", "decodeURI", "decodeURIComponent", "describe", "document", "encodeURI", "encodeURIComponent", "escape", "eval", "expect", "exports", "fetch", "global", "globalThis", "isFinite", "isNaN", "it", "jest", "localStorage", "module", "navigator", "parseFloat", "parseInt", "performance", "process", "queueMicrotask", "require", "sessionStorage", "setImmediate", "setInterval", "setTimeout", "structuredClone", "suite", "test", "undefined", "unescape", "vi", "window"]);
