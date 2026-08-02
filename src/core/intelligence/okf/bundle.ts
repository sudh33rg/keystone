import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  KeystoneKnowledgeRelationship,
  KeystoneKnowledgeUnit,
  KeystoneOkfSnapshot
} from "./types";

export const PORTABLE_OKF_VERSION = "0.2" as const;

/**
 * Portable Open Knowledge Format (OKF v0.2) projection.
 *
 * Keystone's JSONL snapshot is the authoritative machine index. This module
 * exports that index as the interoperable OKF contract: one Markdown concept
 * per knowledge unit, YAML frontmatter with a required `type`, standard
 * Markdown links, index.md, log.md, and citation-backed evidence.
 */
export interface OkfBundleWriteResult {
  readonly root: string;
  readonly concepts: number;
  readonly files: number;
  readonly digest: string;
  readonly validation: OkfBundleValidationResult;
}

export interface OkfBundleValidationIssue {
  readonly file: string;
  readonly message: string;
}
export interface OkfBundleValidationResult {
  readonly valid: boolean;
  readonly concepts: number;
  readonly issues: readonly OkfBundleValidationIssue[];
}

export interface OkfBundleWriteOptions {
  readonly onProgress?: (message: string) => void;
}

export async function writePortableOkfBundle(
  workspaceRoot: string,
  snapshot: KeystoneOkfSnapshot,
  targetRoot: string,
  options: OkfBundleWriteOptions = {}
): Promise<OkfBundleWriteResult> {
  const candidate = `${targetRoot}.candidate-${snapshot.manifest.extractionRunId}`;
  await fs.rm(candidate, { recursive: true, force: true });
  await fs.mkdir(candidate, { recursive: true });

  const activeUnits = snapshot.units.filter((unit) => unit.lifecycle !== "deleted");
  const conceptPath = new Map(activeUnits.map((unit) => [unit.id, conceptRelativePath(unit)]));
  const outgoing = groupRelationships(
    snapshot.relationships.filter((item) => item.lifecycle !== "deleted"),
    "sourceId"
  );
  const incoming = groupRelationships(
    snapshot.relationships.filter((item) => item.lifecycle !== "deleted"),
    "targetId"
  );
  const evidenceById = new Map(snapshot.evidence.map((item) => [item.id, item]));
  const unitById = new Map(snapshot.units.map((item) => [item.id, item]));
  const groups = new Map<string, KeystoneKnowledgeUnit[]>();
  for (const unit of activeUnits) groups.set(unit.kind, [...(groups.get(unit.kind) ?? []), unit]);

  type DocumentRenderer = { relative: string; render: () => string };
  const renderers: DocumentRenderer[] = activeUnits.map((unit) => ({
    relative: conceptPath.get(unit.id)!,
    render: () =>
      renderConcept(
        unit,
        outgoing.get(unit.id) ?? [],
        incoming.get(unit.id) ?? [],
        conceptPath,
        evidenceById,
        unitById,
        snapshot
      )
  }));
  renderers.push(
    { relative: "index.md", render: () => renderRootIndex(snapshot, groups, conceptPath) },
    { relative: "log.md", render: () => renderLog(snapshot) },
    ...[...groups.entries()].map(([kind, units]) => ({
      relative: `${pluralize(kind)}/index.md`,
      render: () => renderKindIndex(kind, units, conceptPath)
    }))
  );
  renderers.sort((left, right) => left.relative.localeCompare(right.relative));

  // Stream portable concepts in deterministic path order. This retains every OKF concept without
  // a knowledge/file cap while bounding live rendered Markdown memory for large repositories.
  const directories = new Set(
    renderers.map((item) => path.dirname(path.join(candidate, item.relative)))
  );
  await Promise.all([...directories].map((directory) => fs.mkdir(directory, { recursive: true })));
  const digestHash = createHash("sha256");
  const issues: OkfBundleValidationIssue[] = [];
  let concepts = 0;
  const batchSize = 32;
  for (let offset = 0; offset < renderers.length; offset += batchSize) {
    const rendered = renderers
      .slice(offset, offset + batchSize)
      .map((item) => ({ relative: item.relative, content: item.render() }));
    for (const item of rendered) {
      digestHash.update(slash(item.relative)).update("\0").update(item.content).update("\0");
      concepts += validatePortableOkfDocument(item.relative, item.content, issues);
    }
    await Promise.all(
      rendered.map((item) =>
        fs.writeFile(path.join(candidate, item.relative), item.content, "utf8")
      )
    );
    options.onProgress?.(
      `Writing portable OKF concepts (${Math.min(offset + rendered.length, renderers.length)}/${renderers.length})...`
    );
  }
  if (!renderers.some((item) => item.relative === "index.md"))
    issues.push({
      file: "index.md",
      message: "Root index.md is required by the Keystone bundle profile."
    });
  const validation: OkfBundleValidationResult = { valid: issues.length === 0, concepts, issues };
  if (!validation.valid)
    throw new Error(
      `Portable OKF bundle validation failed: ${validation.issues.map((issue) => `${issue.file}: ${issue.message}`).join("; ")}`
    );
  const digest = digestHash.digest("hex");
  await fs.writeFile(
    path.join(candidate, ".keystone-bundle.json"),
    `${JSON.stringify(
      {
        format: "OKF",
        version: PORTABLE_OKF_VERSION,
        generatedBy: "Keystone",
        extractionRunId: snapshot.manifest.extractionRunId,
        sourceProfile: snapshot.manifest.profile,
        sourceProfileVersion: snapshot.manifest.profileVersion,
        concepts: activeUnits.length,
        digest
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const previous = `${targetRoot}.previous`;
  await fs.rm(previous, { recursive: true, force: true });
  try {
    await fs.rename(targetRoot, previous);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await fs.rename(candidate, targetRoot);
  await fs.rm(previous, { recursive: true, force: true });
  return {
    root: targetRoot,
    concepts: activeUnits.length,
    files: activeUnits.length + groups.size + 3,
    digest,
    validation
  };
}

export async function validatePortableOkfBundle(root: string): Promise<OkfBundleValidationResult> {
  const markdownFiles = await walk(root, (file) => file.endsWith(".md"));
  const issues: OkfBundleValidationIssue[] = [];
  let concepts = 0;
  const batchSize = 32;
  for (let offset = 0; offset < markdownFiles.length; offset += batchSize) {
    const batch = markdownFiles.slice(offset, offset + batchSize);
    const contents = await Promise.all(
      batch.map(async (file) => ({
        relative: slash(path.relative(root, file)),
        text: await fs.readFile(file, "utf8")
      }))
    );
    for (const item of contents)
      concepts += validatePortableOkfDocument(item.relative, item.text, issues);
  }
  if (!markdownFiles.some((file) => slash(path.relative(root, file)) === "index.md"))
    issues.push({
      file: "index.md",
      message: "Root index.md is required by the Keystone bundle profile."
    });
  return { valid: issues.length === 0, concepts, issues };
}

function validatePortableOkfDocument(
  relative: string,
  text: string,
  issues: OkfBundleValidationIssue[]
): number {
  const base = path.basename(relative).toLowerCase();
  if (base === "index.md") {
    if (!/^#\s+.+/m.test(text))
      issues.push({ file: relative, message: "index.md must contain a Markdown title." });
    if (relative === "index.md") {
      const version = text.match(/^okf_version:\s*["']?([^"'\n]+)["']?$/m)?.[1]?.trim();
      if (version !== PORTABLE_OKF_VERSION)
        issues.push({
          file: relative,
          message: `Root index.md must declare okf_version: "${PORTABLE_OKF_VERSION}".`
        });
    } else if (text.startsWith("---\n")) {
      issues.push({
        file: relative,
        message: "Only the bundle-root index.md may contain frontmatter."
      });
    }
    return 0;
  }
  if (base === "log.md") {
    if (!/^#\s+.+/m.test(text) || !/^##\s+\d{4}-\d{2}-\d{2}/m.test(text))
      issues.push({ file: relative, message: "log.md must contain a title and dated entry." });
    return 0;
  }
  if (!text.startsWith("---\n")) {
    issues.push({ file: relative, message: "Concept must start with YAML frontmatter." });
    return 1;
  }
  const close = text.indexOf("\n---\n", 4);
  if (close < 0) {
    issues.push({ file: relative, message: "Concept frontmatter is not closed." });
    return 1;
  }
  const frontmatter = text.slice(4, close);
  const type = frontmatter.match(/^type:\s*(.+)$/m)?.[1]?.trim();
  if (!type)
    issues.push({
      file: relative,
      message: "Concept frontmatter requires a non-empty type field."
    });
  if (/^type:\s*[\[\{]/m.test(frontmatter))
    issues.push({ file: relative, message: "Concept type must be a scalar string." });
  if (
    !/^generated:\s*$/m.test(frontmatter) ||
    !/^\s{2}by:\s*.+$/m.test(frontmatter) ||
    !/^\s{2}at:\s*.+$/m.test(frontmatter)
  )
    issues.push({
      file: relative,
      message: "Keystone OKF concepts require generated.by and generated.at."
    });
  const status = frontmatter
    .match(/^status:\s*([^\n#]+)$/m)?.[1]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  if (status && !["draft", "stable", "deprecated"].includes(status))
    issues.push({ file: relative, message: `Unsupported OKF lifecycle status: ${status}.` });
  if (/^sources:\s*$/m.test(frontmatter)) {
    const sourceEntries = frontmatter.split(/^\s{2}-\s+id:\s*/m).slice(1);
    if (!sourceEntries.length)
      issues.push({ file: relative, message: "sources must contain at least one source entry." });
    for (const entry of sourceEntries)
      if (!/^\s{4}resource:\s*.+$/m.test(entry))
        issues.push({ file: relative, message: "Every sources entry requires resource." });
  }
  const sourceIds = [...frontmatter.matchAll(/^\s{2}-\s+id:\s*["']?([^"'\n]+)["']?$/gm)].map(
    (match) => match[1].trim()
  );
  const footnotes = [...text.slice(close + 5).matchAll(/^\[\^([^\]]+)\]:/gm)].map(
    (match) => match[1]
  );
  for (const sourceId of sourceIds)
    if (!footnotes.includes(sourceId))
      issues.push({
        file: relative,
        message: `Source ${sourceId} is not cited by a matching Markdown footnote.`
      });
  return 1;
}

function renderConcept(
  unit: KeystoneKnowledgeUnit,
  outgoing: readonly KeystoneKnowledgeRelationship[],
  incoming: readonly KeystoneKnowledgeRelationship[],
  conceptPaths: ReadonlyMap<string, string>,
  evidenceById: ReadonlyMap<string, KeystoneOkfSnapshot["evidence"][number]>,
  unitById: ReadonlyMap<string, KeystoneKnowledgeUnit>,
  snapshot: KeystoneOkfSnapshot
): string {
  const tags = unique(["keystone", unit.kind, unit.confidence.level, unit.lifecycle]);
  const resource = resourceFor(unit);
  const evidence = unit.provenance.evidenceIds
    .map((id) => evidenceById.get(id))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const sourceIds = new Map(evidence.map((item) => [item.id, sourceId(item.id)]));
  const lines: string[] = [
    "---",
    `type: ${yamlScalar(typeLabel(unit.kind))}`,
    `title: ${yamlScalar(unit.name)}`,
    ...(unit.description ? [`description: ${yamlScalar(unit.description)}`] : []),
    ...(resource ? [`resource: ${yamlScalar(resource)}`] : []),
    `tags: [${tags.map(yamlScalar).join(", ")}]`,
    "generated:",
    `  by: ${yamlScalar("keystone/1.0.0")}`,
    `  at: ${yamlScalar(unit.updatedAt)}`,
    "verified:",
    `  - by: ${yamlScalar("process:keystone-okf-validator")}`,
    `    at: ${yamlScalar(snapshot.manifest.validation.validatedAt)}`,
    `status: ${unit.lifecycle === "deprecated" ? "deprecated" : "stable"}`,
    ...(evidence.length
      ? [
          "sources:",
          ...evidence.flatMap((item) => {
            const id = sourceIds.get(item.id)!;
            return [
              `  - id: ${yamlScalar(id)}`,
              `    resource: ${yamlScalar(workspaceCitation(item.source.workspaceRelativePath, item.source.startLine))}`,
              `    title: ${yamlScalar(sourceTitle(item))}`,
              `    author: ${yamlScalar(`process:${actorSegment(item.extractor)}`)}`,
              `    last_modified: ${yamlScalar(item.observedAt.slice(0, 10))}`
            ];
          })
        ]
      : []),
    `keystone_id: ${yamlScalar(unit.id)}`,
    `keystone_kind: ${yamlScalar(unit.kind)}`,
    `keystone_confidence: ${unit.confidence.score}`,
    `keystone_lifecycle: ${yamlScalar(unit.lifecycle)}`,
    "---",
    "",
    `# ${unit.name}`,
    "",
    unit.description ?? humanSummary(unit),
    "",
    "## Repository facts",
    "",
    renderProperties(unit.properties)
  ];

  const relations = [
    ...outgoing.map((item) => ({ direction: "outgoing" as const, item })),
    ...incoming.map((item) => ({ direction: "incoming" as const, item }))
  ];
  if (relations.length) {
    lines.push("", "## Relationships", "");
    for (const relation of relations.sort((a, b) =>
      `${a.item.kind}:${a.item.id}`.localeCompare(`${b.item.kind}:${b.item.id}`)
    )) {
      const peerId =
        relation.direction === "outgoing" ? relation.item.targetId : relation.item.sourceId;
      const peerPath = conceptPaths.get(peerId);
      if (!peerPath) continue;
      const currentPath = conceptPaths.get(unit.id)!;
      const link = slash(path.relative(path.dirname(currentPath), peerPath));
      const peer = unitById.get(peerId);
      const arrow = relation.direction === "outgoing" ? "→" : "←";
      lines.push(
        `- **${relation.item.kind}** ${arrow} [${peer?.name ?? peerId}](${link.startsWith(".") ? link : `./${link}`})`
      );
    }
  }

  if (evidence.length) {
    lines.push("", "## Evidence", "");
    for (const item of evidence) {
      const range = item.source.startLine
        ? `:${item.source.startLine}${item.source.endLine && item.source.endLine !== item.source.startLine ? `-${item.source.endLine}` : ""}`
        : "";
      const id = sourceIds.get(item.id)!;
      lines.push(
        `- \`${item.source.workspaceRelativePath}${range}\` — ${item.method}; extractor \`${item.extractor}@${item.extractorVersion}\`; confidence ${unit.confidence.score.toFixed(2)}.[^${id}]`
      );
    }
    lines.push("");
    evidence.forEach((item) => {
      const id = sourceIds.get(item.id)!;
      lines.push(
        `[^${id}]: ${sourceTitle(item)} — ${workspaceCitation(item.source.workspaceRelativePath, item.source.startLine)}`
      );
    });
  }
  return `${lines.join("\n").trim()}\n`;
}

function renderRootIndex(
  snapshot: KeystoneOkfSnapshot,
  groups: ReadonlyMap<string, readonly KeystoneKnowledgeUnit[]>,
  conceptPaths: ReadonlyMap<string, string>
): string {
  const lines = [
    "---",
    `okf_version: ${yamlScalar(PORTABLE_OKF_VERSION)}`,
    "---",
    "",
    "# Keystone Repository Knowledge",
    "",
    "Portable Open Knowledge Format bundle generated deterministically from the promoted Keystone Intelligence snapshot.",
    "",
    `- Extraction run: \`${snapshot.manifest.extractionRunId}\``,
    `- Generated: ${snapshot.manifest.generatedAt}`,
    `- Concepts: ${snapshot.units.filter((item) => item.lifecycle !== "deleted").length}`,
    `- Evidence records: ${snapshot.evidence.length}`,
    "",
    "## Browse by type",
    ""
  ];
  for (const [kind, units] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
    lines.push(`- [${typeLabel(kind)}](${pluralize(kind)}/index.md) — ${units.length}`);
  const repositories = snapshot.units.filter(
    (item) => item.kind === "repository" && item.lifecycle !== "deleted"
  );
  if (repositories.length) {
    lines.push("", "## Entry points", "");
    for (const unit of repositories) lines.push(`- [${unit.name}](${conceptPaths.get(unit.id)})`);
  }
  return `${lines.join("\n")}\n`;
}

function renderKindIndex(
  kind: string,
  units: readonly KeystoneKnowledgeUnit[],
  conceptPaths: ReadonlyMap<string, string>
): string {
  const directory = pluralize(kind);
  const lines = [
    `# ${typeLabel(kind)}`,
    "",
    `Concepts of type **${typeLabel(kind)}** generated from repository evidence.`,
    ""
  ];
  for (const unit of [...units].sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = slash(path.relative(directory, conceptPaths.get(unit.id)!));
    lines.push(
      `- [${unit.name}](${relative.startsWith(".") ? relative : `./${relative}`}) — ${unit.description ?? humanSummary(unit)}`
    );
  }
  return `${lines.join("\n")}\n`;
}

function renderLog(snapshot: KeystoneOkfSnapshot): string {
  return `# Knowledge update log\n\n## ${snapshot.manifest.generatedAt.slice(0, 10)}\n\n- Promoted extraction run \`${snapshot.manifest.extractionRunId}\`.\n- ${snapshot.manifest.counts.active} active concepts and ${snapshot.manifest.counts.deleted} lifecycle tombstones.\n- Source profile: \`${snapshot.manifest.profile}\` version \`${snapshot.manifest.profileVersion}\`.\n`;
}

function renderProperties(properties: Readonly<Record<string, unknown>>): string {
  const entries = Object.entries(properties).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );
  if (!entries.length) return "- No additional structured properties.";
  return entries
    .map(([key, value]) => `- **${humanize(key)}:** ${markdownValue(value)}`)
    .join("\n");
}
function markdownValue(value: unknown): string {
  if (Array.isArray(value))
    return value.length ? value.map((item) => `\`${String(item)}\``).join(", ") : "None";
  if (typeof value === "object") return `\`${JSON.stringify(value)}\``;
  return `\`${String(value)}\``;
}
function humanSummary(unit: KeystoneKnowledgeUnit): string {
  return `${typeLabel(unit.kind)} discovered by Keystone with ${unit.confidence.level} confidence (${unit.confidence.score.toFixed(2)}).`;
}
function resourceFor(unit: KeystoneKnowledgeUnit): string | undefined {
  const filePath =
    typeof unit.properties.filePath === "string"
      ? unit.properties.filePath
      : typeof unit.properties.path === "string"
        ? unit.properties.path
        : undefined;
  return filePath ? `workspace:///${slash(filePath)}` : `keystone://knowledge/${unit.id}`;
}
function workspaceCitation(filePath: string, line?: number): string {
  return `workspace:///${slash(filePath)}${line ? `#L${line}` : ""}`;
}
function sourceId(value: string): string {
  return `source-${slug(value).slice(0, 48)}`;
}
function sourceTitle(item: KeystoneOkfSnapshot["evidence"][number]): string {
  return `${item.source.workspaceRelativePath}${item.source.symbol ? ` · ${item.source.symbol}` : ""}`;
}
function actorSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-|-$/g, "") || "keystone-extractor"
  );
}
function conceptRelativePath(unit: KeystoneKnowledgeUnit): string {
  return `${pluralize(unit.kind)}/${slug(unit.name)}-${unit.id.slice(-10)}.md`;
}
function pluralize(kind: string): string {
  return `${kind.replace(/-/g, "_")}s`;
}
function typeLabel(kind: string): string {
  return `Keystone ${humanize(kind)}`;
}
function humanize(value: string): string {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 70) || "concept"
  );
}
function yamlScalar(value: string): string {
  return JSON.stringify(value);
}
function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
function slash(value: string): string {
  return value.split(path.sep).join("/");
}
function groupRelationships(
  items: readonly KeystoneKnowledgeRelationship[],
  key: "sourceId" | "targetId"
): Map<string, KeystoneKnowledgeRelationship[]> {
  const map = new Map<string, KeystoneKnowledgeRelationship[]>();
  for (const item of items) map.set(item[key], [...(map.get(item[key]) ?? []), item]);
  return map;
}
async function walk(root: string, include: (file: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile() && include(target)) out.push(target);
    }
  }
  return out.sort();
}
async function digestDirectory(root: string): Promise<string> {
  const hash = createHash("sha256");
  for (const file of await walk(root, () => true)) {
    hash
      .update(slash(path.relative(root, file)))
      .update("\0")
      .update(await fs.readFile(file))
      .update("\0");
  }
  return hash.digest("hex");
}
