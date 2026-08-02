import fs from "node:fs/promises";
import path from "node:path";
import type { RepoSkill } from "../domain/types";

export interface CopilotCustomizationInventory {
  agents: Array<{ id: string; name: string; path: string; description: string }>;
  skills: RepoSkill[];
  instructions: Array<{ id: string; path: string; description: string; guidance: string[] }>;
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
    } else if (/\.instructions\.md$/i.test(candidate) || /(?:^|\/)AGENTS\.md$/i.test(relative)) {
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
