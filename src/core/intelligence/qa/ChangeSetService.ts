/**
 * ChangeSetService + ChangedSymbolResolver (spec §5, §6, §7).
 *
 * Deterministic change-set construction from many sources. Does NOT require Git:
 * source-control details are optional and manual/planned scopes are first-class.
 * Classifies files into production/test/configuration/documentation/generated/unknown
 * and maps file changes to repository intelligence symbols where available.
 */
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";
import type {
  ChangeSet,
  ChangedFile,
  ChangedSymbol,
  ChangeSource,
  ChangeType,
  FileClassification,
} from "../../../shared/contracts/qaLifecycle";
import { createHash } from "node:crypto";

export interface RawChangeInput {
  source: ChangeSource;
  workflowId?: string;
  files: RawChangedFile[];
  base?: string;
  head?: string;
  workspaceSnapshot?: string;
}

export interface RawChangedFile {
  path: string;
  oldPath?: string;
  changeType: ChangeType;
  addedLines?: number;
  removedLines?: number;
  modifiedRanges?: Array<{ start: number; end: number }>;
}

const TEST_RE =
  /(^|[\\/])(__tests__|tests?|spec|e2e|integration|\.test|\.spec|jest|vitest|cypress|playwright)[\\/.]?/i;
const GENERATED_RE =
  /(^|[\\/])(node_modules|dist|build|out|coverage|generated|\.next|\.cache|\.turbo)[\\/]/i;
const CONFIG_RE =
  /(^|[\\/])(config|configuration|settings|env|\.github|\.vscode)[\\/]|(^|[\\/])(tsconfig|package|vite|webpack|rollup|babel|eslint|prettier|jest|vitest|cypress|playwright)\.[a-z]+$/i;
const DOCS_RE = /\.(md|markdown|txt|rst|adoc)$/i;
const VENDOR_RE = /[\\/](vendor|third_party|thirdparty)[\\/]/i;

export class ChangeSetService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  /** Build a canonical ChangeSet from raw inputs (any source). */
  build(input: RawChangeInput): ChangeSet {
    const warnings: string[] = [];
    const files: ChangedFile[] = input.files.map((f) => this.classifyFile(f, warnings));
    const symbols = this.resolveSymbols(files, warnings);
    const partial = files.some(
      (f) =>
        f.changedSymbolIds.length === 0 &&
        f.changeType !== "added" &&
        f.changeType !== "untracked" &&
        f.changeType !== "planned",
    );
    return {
      id: crypto.randomUUID(),
      workflowId: input.workflowId,
      source: input.source,
      files,
      symbols,
      revision: { base: input.base, head: input.head, workspaceSnapshot: input.workspaceSnapshot },
      metadata: {
        createdAt: new Date().toISOString(),
        contentHash: this.hash(input, files),
        partial,
        warnings,
      },
    };
  }

  private classifyFile(f: RawChangedFile, warnings: string[]): ChangedFile {
    const classification = classifyPath(f.path);
    const known = this.snapshot.files.find((file) => file.relativePath === f.path);
    const intelligenceAvailable = Boolean(known);
    const parserSupported = known ? known.parseStatus === "parsed" : false;
    if (
      f.changeType !== "added" &&
      f.changeType !== "untracked" &&
      f.changeType !== "planned" &&
      !intelligenceAvailable &&
      classification === "production"
    ) {
      warnings.push(
        `No repository intelligence for ${f.path}; impact will use file-level fallback.`,
      );
    }
    return {
      path: f.path,
      oldPath: f.oldPath,
      changeType: f.changeType,
      classification,
      addedLines: f.addedLines ?? 0,
      removedLines: f.removedLines ?? 0,
      modifiedRanges: f.modifiedRanges ?? [],
      parserSupported,
      intelligenceAvailable,
      changedSymbolIds: [],
      unresolvedRangeWarnings: [],
    };
  }

  private resolveSymbols(files: ChangedFile[], warnings: string[]): ChangedSymbol[] {
    const out: ChangedSymbol[] = [];
    for (const file of files) {
      const fileRec = this.snapshot.files.find((f) => f.relativePath === file.path);
      if (!fileRec) {
        if (
          file.changeType !== "added" &&
          file.changeType !== "untracked" &&
          file.changeType !== "planned"
        ) {
          warnings.push(`Cannot resolve symbols for ${file.path}: file not in intelligence.`);
        }
        continue;
      }
      const syms = this.snapshot.symbols.filter((s) => s.fileId === fileRec.id);
      if (syms.length === 0) {
        warnings.push(`No symbols parsed for ${file.path}; symbol-level precision unavailable.`);
        continue;
      }
      for (const sym of syms) {
        const inRange =
          file.modifiedRanges.length === 0 ||
          file.modifiedRanges.some((r) => overlap(r, sym.range));
        if (!inRange && file.changeType !== "deleted" && file.changeType !== "renamed") continue;
        out.push({
          symbolId: sym.id,
          filePath: file.path,
          kind: sym.type,
          changeType: file.changeType,
          changedRange: { start: sym.range.startLine, end: sym.range.endLine },
          isPublicContract: isPublicContract(sym, this.snapshot),
          isEntryPoint: isEntryPoint(sym, this.snapshot),
          isPersistence: isPersistence(sym, this.snapshot),
          isTest: file.classification === "test",
          confidence: sym.confidence,
          evidence: sym.evidenceIds.map((id) => ({
            id,
            kind: "symbol",
            statement: `Symbol ${sym.name} in ${file.path}`,
          })),
        });
      }
    }
    return out;
  }

  private hash(input: RawChangeInput, files: ChangedFile[]): string {
    const raw = JSON.stringify({
      s: input.source,
      f: files.map((f) => [f.path, f.changeType, f.changedSymbolIds.length]),
    });
    return createHash("sha256").update(raw).digest("hex").slice(0, 32);
  }
}

export function classifyPath(path: string): FileClassification {
  if (DOCS_RE.test(path)) return "documentation";
  if (GENERATED_RE.test(path) || VENDOR_RE.test(path)) return "generated";
  if (TEST_RE.test(path)) return "test";
  if (CONFIG_RE.test(path)) return "configuration";
  return "production";
}

function overlap(
  r: { start: number; end: number },
  range: { startLine: number; endLine: number },
): boolean {
  return !(r.end < range.startLine || r.start > range.endLine);
}

function isPublicContract(
  sym: {
    visibility?: string;
    exported?: boolean;
    type: string;
    properties?: Record<string, unknown>;
  },
  snapshot: IntelligenceSnapshot,
): boolean {
  if (sym.visibility === "public" || sym.exported) return true;
  if (/(interface|class|enum)/i.test(sym.type)) return true;
  if (sym.properties && sym.properties["isRoute"] === true) return true;
  void snapshot;
  return false;
}

function isEntryPoint(
  sym: { properties?: Record<string, unknown> },
  _snapshot: IntelligenceSnapshot,
): boolean {
  const p = sym.properties;
  return p?.["isEntryPoint"] === true || p?.["isRoute"] === true || p?.["isEventHandler"] === true;
}

function isPersistence(
  sym: { properties?: Record<string, unknown> },
  _snapshot: IntelligenceSnapshot,
): boolean {
  const p = sym.properties;
  const kind = p?.["kind"];
  const kindStr = typeof kind === "string" ? kind : "";
  return p?.["isPersistence"] === true || /(repository|dao|entity|schema|migration)/i.test(kindStr);
}
