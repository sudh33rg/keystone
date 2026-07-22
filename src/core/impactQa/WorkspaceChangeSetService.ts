import { createHash } from "node:crypto";
import type { Phase7ChangeSet, Phase7ChangedFile } from "../../shared/contracts/impactQa";

export interface DetectedWorkspaceChanges { source: "git" | "workspace-snapshot"; baseRevision?: string; headRevision?: string; files: Array<Omit<Phase7ChangedFile, "source">> }
export interface WorkspaceChangeSetProvider { detect(): Promise<DetectedWorkspaceChanges | undefined> }
export class WorkspaceChangeSetError extends Error { constructor(public readonly code: string, message: string) { super(message); } }

export class WorkspaceChangeSetService {
  constructor(private readonly provider: WorkspaceChangeSetProvider, private readonly now = () => new Date().toISOString()) {}
  async detect(input: { workflowId: string; developmentResultId?: string; workspaceFiles: Set<string>; manualFiles?: string[] }): Promise<Phase7ChangeSet> {
    const detected = await this.provider.detect();
    const raw: Array<Omit<Phase7ChangedFile, "source">> = detected?.files ?? (input.manualFiles ?? []).map((path) => ({ path, changeType: "unknown" as const }));
    if (!detected && !raw.length) throw new WorkspaceChangeSetError("change-detection-unavailable", "Source-control change detection is unavailable. Select changed files manually or use workspace snapshot comparison.");
    const byPath = new Map<string, Phase7ChangedFile>();
    for (const item of raw) {
      const path = normalize(item.path);
      if (!valid(path) || (!input.workspaceFiles.has(path) && item.changeType !== "deleted")) throw new WorkspaceChangeSetError("file-outside-workspace", `Changed file is outside the workspace: ${item.path}`);
      const previous = byPath.get(path);
      byPath.set(path, { ...item, path, source: detected?.source === "git" ? "git" : detected ? "filesystem" : "manual", staged: Boolean(previous?.staged || item.staged), changedRanges: mergeRanges(previous?.changedRanges, item.changedRanges) });
    }
    const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    if (!files.length) throw new WorkspaceChangeSetError("change-set-empty", "No changed workspace files were detected or selected.");
    const timestamp = this.now();
    const contentHash = hash({ source: detected?.source ?? "manual-selection", base: detected?.baseRevision, head: detected?.headRevision, files });
    return { id: crypto.randomUUID(), workflowId: input.workflowId, developmentResultId: input.developmentResultId, source: detected?.source ?? "manual-selection", baseRevision: detected?.baseRevision, headRevision: detected?.headRevision, files, status: "draft", createdAt: timestamp, updatedAt: timestamp, contentHash };
  }
  freshness(saved: Phase7ChangeSet, currentHash: string): { stale: boolean; reason?: string } { return saved.contentHash === currentHash ? { stale: false } : { stale: true, reason: "Workspace changes differ from the accepted change-set snapshot." }; }
}
function normalize(path: string): string { return path.replace(/\\/g, "/").replace(/^\.\//, ""); }
function valid(path: string): boolean { return Boolean(path) && !path.startsWith("/") && !path.split("/").includes(".."); }
function mergeRanges(left: Phase7ChangedFile["changedRanges"], right: Phase7ChangedFile["changedRanges"]): Phase7ChangedFile["changedRanges"] { const values = [...(left ?? []), ...(right ?? [])]; return [...new Map(values.map((item) => [JSON.stringify(item), item])).values()]; }
function hash(value: unknown): string { return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`; }
