import fs from "node:fs/promises";
import path from "node:path";
import type { RepoSkill } from "../domain/types";

export interface CopilotCustomizationInventory {
  agents: Array<{ id: string; name: string; path: string; description: string }>;
  skills: RepoSkill[];
  instructions: Array<{ id: string; path: string; description: string; guidance: string[] }>;
}

export const KEYSTONE_INSTRUCTIONS_START = "<!-- BEGIN KEYSTONE MANAGED INSTRUCTIONS -->";
export const KEYSTONE_INSTRUCTIONS_END = "<!-- END KEYSTONE MANAGED INSTRUCTIONS -->";

const KEYSTONE_MANAGED_INSTRUCTIONS = [
  KEYSTONE_INSTRUCTIONS_START,
  "Use the Keystone ContextPackage as the bounded source of truth for repository-specific facts.",
  "Prefer targeted Keystone retrieval over broad repository rediscovery when the package is insufficient.",
  "Treat source-backed context as current only when its provenance and source freshness are confirmed.",
  "Keep the active Intent, explicit constraints, accepted decisions, and validation evidence visible in the result.",
  KEYSTONE_INSTRUCTIONS_END
].join("\n");

/** Updates only Keystone's marked block and preserves all user-authored instructions byte-for-byte. */
export async function ensureManagedCopilotInstructions(
  workspaceRoot: string
): Promise<{ path: string; changed: boolean }> {
  const relativePath = ".github/copilot-instructions.md";
  const target = path.join(workspaceRoot, relativePath);
  const existing = await fs.readFile(target, "utf8").catch(() => undefined);
  if (existing === undefined) return { path: relativePath, changed: false };
  const blockPattern = new RegExp(
    `${escapeRegExp(KEYSTONE_INSTRUCTIONS_START)}[\\s\\S]*?${escapeRegExp(KEYSTONE_INSTRUCTIONS_END)}`,
    "m"
  );
  const merged = blockPattern.test(existing)
    ? existing.replace(blockPattern, KEYSTONE_MANAGED_INSTRUCTIONS)
    : existing.trimEnd()
      ? `${existing.trimEnd()}\n\n${KEYSTONE_MANAGED_INSTRUCTIONS}\n`
      : `${KEYSTONE_MANAGED_INSTRUCTIONS}\n`;
  if (merged === existing) return { path: relativePath, changed: false };
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, merged, "utf8");
  return { path: relativePath, changed: true };
}

export async function discoverCopilotCustomizations(
  workspaceRoot: string
): Promise<CopilotCustomizationInventory> {
  const agents: CopilotCustomizationInventory["agents"] = [];
  const skills: RepoSkill[] = [];
  const instructions: CopilotCustomizationInventory["instructions"] = [];
  const now = new Date().toISOString();
  for (const candidate of await findFiles(workspaceRoot)) {
    const relative = path.relative(workspaceRoot, candidate).replaceAll(path.sep, "/");
    const content = await fs.readFile(candidate, "utf8").catch(() => "");
    if (!content.trim()) continue;
    const summary = firstMeaningfulLine(content);
    if (/\.agent\.md$/i.test(candidate)) {
      agents.push({
        id: stableId(relative),
        name: path.basename(candidate).replace(/\.agent\.md$/i, ""),
        path: relative,
        description: summary
      });
    } else if (/SKILL\.md$/i.test(candidate)) {
      skills.push({
        id: stableId(relative),
        name: path.basename(path.dirname(candidate)),
        description: summary,
        appliesToFiles: frontmatterList(content, "applyTo"),
        appliesToKeywords: keywords(content),
        guidance: guidance(content),
        version: 1,
        confidence: 1,
        updatedAt: now
      });
    } else if (
      /\.instructions\.md$/i.test(candidate) ||
      /(?:^|\/)AGENTS\.md$/i.test(relative) ||
      /(?:^|\/)copilot-instructions\.md$/i.test(relative)
    ) {
      instructions.push({
        id: stableId(relative),
        path: relative,
        description: summary,
        guidance: guidance(content)
      });
    }
  }
  return { agents, skills, instructions };
}

async function findFiles(root: string): Promise<string[]> {
  const starts = [
    path.join(root, ".github", "agents"),
    path.join(root, ".github", "skills"),
    path.join(root, ".github", "instructions"),
    path.join(root, ".github", "copilot-instructions.md"),
    path.join(root, "AGENTS.md")
  ];
  const files: string[] = [];
  for (const candidate of starts) {
    const stat = await fs.stat(candidate).catch(() => undefined);
    if (!stat) continue;
    if (stat.isFile()) files.push(candidate);
    else await walk(candidate, files);
  }
  return files.sort();
}
async function walk(dir: string, files: string[]): Promise<void> {
  for (const entry of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, files);
    else if (/\.md$/i.test(entry.name)) files.push(full);
  }
}
function firstMeaningfulLine(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.replace(/^#+\s*/, "").trim())
      .find((line) => line && line !== "---" && !/^\w+:/.test(line)) ??
    "Repository-provided Copilot customization."
  );
}
function guidance(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .slice(0, 30);
}
function keywords(content: string): string[] {
  return [
    ...new Set(
      (content.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter(
        (word) => !["with", "from", "that", "this", "should", "must"].includes(word)
      )
    )
  ].slice(0, 20);
}
function frontmatterList(content: string, key: string): string[] {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, "mi"));
  return match
    ? match[1]
        .replace(/[\[\]"']/g, "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : [];
}
function stableId(value: string): string {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `repo-${(hash >>> 0).toString(16)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\[\]\\]/g, "\\$&");
}
