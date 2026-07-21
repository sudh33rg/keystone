import { createHash } from "node:crypto";
import type {
  WorkspaceAdapter,
  WorkspaceFileReference,
} from "../../extension/adapters/WorkspaceAdapter";
import {
  CopilotCustomizationItemSchema,
  type CopilotCustomizationItem,
} from "../../shared/contracts/build";
import {
  CopilotCustomizationRecordSchema,
  type CopilotCustomizationRecord,
} from "../../shared/contracts/copilotIntegration";
import type { DevelopmentTask } from "../../shared/contracts/delegation";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";
import type { CopilotIntegrationPersistenceStore } from "../persistence/CopilotIntegrationPersistenceStore";

const MAX_FILES = 10_000;
const MAX_ITEMS = 500;
const MAX_CONTENT = 64_000;

export class CopilotCustomizationScanner {
  constructor(private readonly workspace: WorkspaceAdapter) {}
  async scan(
    signal?: AbortSignal,
  ): Promise<Array<{ file: WorkspaceFileReference; record: CopilotCustomizationRecord }>> {
    const output: Array<{ file: WorkspaceFileReference; record: CopilotCustomizationRecord }> = [];
    for (const root of this.workspace.getRoots().slice(0, 20))
      for (const file of await this.workspace.listFiles(root, MAX_FILES)) {
        signal?.throwIfAborted();
        const kind = classify(file.relativePath);
        if (!kind) continue;
        let content = "";
        let lastModified: string | undefined;
        try {
          const stat = await this.workspace.statFile(file.uri);
          if (stat.byteSize > MAX_CONTENT) continue;
          content = (await this.workspace.readTextFile(file.uri)).slice(0, MAX_CONTENT);
          lastModified = stat.modifiedAt;
        } catch {
          /* unreadable is retained as unavailable metadata */
        }
        const metadata = frontmatter(content);
        const id = `${root.name}:${file.relativePath}`;
        const trusted = this.workspace.isTrusted();
        output.push({
          file,
          record: CopilotCustomizationRecordSchema.parse({
            id,
            kind,
            name: metadata.name ?? file.relativePath.split("/").at(-1),
            description:
              metadata.description ??
              firstMeaningfulLine(content) ??
              "Customization metadata is unavailable.",
            source: "repository",
            sourcePath: file.relativePath,
            ...(metadata.applyTo.length ? { scopePatterns: metadata.applyTo } : {}),
            applicability: trusted ? "suggested" : "untrusted",
            applicable: false,
            applicabilityReason: trusted
              ? "Applicability has not yet been evaluated for a task."
              : "Workspace trust is required before customization guidance can be selected.",
            enabled: trusted,
            trustState: trusted ? "workspace-trusted" : "untrusted",
            contentFingerprint: fingerprint(
              content || `${file.relativePath}:${lastModified ?? "unreadable"}`,
            ),
            ...(lastModified ? { lastModified } : {}),
            runtimeVerified: false,
            guidanceDisposition: nativeDisposition(kind),
          }),
        });
        if (output.length >= MAX_ITEMS) return output;
      }
    return output;
  }
}

export class CopilotCustomizationApplicabilityService {
  evaluate(
    items: CopilotCustomizationRecord[],
    task: DevelopmentTask,
    explicit: Record<string, boolean> = {},
    previousFingerprints: Record<string, string> = {},
  ): CopilotCustomizationRecord[] {
    const expectedFiles = task.expectedFiles ?? [];
    const languageHints = new Set(expectedFiles.flatMap((path) => extensionLanguage(path)));
    const dedupe = new Map<string, string>();
    return items.map((item) => {
      const changed =
        previousFingerprints[item.id] !== undefined &&
        previousFingerprints[item.id] !== item.contentFingerprint;
      const patterns = item.scopePatterns ?? [];
      const pathMatch =
        !patterns.length ||
        expectedFiles.some((path) => patterns.some((pattern) => globMatches(pattern, path)));
      const text = `${item.name} ${item.description ?? ""}`.toLowerCase();
      const categoryMatch =
        text.includes(task.category) ||
        (task.requiredCapabilities ?? []).some((capability) =>
          text.includes(capability.toLowerCase()),
        );
      const languageMatch = [...languageHints].some((language) => text.includes(language));
      const selected = explicit[item.id];
      let applicability: CopilotCustomizationRecord["applicability"] = pathMatch
        ? patterns.length
          ? "automatically-applicable"
          : categoryMatch || languageMatch
            ? "suggested"
            : "suggested"
        : "not-applicable";
      let applicable = pathMatch;
      let reason = !pathMatch
        ? "Expected task files do not match the declared path scope."
        : patterns.length
          ? "Expected task files match the declared path scope."
          : categoryMatch || languageMatch
            ? "Task category, capability, or language matches customization metadata."
            : "Repository-wide guidance is available for explicit review.";
      if (item.trustState === "untrusted") {
        applicability = "untrusted";
        applicable = false;
        reason = "Workspace trust is required.";
      } else if (changed) {
        applicability = "stale";
        applicable = false;
        reason = "The customization fingerprint changed and must be reviewed again.";
      } else if (selected === true) {
        applicability = "manually-selected";
        applicable = true;
        reason = "Selected explicitly for this task.";
      } else if (selected === false) {
        applicability = "not-applicable";
        applicable = false;
        reason = "Disabled explicitly by the user.";
      }
      const duplicateOf = dedupe.get(item.contentFingerprint);
      if (!duplicateOf) dedupe.set(item.contentFingerprint, item.id);
      return CopilotCustomizationRecordSchema.parse({
        ...item,
        applicability,
        applicable,
        applicabilityReason: reason,
        enabled: selected ?? item.enabled,
        guidanceDisposition: duplicateOf ? "duplicate" : item.guidanceDisposition,
        ...(duplicateOf ? { duplicateOf } : {}),
      });
    });
  }
}

export class CopilotCustomizationService {
  readonly scanner: CopilotCustomizationScanner;
  readonly applicability = new CopilotCustomizationApplicabilityService();
  constructor(
    private readonly workspace: WorkspaceAdapter,
    private readonly persistence: DelegationPersistenceStore,
    private readonly integration?: CopilotIntegrationPersistenceStore,
  ) {
    this.scanner = new CopilotCustomizationScanner(workspace);
  }
  async discoverRecords(
    task: DevelopmentTask,
    signal?: AbortSignal,
  ): Promise<CopilotCustomizationRecord[]> {
    const scanned = (await this.scanner.scan(signal)).map((item) => item.record);
    const state = this.integration?.snapshot;
    const records = this.applicability.evaluate(
      scanned,
      task,
      state?.customizationEnabled ?? {},
      state?.customizationFingerprints ?? {},
    );
    if (this.integration)
      await this.integration.update((current) => ({
        ...current,
        customizationFingerprints: Object.fromEntries(
          records.map((item) => [item.id, item.contentFingerprint]),
        ),
      }));
    return records;
  }
  async discover(task: DevelopmentTask, signal?: AbortSignal): Promise<CopilotCustomizationItem[]> {
    const records = await this.discoverRecords(task, signal);
    const selected = new Set(this.persistence.snapshot.customizationSelections[task.id] ?? []);
    return records.map((item) =>
      CopilotCustomizationItemSchema.parse({
        id: item.id,
        kind: item.kind,
        name: item.name,
        description: item.description,
        sourcePath: item.sourcePath,
        scope: item.scopePatterns,
        applicable: item.applicable,
        applicabilityReason: item.applicabilityReason,
        enabled: item.enabled,
        trustState: item.trustState === "untrusted" ? "untrusted" : "trusted",
        selected: selected.has(item.id) || item.applicability === "automatically-applicable",
        fingerprint: item.contentFingerprint,
      }),
    );
  }
  async select(taskId: string, id: string, selected: boolean): Promise<void> {
    await this.persistence.update((state) => {
      const values = new Set(state.customizationSelections[taskId] ?? []);
      if (selected) values.add(id);
      else values.delete(id);
      return {
        ...state,
        customizationSelections: {
          ...state.customizationSelections,
          [taskId]: [...values].slice(0, MAX_ITEMS),
        },
      };
    });
    if (this.integration)
      await this.integration.update((state) => ({
        ...state,
        customizationEnabled: { ...state.customizationEnabled, [id]: selected },
      }));
  }
}

function classify(path: string): CopilotCustomizationRecord["kind"] | undefined {
  if (/(^|\/)AGENTS\.md$/i.test(path) || /^\.github\/copilot-instructions\.md$/i.test(path))
    return "instruction";
  if (/^\.github\/instructions\/.*\.instructions\.md$/i.test(path)) return "path-instruction";
  if (/^\.github\/agents\/.*\.agent\.md$/i.test(path)) return "agent";
  if (/^\.github\/prompts\/.*\.prompt\.md$/i.test(path)) return "prompt";
  if (/(^|\/)(\.github\/skills|\.agents\/skills)\/[^/]+\/SKILL\.md$/i.test(path)) return "skill";
  return undefined;
}
function frontmatter(content: string): { name?: string; description?: string; applyTo: string[] } {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match?.[1]) return { applyTo: [] };
  const values = Object.fromEntries(
    match[1].split(/\r?\n/).flatMap((line) => {
      const index = line.indexOf(":");
      return index > 0
        ? [
            [
              line.slice(0, index).trim(),
              line
                .slice(index + 1)
                .trim()
                .replace(/^['"]|['"]$/g, ""),
            ],
          ]
        : [];
    }),
  );
  return {
    ...(values.name ? { name: values.name } : {}),
    ...(values.description ? { description: values.description } : {}),
    applyTo: (values.applyTo ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 100),
  };
}
function firstMeaningfulLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line && !line.startsWith("---"))
    ?.slice(0, 2000);
}
function fingerprint(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function nativeDisposition(
  kind: CopilotCustomizationRecord["kind"],
): CopilotCustomizationRecord["guidanceDisposition"] {
  return ["instruction", "path-instruction", "agent", "prompt", "skill"].includes(kind)
    ? "native"
    : "reference";
}
function extensionLanguage(path: string): string[] {
  const ext = path.split(".").at(-1)?.toLowerCase();
  return ext
    ? [
        {
          ts: "typescript",
          tsx: "typescript",
          js: "javascript",
          jsx: "javascript",
          py: "python",
          java: "java",
          cs: "csharp",
          go: "go",
          rs: "rust",
        }[ext] ?? ext,
      ]
    : [];
}
function globMatches(pattern: string, path: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§")
    .replace(/\*/g, "[^/]*")
    .replace(/§§/g, ".*");
  try {
    return (
      new RegExp(`^${escaped}$`, "i").test(path) ||
      path.startsWith(pattern.replace(/[*?].*$/, "").replace(/\/$/, ""))
    );
  } catch {
    return false;
  }
}
