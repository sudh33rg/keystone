import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

import { IGNORED_DIRECTORIES } from "../../platform/config/defaults";
import { LANGUAGE_DEFINITIONS, LanguageCapabilityRegistry } from "../languages/languageRegistry";

export interface ScannedFile {
  path: string;
  absolutePath: string;
  sizeBytes: number;
  modifiedTimeMs: number;
}

export interface FileScanProgress {
  discoveredFiles: number;
  currentPath: string;
}

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
]);
const registry = new LanguageCapabilityRegistry();
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

/**
 * Discover every supported source artifact in the workspace.
 *
 * There is deliberately no file-count or file-size cap. Discovery yields to the
 * event loop in bounded batches, honours cancellation, skips only explicitly
 * ignored/generated/vendor directories, and tolerates files that disappear or
 * become unreadable while the repository is changing.
 */
export async function scanFiles(
  workspaceRoot: string,
  signal?: AbortSignal,
  onProgress?: (progress: FileScanProgress) => void
): Promise<ScannedFile[]> {
  const files: ScannedFile[] = [];
  const pending = [workspaceRoot];
  let visitedEntries = 0;

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
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(path.join(directory, entry.name));
      } else if (entry.isFile()) {
        fileEntries.push(entry);
      }
    }

    for (let offset = 0; offset < fileEntries.length; offset += INSPECTION_CONCURRENCY) {
      signal?.throwIfAborted();
      const batch = fileEntries.slice(offset, offset + INSPECTION_CONCURRENCY);
      const inspected = await Promise.all(
        batch.map((entry) => inspectFile(workspaceRoot, directory, entry.name, signal))
      );
      for (const file of inspected) {
        if (!file) continue;
        files.push(file);
        onProgress?.({ discoveredFiles: files.length, currentPath: file.path });
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
  signal?: AbortSignal
): Promise<ScannedFile | undefined> {
  signal?.throwIfAborted();
  const absolutePath = path.join(directory, name);
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
  return { path: relativePath, absolutePath, sizeBytes: stat.size, modifiedTimeMs: stat.mtimeMs };
}

export function languageForPath(filePath: string): string {
  const identified = registry.identify(filePath);
  if (identified) return identified.id;
  const name = path.basename(filePath).toLowerCase();
  if (name === "dockerfile") return "dockerfile";
  if (name === "makefile" || name === "cmakelists.txt" || name === "justfile") return "build";
  if (name === "pom.xml" || name.startsWith("build.gradle")) return "build";
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
