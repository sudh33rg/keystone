import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import { CopilotCustomizationItemSchema, type CopilotCustomizationItem } from "../../shared/contracts/build";
import type { DevelopmentTask } from "../../shared/contracts/delegation";
import type { DelegationPersistenceStore } from "../persistence/DelegationPersistenceStore";

export class CopilotCustomizationService {
  constructor(private readonly workspace: WorkspaceAdapter, private readonly persistence: DelegationPersistenceStore) {}

  async discover(task: DevelopmentTask, signal?: AbortSignal): Promise<CopilotCustomizationItem[]> {
    const output: CopilotCustomizationItem[] = [];
    for (const root of this.workspace.getRoots().slice(0, 20)) {
      const files = await this.workspace.listFiles(root, 10_000);
      for (const file of files) {
        signal?.throwIfAborted();
        const classified = classify(file.relativePath); if (!classified) continue;
        const scope = scopeFor(file.relativePath); const applicable = !scope.length || task.expectedFiles.some((path) => scope.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)));
        let description: string | undefined;
        try { description = firstMeaningfulLine((await this.workspace.readTextFile(file.uri)).slice(0, 20_000)); } catch { description = "The customization file could not be read."; }
        const persisted = this.persistence.snapshot.customizationSelections[task.id];
        output.push(CopilotCustomizationItemSchema.parse({ id: `${root.name}:${file.relativePath}`, kind: classified, name: file.relativePath.split("/").at(-1), description, sourcePath: file.relativePath, ...(scope.length ? { scope } : {}), applicable, applicabilityReason: applicable ? scope.length ? "Expected task files match the path-specific scope." : "Repository-wide customization applies." : "Expected task files do not match this path scope.", enabled: this.workspace.isTrusted(), trustState: this.workspace.isTrusted() ? "trusted" : "untrusted", selected: persisted ? persisted.includes(`${root.name}:${file.relativePath}`) : applicable, fingerprint: `path:${file.relativePath}` }));
      }
    }
    return output.slice(0, 500);
  }

  async select(taskId: string, id: string, selected: boolean): Promise<void> { await this.persistence.update((state) => { const values = new Set(state.customizationSelections[taskId] ?? []); if (selected) values.add(id); else values.delete(id); return { ...state, customizationSelections: { ...state.customizationSelections, [taskId]: [...values].slice(0, 500) } }; }); }
}

function classify(path: string): CopilotCustomizationItem["kind"] | undefined {
  if (/(^|\/)AGENTS\.md$/i.test(path) || /^\.github\/copilot-instructions\.md$/i.test(path)) return "instruction";
  if (/^\.github\/instructions\/.*\.instructions\.md$/i.test(path)) return "path-instruction";
  if (/^\.github\/agents\/.*\.agent\.md$/i.test(path)) return "agent";
  if (/^\.github\/prompts\/.*\.prompt\.md$/i.test(path)) return "prompt";
  if (/(^|\/)(\.github\/skills|\.agents\/skills)\/.*\/SKILL\.md$/i.test(path)) return "skill";
  return undefined;
}
function scopeFor(path: string): string[] { const match = /^\.github\/instructions\/(.+)\.instructions\.md$/i.exec(path); return match?.[1] ? [match[1].replace(/\*/g, "").replace(/\/$/, "")] : []; }
function firstMeaningfulLine(value: string): string | undefined { return value.split(/\r?\n/).map((line) => line.replace(/^#+\s*/, "").trim()).find((line) => line && !line.startsWith("---"))?.slice(0, 2000); }
