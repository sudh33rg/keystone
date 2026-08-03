import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { IGNORED_DIRECTORIES } from "../../platform/config/defaults";
import { LANGUAGE_DEFINITIONS, LanguageCapabilityRegistry } from "../languages/languageRegistry";
import { loadGitignore } from "./gitignore";

export interface ScannedFile {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedTimeMs: number;
}

export interface FileScanProgress {
  discoveredFiles: number;
  skippedFiles: number;
  currentPath: string;
}

export const DEFAULT_MAX_FILE_SIZE_BYTES = 3 * 1024 * 1024;

const SOURCE_EXTENSIONS = new Set(
  LANGUAGE_DEFINITIONS.flatMap((definition) => [...definition.extensions])
);
const SPECIAL_SOURCE_FILES = new Set([
  "dockerfile",
  "makefile",
  "cmakelists.txt",
  "build.gradle",
  "build.gradle.kts",
  "pom.xml",
  "workspace",
  "build",
  "justfile"
  ,"package.json", "tsconfig.json", "jsconfig.json", "nx.json", "turbo.json", "go.mod", "go.work",
  "cargo.toml", "pyproject.toml", "requirements.txt", "pipfile", "setup.py", "setup.cfg", "global.json",
  "directory.build.props", "directory.build.targets", "directory.packages.props"
]);
const registry = new LanguageCapabilityRegistry();
const IGNORED_DIRECTORY_NAMES = new Set(
  [...IGNORED_DIRECTORIES].map((directory) => directory.toLowerCase())
);
const YIELD_INTERVAL = 250;
const INSPECTION_CONCURRENCY = 64;
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".rar",
  ".jar",
  ".class",
  ".dll",
  ".exe",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".bin",
  ".db",
  ".sqlite",
  ".lockb"
]);

// These artifacts can be text and therefore pass the binary/text check, but do
// not provide useful repository structure. Keep this policy at discovery time
// so they never reach language analysis, semantic enrichment, or persistence.
const IGNORED_FILE_NAMES = new Set([
  ".ds_store",
  "bun.lockb"
]);

const IGNORED_FILE_PATTERNS = [
  // Bundler output is often very large, opaque, and duplicated by its source.
  /\.min\.(?:css|scss|sass|less|js|jsx|mjs|cjs)$/i,
  /(?:^|[._~-])vendors?(?:[._~-]|$)/i,
  // Source maps contain generated mappings rather than source structure.
  /\.map$/i
];

/**
 * Discover every supported source artifact in the workspace.
 *
 * Discovery yields to the event loop in bounded batches, honours cancellation,
 * skips explicitly ignored directories and generated/dependency artifacts, and
 * tolerates files that disappear or become unreadable while the repository is
 * changing. Files larger than the configured limit are skipped before ingestion.
 */
export async function scanFiles(
  workspaceRoot: string,
  signal?: AbortSignal,
  onProgress?: (progress: FileScanProgress) => void,
  maxFileSizeBytes = DEFAULT_MAX_FILE_SIZE_BYTES
): Promise<ScannedFile[]> {
  const fileSizeLimit = normalizeMaxFileSizeBytes(maxFileSizeBytes);
  const files: ScannedFile[] = [];
  const gitignore = await loadGitignore(workspaceRoot);
  const pending = [workspaceRoot];
  let visitedEntries = 0;
  let skippedFiles = 0;

  while (pending.length > 0) {
    signal?.throwIfAborted();
    const directory = pending.pop()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => {
      if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return [];
      throw error;
    });

    const fileEntries: Dirent[] = [];
    for (const entry of entries) {
      signal?.throwIfAborted();
      visitedEntries += 1;
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (
          !IGNORED_DIRECTORY_NAMES.has(entry.name.toLowerCase()) &&
          !gitignore.isIgnored(relativePath, true)
        )
          pending.push(absolutePath);
      } else if (entry.isFile()) {
        if (!gitignore.isIgnored(relativePath, false)) fileEntries.push(entry);
      }
    }

    for (let offset = 0; offset < fileEntries.length; offset += INSPECTION_CONCURRENCY) {
      signal?.throwIfAborted();
      const batch = fileEntries.slice(offset, offset + INSPECTION_CONCURRENCY);
      const inspected = await Promise.all(
        batch.map((entry) =>
          inspectFile(workspaceRoot, directory, entry.name, signal, fileSizeLimit)
        )
      );
      for (const result of inspected) {
        if (result && "skippedForSize" in result) {
          skippedFiles += 1;
          onProgress?.({
            discoveredFiles: files.length,
            skippedFiles,
            currentPath: result.path
          });
          continue;
        }
        const file = result && "file" in result ? result.file : undefined;
        if (!file) continue;
        files.push(file);
        onProgress?.({ discoveredFiles: files.length, skippedFiles, currentPath: file.path });
      }
      if (visitedEntries % YIELD_INTERVAL < batch.length)
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

async function inspectFile(
  workspaceRoot: string,
  directory: string,
  name: string,
  signal: AbortSignal | undefined,
  maxFileSizeBytes: number
): Promise<{ file: ScannedFile } | { path: string; skippedForSize: true } | undefined> {
  signal?.throwIfAborted();
  const absolutePath = path.join(directory, name);
  if (isIgnoredFile(name)) return undefined;
  const extension = path.extname(name).toLowerCase();
  if (BINARY_EXTENSIONS.has(extension)) return undefined;
  const registered =
    SOURCE_EXTENSIONS.has(extension) || SPECIAL_SOURCE_FILES.has(name.toLowerCase());
  const [stat, text] = await Promise.all([
    fs.stat(absolutePath).catch((error) => {
      if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return undefined;
      throw error;
    }),
    registered ? Promise.resolve(true) : isProbablyText(absolutePath)
  ]);
  signal?.throwIfAborted();
  if (!stat || !text) return undefined;
  const relativePath = path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
  if (stat.size > maxFileSizeBytes) return { path: relativePath, skippedForSize: true };
  return {
    file: { path: relativePath, absolutePath, sizeBytes: stat.size, modifiedTimeMs: stat.mtimeMs }
  };
}

export function normalizeMaxFileSizeBytes(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_MAX_FILE_SIZE_BYTES;
}

/** Return whether a text-looking file is an ingestion artifact rather than source. */
export function isIgnoredFile(fileName: string): boolean {
  const name = path.basename(fileName).toLowerCase();
  return (
    IGNORED_FILE_NAMES.has(name) || IGNORED_FILE_PATTERNS.some((pattern) => pattern.test(name))
  );
}

export function languageForPath(filePath: string): string {
  const identified = registry.identify(filePath);
  if (identified) return identified.id;
  const name = path.basename(filePath).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile" || name === "cmakelists.txt" || name === "justfile") return "build";
  if (name === "pom.xml" || name.startsWith("build.gradle")) return "build";
  if (/^(?:package\.json|tsconfig(?:\..+)?\.json|jsconfig\.json|nx\.json|turbo\.json)$/.test(name)) return "json";
  if (/^(?:go\.mod|go\.work|cargo\.toml|pyproject\.toml|pipfile|requirements\.txt|setup\.cfg)$/.test(name)) return "toml";
  if (/\.(?:sln|csproj|vbproj|props|targets)$/i.test(name)) return "xml";
  return "unknown";
}

async function isProbablyText(filePath: string): Promise<boolean> {
  try {
    const handle = await fs.open(filePath, "r");
    try {
      const buffer = Buffer.allocUnsafe(8192);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead === 0) return true;
      let suspicious = 0;
      for (let i = 0; i < bytesRead; i++) {
        const byte = buffer[i];
        if (byte === 0) return false;
        if (byte < 7 || (byte > 13 && byte < 32)) suspicious += 1;
      }
      return suspicious / bytesRead < 0.08;
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
      return false;
    throw error;
  }
}
