import ts from "typescript";
import type {
  AdapterCapability,
  AdapterDetection,
  AdapterDiagnostic,
  AdapterOutput
} from "../../../shared/contracts/adapters";
import type { IntelligenceEvidenceRecord, IntelligenceRelationshipRecord, IntelligenceSymbolRecord, SourceRange } from "../../../shared/contracts/intelligence";
import type { SemanticSourceFileInput } from "../semantic/SemanticModel";
import { AdapterEvidenceFactory } from "./AdapterEvidenceFactory";
import type { AdapterInput, IntelligenceAdapter } from "./IntelligenceAdapter";

export abstract class DeterministicAdapter implements IntelligenceAdapter {
  abstract readonly id: string;
  abstract readonly version: string;
  abstract capability(): AdapterCapability;
  abstract detect(files: readonly SemanticSourceFileInput[]): AdapterDetection[];
  protected abstract extract(files: readonly SemanticSourceFileInput[], output: AdapterOutputBuilder): void;

  analyze(input: AdapterInput): Promise<AdapterOutput> {
    const started = performance.now();
    const selected = new Set(input.context.detections.filter((item) => item.adapterId === this.id).flatMap((item) => item.fileIds));
    const files = input.files.filter((file) => selected.has(file.fileId));
    const output = new AdapterOutputBuilder(this.id, this.version, input, files);
    try { this.extract(files, output); }
    catch (cause) { output.diagnostic("adapter-failure", "error", cause instanceof Error ? cause.message : String(cause)); }
    return Promise.resolve(output.finish(performance.now() - started));
  }
}

export class AdapterOutputBuilder {
  readonly entities = new Map<string, IntelligenceSymbolRecord>();
  readonly relationships = new Map<string, IntelligenceRelationshipRecord>();
  readonly evidence = new Map<string, IntelligenceEvidenceRecord>();
  readonly diagnostics: AdapterDiagnostic[] = [];
  readonly factory: AdapterEvidenceFactory;
  failedFiles = 0;
  unsupported = 0;
  crossLinks = 0;

  constructor(readonly adapterId: string, readonly adapterVersion: string, readonly input: AdapterInput, readonly files: readonly SemanticSourceFileInput[]) {
    this.factory = new AdapterEvidenceFactory(adapterId, adapterVersion, input.context);
  }

  entity(file: SemanticSourceFileInput, type: string, name: string, qualifiedName: string, range: SourceRange, properties?: IntelligenceSymbolRecord["properties"], confidence = 1): IntelligenceSymbolRecord {
    const value = this.factory.entity(file, type, name, qualifiedName, range, properties, confidence);
    this.entities.set(value.entity.id, value.entity); this.evidence.set(value.evidence.id, value.evidence); return value.entity;
  }

  relationship(source: IntelligenceSymbolRecord, target: IntelligenceSymbolRecord, type: string, owner: SemanticSourceFileInput, range: SourceRange, options?: Parameters<AdapterEvidenceFactory["relationship"]>[5]): IntelligenceRelationshipRecord {
    const value = this.factory.relationship(source, target, type, owner, range, options);
    this.relationships.set(value.relationship.id, value.relationship); for (const evidence of value.evidence) this.evidence.set(evidence.id, evidence);
    if (options?.derivation === "calculated") this.crossLinks += 1;
    return value.relationship;
  }

  diagnostic(code: string, severity: AdapterDiagnostic["severity"], message: string, file?: SemanticSourceFileInput, range?: SourceRange, extras: Pick<AdapterDiagnostic, "technologyId" | "limitation" | "ambiguity"> = {}): void {
    this.diagnostics.push({ code, severity, message, adapterId: this.adapterId, ...(file ? { workspaceRootId: file.workspaceRootId, relativePath: file.relativePath, ownerFileId: file.fileId } : {}), ...(range ? { range } : {}), ...extras });
  }

  finish(executionTimeMs: number): AdapterOutput {
    return {
      adapterId: this.adapterId, adapterVersion: this.adapterVersion,
      sourceContentHashes: Object.fromEntries(this.files.map((file) => [file.fileId, file.contentHash])),
      jobRevision: this.input.context.jobRevision, generationCompatibility: this.input.context.generation,
      detections: this.input.context.detections.filter((item) => item.adapterId === this.adapterId),
      entities: [...this.entities.values()], relationships: [...this.relationships.values()], evidence: [...this.evidence.values()], diagnostics: this.diagnostics,
      exclusions: [], invalidations: this.files.map((file) => file.fileId), indexUpdates: [], okfProjectionHints: [],
      metrics: { adapterId: this.adapterId, executionTimeMs, filesConsidered: this.files.length, filesParsed: Math.max(0, this.files.length - this.failedFiles), filesFailed: this.failedFiles, cacheReused: 0, entitiesExtracted: this.entities.size, relationshipsResolved: this.relationships.size, crossLinksResolved: this.crossLinks, unsupportedFiles: this.unsupported, memoryWarning: false }
    };
  }
}

export function detection(adapterId: string, technologyId: string, level: AdapterDetection["capabilityLevel"], files: readonly SemanticSourceFileInput[], kind: AdapterDetection["evidence"][number]["kind"], statement: string, confidence = 1, unsupportedFeatures: string[] = []): AdapterDetection {
  return { technologyId, confidence, adapterId, capabilityLevel: level, evidence: files.slice(0, 20).map((file) => ({ kind, relativePath: file.relativePath, statement })), conflicts: [], unsupportedFeatures, fileIds: files.map((file) => file.fileId) };
}

export function matches(path: string, expressions: readonly RegExp[]): boolean { return expressions.some((expression) => expression.test(path)); }
export function importsModule(file: SemanticSourceFileInput, modules: readonly string[]): boolean {
  if (!["typescript", "typescriptreact", "javascript", "javascriptreact"].includes(file.language)) return false;
  const source = ts.createSourceFile(file.relativePath, file.content, ts.ScriptTarget.Latest, false, scriptKind(file.language));
  const matchesModule = (value: string): boolean => modules.some((module) => value === module || value.startsWith(`${module}/`));
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier) && matchesModule(node.moduleSpecifier.text)) found = true;
    else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && node.moduleReference.expression && ts.isStringLiteralLike(node.moduleReference.expression) && matchesModule(node.moduleReference.expression.text)) found = true;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require")) && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && matchesModule(node.arguments[0].text)) found = true;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}
export function lines(content: string): Array<{ text: string; start: number; end: number }> {
  const result = []; let offset = 0;
  for (const text of content.split(/\n/)) { result.push({ text, start: offset, end: offset + text.length }); offset += text.length + 1; }
  return result;
}
function scriptKind(language: string): ts.ScriptKind { return language === "typescriptreact" ? ts.ScriptKind.TSX : language === "javascriptreact" ? ts.ScriptKind.JSX : language === "javascript" ? ts.ScriptKind.JS : ts.ScriptKind.TS; }
