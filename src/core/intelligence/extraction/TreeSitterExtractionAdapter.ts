/**
 * TreeSitterExtractionAdapter — Phase A polyglot structural extraction.
 *
 * In-process, deterministic, static extraction via `web-tree-sitter` (WASM).
 * No Python runtime, no child process, no server, no LLM. Mirrors the
 * reference `Understand-Anything` `TreeSitterPlugin` design but emits
 * Keystone-shaped `IntelligenceSymbolRecord` + relationships directly.
 *
 * Resilience (spec §3.5 / §4 A.3): a language whose grammar fails to load is
 * recorded as `parseStatus: "unsupported"` and never breaks indexing of other
 * languages. The adapter is inert until `enabled` is set (wired disabled by
 * default in extension.ts).
 *
 * This module is browser/Node safe for typecheck. The WASM grammar packages
 * are dynamically resolved via `createRequire` (Node) and never statically
 * imported, so bundlers do not try to bundle native bindings.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { TreeSitterNode } from "./TreeSitterNode";
import type {
  IntelligenceRelationshipRecord,
  IntelligenceSymbolRecord,
} from "../../../shared/contracts/intelligence";
import { LanguageExtractor } from "./LanguageExtractor";
import { PythonExtractor } from "./extractors/PythonExtractor";
import { GoExtractor } from "./extractors/GoExtractor";
import { RustExtractor } from "./extractors/RustExtractor";
import { JavaExtractor } from "./extractors/JavaExtractor";
import { TypeScriptExtractor } from "./extractors/TypeScriptExtractor";

export interface TreeSitterParseResult {
  available: boolean;
  language: string;
  extractorId: string;
  extractorVersion: string;
  symbols: IntelligenceSymbolRecord[];
  relationships: IntelligenceRelationshipRecord[];
  parseStatus: "parsed" | "partial" | "unsupported";
}

interface LanguageConfig {
  /** Keystone language id (matches FileRecord.language). */
  id: string;
  /** npm grammar package, e.g. "tree-sitter-python". */
  wasmPackage: string;
  /** WASM file inside the package. */
  wasmFile: string;
  /** TSX needs its own grammar key. */
  tsxWasmFile?: string;
}

const PARSER_ID = "keystone.tree-sitter";
const PARSER_VERSION = "1";

/**
 * Grammars pinned to the web-tree-sitter@^0.26 ABI (dylink.0), per the
 * reference implementation. Extend this map to add more languages.
 */
const LANGUAGE_CONFIGS: LanguageConfig[] = [
  { id: "python", wasmPackage: "tree-sitter-python", wasmFile: "tree-sitter-python.wasm" },
  { id: "go", wasmPackage: "tree-sitter-go", wasmFile: "tree-sitter-go.wasm" },
  { id: "rust", wasmPackage: "tree-sitter-rust", wasmFile: "tree-sitter-rust.wasm" },
  { id: "java", wasmPackage: "tree-sitter-java", wasmFile: "tree-sitter-java.wasm" },
  {
    id: "typescript",
    wasmPackage: "tree-sitter-typescript",
    wasmFile: "tree-sitter-typescript.wasm",
    tsxWasmFile: "tree-sitter-tsx.wasm",
  },
  { id: "javascript", wasmPackage: "tree-sitter-javascript", wasmFile: "tree-sitter-javascript.wasm" },
];

export class TreeSitterExtractionAdapter {
  /** When false the adapter is a no-op (default; flip on to activate Phase A). */
  public enabled: boolean;

  private readonly extractors = new Map<string, LanguageExtractor>();
  private readonly configByLang = new Map<string, LanguageConfig>();
  // Lazily resolved grammar modules, keyed by language id; `null` = failed load.
  private readonly grammarByLang = new Map<string, unknown>();
  private readonly requireFn: ((spec: string) => string) | null;
  private wasmInitPromise: Promise<void> | null = null;
  private parserModule: WebTreeSitterModule | null = null;

  constructor(options?: { enabled?: boolean; require?: (spec: string) => string }) {
    this.enabled = options?.enabled ?? false;
    this.requireFn = options?.require ?? safeCreateRequire();
    for (const config of LANGUAGE_CONFIGS) {
      this.configByLang.set(config.id, config);
    }
    this.registerExtractor(new PythonExtractor());
    this.registerExtractor(new GoExtractor());
    this.registerExtractor(new RustExtractor());
    this.registerExtractor(new JavaExtractor());
    this.registerExtractor(new TypeScriptExtractor());
  }

  registerExtractor(extractor: LanguageExtractor): void {
    for (const lang of extractor.languageIds) {
      this.extractors.set(lang, extractor);
    }
  }

  supports(language: string): boolean {
    if (!this.enabled) return false;
    const key = this.normalizeLangKey(language);
    return this.configByLang.has(key) && this.extractors.has(key);
  }

  /**
   * Parse and structurally extract a file's content. Synchronous after the
   * (async) WASM runtime has been initialized. Returns an `available: false`
   * result (parseStatus "unsupported") instead of throwing when the grammar
   * cannot be resolved or the language is unsupported.
   */
  async extractSymbols(
    language: string,
    relativePath: string,
    content: string,
    ids: TreeSitterIdProvider,
  ): Promise<TreeSitterParseResult> {
    const empty: TreeSitterParseResult = {
      available: false,
      language,
      extractorId: PARSER_ID,
      extractorVersion: PARSER_VERSION,
      symbols: [],
      relationships: [],
      parseStatus: "unsupported",
    };
    if (!this.enabled) return empty;
    const key = this.normalizeLangKey(language);
    const config = this.configByLang.get(key);
    const extractor = this.extractors.get(key);
    if (!config || !extractor) return empty;

    try {
      await this.ensureWasmInitialized();
      const grammar = await this.resolveGrammar(key, config);
      if (!grammar) return empty;
      const tree = grammar.parser.parse(content);
      if (!tree) return empty;
      const root = tree.rootNode as TreeSitterNode;
      const structure = extractor.extractStructure(root);
      const callGraph = extractor.extractCallGraph(root);
      tree.delete();

      const symbols = await this.toSymbolRecords(structure.functions, structure.classes, {
        language: key,
        relativePath,
        ids,
      });
      const relationships = await this.toRelationshipRecords(callGraph, structure.imports, {
        language: key,
        relativePath,
        ids,
        symbols,
      });
      return {
        available: true,
        language: key,
        extractorId: PARSER_ID,
        extractorVersion: PARSER_VERSION,
        symbols,
        relationships,
        parseStatus: symbols.length > 0 ? "parsed" : "partial",
      };
    } catch {
      return empty;
    }
  }

  /** Dispose of the cached parser instances (test/teardown safety). */
  dispose(): void {
    this.grammarByLang.clear();
    this.wasmInitPromise = null;
  }

  // ---- internals ----

  private async ensureWasmInitialized(): Promise<void> {
    if (this.wasmInitPromise) return this.wasmInitPromise;
    this.wasmInitPromise = (async () => {
      const mod = await this.importWebTreeSitter();
      this.parserModule = mod;
      await mod.Parser.init();
    })();
    return this.wasmInitPromise;
  }

  private async resolveGrammar(
    key: string,
    config: LanguageConfig,
  ): Promise<{ parser: ParserHandle; lang: unknown } | null> {
    if (this.grammarByLang.has(key)) {
      const lang = this.grammarByLang.get(key);
      if (!lang) return null;
      return { parser: this.makeParser(lang), lang };
    }
    try {
      const mod = await this.importWebTreeSitter();
      const path = this.resolveWasmPath(`${config.wasmPackage}/${config.wasmFile}`);
      const lang = await mod.Language.load(path);
      // Lazy-load the TSX grammar as an alias for .tsx handling.
      if (config.tsxWasmFile) {
        try {
          const tsxPath = this.resolveWasmPath(`${config.wasmPackage}/${config.tsxWasmFile}`);
          this.grammarByLang.set("tsx", await mod.Language.load(tsxPath));
        } catch {
          /* tsx optional */
        }
      }
      this.grammarByLang.set(key, lang);
      return { parser: this.makeParser(lang), lang };
    } catch {
      this.grammarByLang.set(key, null);
      return null;
    }
  }

  private makeParser(lang: unknown): ParserHandle {
    const parser = new this.parserModule!.Parser();
    parser.setLanguage(lang);
    return parser;
  }

  private normalizeLangKey(language: string): string {
    if (language === "tsx" || language === "typescriptreact") return "typescript";
    if (language === "jsx" || language === "javascriptreact") return "javascript";
    return language;
  }

  private async importWebTreeSitter(): Promise<WebTreeSitterModule> {
    if (this.parserModule) return this.parserModule;
    const mod = (await import("web-tree-sitter")) as unknown as WebTreeSitterModule;
    this.parserModule = mod;
    return mod;
  }

  private resolveWasmPath(spec: string): string {
    // ESM-native resolution (works under vitest's node environment and plain
    // Node 22+). Falls back to createRequire for older/CJS hosts. Convert any
    // file:// URL to a plain path because web-tree-sitter's Language.load needs
    // a filesystem path, not a URL.
    try {
      const resolved = (import.meta as unknown as { resolve(spec: string): string }).resolve(spec);
      return toFsPath(resolved);
    } catch {
      if (this.requireFn) return this.requireFn(spec);
      throw new Error(`Cannot resolve WASM grammar module: ${spec}`);
    }
  }

  // ---- record mapping ----

  private async toSymbolRecords(
    functions: ReadonlyArray<{ name: string; lineRange: [number, number]; params: string[]; returnType?: string }>,
    classes: ReadonlyArray<{ name: string; lineRange: [number, number]; methods: string[]; properties: string[] }>,
    ctx: { language: string; relativePath: string; ids: TreeSitterIdProvider },
  ): Promise<IntelligenceSymbolRecord[]> {
    const symbols: IntelligenceSymbolRecord[] = [];
    for (const fn of functions) {
      const id = await ctx.ids.entity(ctx.language, fn.name, `fn:${fn.lineRange[0]}`);
      symbols.push({
        id,
        repositoryId: ctx.ids.repositoryId,
        fileId: ctx.ids.fileId,
        ownerFileId: ctx.ids.fileId,
        type: "keystone.core.Function",
        name: fn.name,
        qualifiedName: fn.name,
        language: ctx.language,
        range: { startLine: fn.lineRange[0], startColumn: 0, endLine: fn.lineRange[1], endColumn: 0 },
        evidenceIds: [await ctx.ids.evidence(id, ctx.relativePath, fn.lineRange[0])],
        confidence: 1,
        generation: ctx.ids.generation,
        ...(fn.params.length > 0 ? { parameters: fn.params.map((p) => ({ name: p })) } : {}),
        ...(fn.returnType ? { returnType: fn.returnType } : {}),
      });
    }
    for (const cls of classes) {
      const id = await ctx.ids.entity(ctx.language, cls.name, `class:${cls.lineRange[0]}`);
      symbols.push({
        id,
        repositoryId: ctx.ids.repositoryId,
        fileId: ctx.ids.fileId,
        ownerFileId: ctx.ids.fileId,
        type: "keystone.core.Class",
        name: cls.name,
        qualifiedName: cls.name,
        language: ctx.language,
        range: { startLine: cls.lineRange[0], startColumn: 0, endLine: cls.lineRange[1], endColumn: 0 },
        evidenceIds: [await ctx.ids.evidence(id, ctx.relativePath, cls.lineRange[0])],
        confidence: 1,
        generation: ctx.ids.generation,
        ...(cls.properties.length > 0
          ? { properties: { fields: cls.properties } }
          : {}),
      });
    }
    return symbols;
  }

  private async toRelationshipRecords(
    callGraph: ReadonlyArray<{ caller: string; callee: string; lineNumber: number }>,
    imports: ReadonlyArray<{ source: string; specifiers: string[]; lineNumber: number }>,
    ctx: { language: string; relativePath: string; ids: TreeSitterIdProvider; symbols: IntelligenceSymbolRecord[] },
  ): Promise<IntelligenceRelationshipRecord[]> {
    const relationships: IntelligenceRelationshipRecord[] = [];
    const byName = new Map(ctx.symbols.map((s) => [s.name, s.id]));
    for (const call of callGraph) {
      const sourceId = byName.get(call.caller);
      if (!sourceId) continue; // caller not a top-level extracted symbol
      // Callee resolves to a real symbol when known; otherwise the call is
      // recorded as intra-file (target = the file) so both endpoints are valid.
      const targetId = byName.get(call.callee) ?? ctx.ids.fileId;
      relationships.push({
        id: await ctx.ids.relationship(sourceId, targetId, "keystone.core.CALLS", `${call.lineNumber}`),
        repositoryId: ctx.ids.repositoryId,
        sourceId,
        targetId,
        type: "keystone.core.CALLS",
        ownerFileId: ctx.ids.fileId,
        targetFileId: ctx.ids.fileId,
        resolution: "syntactic",
        evidenceIds: [await ctx.ids.evidence(targetId, ctx.relativePath, call.lineNumber)],
        derivation: "extracted",
        confidence: 1,
        generation: ctx.ids.generation,
      });
    }
    for (const imp of imports) {
      // Imports are recorded as a file-level fact: source = file, target = file
      // (the imported module is external). Both endpoints resolve to the file.
      const sourceId = ctx.ids.fileId;
      const targetId = ctx.ids.fileId;
      relationships.push({
        id: await ctx.ids.relationship(
          sourceId,
          targetId,
          "keystone.core.IMPORTS",
          `${imp.lineNumber}`,
        ),
        repositoryId: ctx.ids.repositoryId,
        sourceId,
        targetId,
        type: "keystone.core.IMPORTS",
        ownerFileId: ctx.ids.fileId,
        targetFileId: ctx.ids.fileId,
        resolution: "syntactic",
        evidenceIds: [await ctx.ids.evidence(targetId, ctx.relativePath, imp.lineNumber)],
        derivation: "extracted",
        confidence: 1,
        generation: ctx.ids.generation,
      });
    }
    return relationships;
  }
}

export interface TreeSitterIdProvider {
  repositoryId: string;
  fileId: string;
  generation: number;
  entity(language: string, name: string, discriminator: string): Promise<string>;
  relationship(sourceId: string, targetId: string, type: string, discriminator: string): Promise<string>;
  evidence(subjectId: string, relativePath: string, line: number): Promise<string>;
}

// --- Type aliases for the web-tree-sitter WASM runtime (loaded at runtime) ---

interface ParserHandle {
  setLanguage(lang: unknown): void;
  parse(content: string): { rootNode: unknown; delete(): void };
}

interface WebTreeSitterModule {
  Parser: {
    init(options?: unknown): Promise<void>;
    new (): ParserHandle;
  };
  Language: { load(input: string): Promise<unknown> };
}

function safeCreateRequire(): ((spec: string) => string) | null {
  try {
    return createRequire(import.meta.url);
  } catch {
    return null;
  }
}

function toFsPath(value: string): string {
  if (value.startsWith("file://")) {
    return fileURLToPath(value);
  }
  return value;
}
