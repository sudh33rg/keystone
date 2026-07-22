import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { InstructionPreview, InstructionSource } from "../../shared/contracts/executionConfiguration";

const MAX_INSTRUCTION_BYTES = 256 * 1024;
const SUPPORTED_EXTENSIONS = new Set([".md", ".mdx", ".txt"]);
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".git", "dist", "out", "build", "coverage", ".venv", "venv"]);

export class InstructionDiscoveryError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "InstructionDiscoveryError"; }
}

export class InstructionDiscoveryService {
  constructor(private readonly root: string) {}

  async discover(configuredPaths: string[]): Promise<{ sources: InstructionSource[]; diagnostics: Array<{ code: string; message: string }> }> {
    const candidates = new Set<string>();
    for (const path of await this.defaultCandidates()) candidates.add(path);
    for (const path of configuredPaths) candidates.add(normalize(path));
    const sources: InstructionSource[] = []; const diagnostics: Array<{ code: string; message: string }> = [];
    for (const path of [...candidates].sort()) {
      try { sources.push(await this.inspect(path, configuredPaths.includes(path) ? "user-selected" : sourceType(path))); }
      catch (cause) {
        const error = cause instanceof InstructionDiscoveryError ? cause : new InstructionDiscoveryError("instruction-unreadable", cause instanceof Error ? cause.message : String(cause));
        const unavailable = this.unavailable(path, error.code, error.message); sources.push(unavailable); diagnostics.push({ code: error.code, message: error.message });
      }
    }
    return { sources, diagnostics };
  }

  async addExisting(workspaceRelativePath: string): Promise<InstructionSource> {
    const path = this.assertRelative(workspaceRelativePath);
    const source = await this.inspect(path, "user-selected");
    if (source.availability !== "available") throw new InstructionDiscoveryError(source.diagnostic?.code ?? "instruction-unreadable", source.diagnostic?.message ?? "Instruction is unavailable.");
    return source;
  }

  async preview(workspaceRelativePath: string): Promise<InstructionPreview> {
    const source = await this.addExisting(workspaceRelativePath);
    const content = await readFile(resolve(this.root, source.workspaceRelativePath), "utf8");
    if (content.includes("\0")) throw new InstructionDiscoveryError("instruction-format-unsupported", "Binary instruction files are not supported.");
    return { ...source, content };
  }

  private async defaultCandidates(): Promise<string[]> {
    const candidates: string[] = [];
    const exact = [".github/copilot-instructions.md"];
    for (const path of exact) { try { if ((await stat(resolve(this.root, path))).isFile()) candidates.push(path); } catch { /* optional */ } }
    for (const directory of [".github/instructions", ".instructions", ".keystone/instructions"]) candidates.push(...await this.walk(directory));
    return candidates;
  }

  private async walk(directory: string): Promise<string[]> {
    const absolute = resolve(this.root, directory); const result: string[] = [];
    let entries; try { entries = await readdir(absolute, { withFileTypes: true }); } catch { return result; }
    for (const entry of entries) {
      if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
      const path = normalize(`${directory}/${entry.name}`);
      if (entry.isDirectory()) result.push(...await this.walk(path)); else if (entry.isFile() && SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase())) result.push(path);
    }
    return result;
  }

  private async inspect(rawPath: string, type: InstructionSource["sourceType"]): Promise<InstructionSource> {
    const path = this.assertRelative(rawPath); const extension = extname(path).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) throw new InstructionDiscoveryError("instruction-format-unsupported", `${path} is not a supported Markdown or text instruction file.`);
    const absolute = resolve(this.root, path); let metadata;
    try { metadata = await stat(absolute); } catch (cause) { if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") throw new InstructionDiscoveryError("instruction-not-found", `${path} does not exist.`); throw new InstructionDiscoveryError("instruction-unreadable", `${path} could not be read.`); }
    if (!metadata.isFile()) throw new InstructionDiscoveryError("instruction-format-unsupported", `${path} is not a file.`);
    if (metadata.size > MAX_INSTRUCTION_BYTES) throw new InstructionDiscoveryError("instruction-too-large", `${path} exceeds the 256 KiB instruction limit.`);
    let bytes: Buffer; try { bytes = await readFile(absolute); } catch { throw new InstructionDiscoveryError("instruction-unreadable", `${path} could not be read.`); }
    if (bytes.includes(0)) throw new InstructionDiscoveryError("instruction-format-unsupported", `${path} appears to be binary.`);
    return { id: instructionId(path), name: basename(path), workspaceRelativePath: path, uri: pathToFileURL(absolute).toString(), sourceType: type, contentHash: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, modifiedAt: metadata.mtime.toISOString(), availability: "available" };
  }

  private unavailable(path: string, code: string, message: string): InstructionSource {
    const availability = code === "instruction-not-found" ? "missing" : code === "instruction-format-unsupported" || code === "instruction-too-large" ? "unsupported" : "unreadable";
    const normalized = normalize(path); return { id: instructionId(normalized), name: basename(normalized), workspaceRelativePath: normalized, uri: pathToFileURL(resolve(this.root, normalized)).toString(), sourceType: "user-selected", sizeBytes: 0, availability, diagnostic: { code, message } };
  }

  private assertRelative(path: string): string {
    const normalized = normalize(path); const candidate = resolve(this.root, normalized); const rel = relative(resolve(this.root), candidate);
    if (!normalized || rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep) || normalized.split("/").some((part) => EXCLUDED_SEGMENTS.has(part))) throw new InstructionDiscoveryError("instruction-outside-workspace", "Instruction files must be inside the workspace and outside generated or vendor directories.");
    return normalized;
  }
}

function normalize(path: string): string { return path.replaceAll("\\", "/").replace(/^\.\//, ""); }
function instructionId(path: string): string { return `instruction:${createHash("sha256").update(path).digest("hex").slice(0, 32)}`; }
function sourceType(path: string): InstructionSource["sourceType"] { return path.startsWith(".github/") ? "copilot" : path.startsWith(".keystone/") ? "keystone" : "repository"; }
