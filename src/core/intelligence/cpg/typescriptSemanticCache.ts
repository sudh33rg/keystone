import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

import type { TypeScriptSemanticResult } from "./typescriptSemantic";

export const TYPESCRIPT_SEMANTIC_CACHE_VERSION = "typescript-semantic-cache-v1";

export interface SemanticCacheFile {
  readonly path: string;
  readonly contentHash: string;
}

export interface TypeScriptSemanticCacheInput {
  readonly sourceFiles: readonly SemanticCacheFile[];
  readonly configFiles: readonly SemanticCacheFile[];
}

interface TypeScriptSemanticCacheEntry {
  readonly version: 1;
  readonly providerVersion: string;
  readonly input: TypeScriptSemanticCacheInput;
  readonly result: TypeScriptSemanticResult;
}

/**
 * Persists compiler-derived TypeScript/JavaScript facts separately from the
 * structural extraction cache. Every input affecting program construction is
 * content-addressed, so a changed source file, ts/js config, or TypeScript
 * runtime version always causes a fresh semantic pass.
 */
export class TypeScriptSemanticCache {
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = path.join(workspaceRoot, ".keystone", "cache", "semantics");
  }

  async read(input: TypeScriptSemanticCacheInput): Promise<TypeScriptSemanticResult | undefined> {
    const normalized = normalizeInput(input);
    try {
      const entry = JSON.parse(await fs.readFile(this.entryPath(normalized), "utf8")) as TypeScriptSemanticCacheEntry;
      if (
        entry.version !== 1 ||
        entry.providerVersion !== providerVersion() ||
        !sameInput(entry.input, normalized)
      )
        return undefined;
      return entry.result;
    } catch {
      return undefined;
    }
  }

  async write(input: TypeScriptSemanticCacheInput, result: TypeScriptSemanticResult): Promise<void> {
    const normalized = normalizeInput(input);
    const target = this.entryPath(normalized);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const entry: TypeScriptSemanticCacheEntry = {
      version: 1,
      providerVersion: providerVersion(),
      input: normalized,
      result
    };
    await fs.mkdir(this.root, { recursive: true });
    try {
      await fs.writeFile(temporary, `${JSON.stringify(entry)}\n`, "utf8");
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private entryPath(input: TypeScriptSemanticCacheInput): string {
    const key = createHash("sha256")
      .update(`${providerVersion()}\0${JSON.stringify(input)}`)
      .digest("hex");
    return path.join(this.root, `${key}.json`);
  }
}

function providerVersion(): string {
  return `${TYPESCRIPT_SEMANTIC_CACHE_VERSION}:typescript-${ts.version}`;
}

function normalizeInput(input: TypeScriptSemanticCacheInput): TypeScriptSemanticCacheInput {
  const normalize = (files: readonly SemanticCacheFile[]): readonly SemanticCacheFile[] =>
    [...files]
      .map((file) => ({ path: file.path.replaceAll("\\", "/"), contentHash: file.contentHash }))
      .sort((left, right) => left.path.localeCompare(right.path));
  return { sourceFiles: normalize(input.sourceFiles), configFiles: normalize(input.configFiles) };
}

function sameInput(left: TypeScriptSemanticCacheInput, right: TypeScriptSemanticCacheInput): boolean {
  return JSON.stringify(normalizeInput(left)) === JSON.stringify(normalizeInput(right));
}
