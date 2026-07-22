import type { DevelopmentChangeDetection, DevelopmentChangedFile } from "../../shared/contracts/development";

export interface WorkspaceChangeProvider { detect(): Promise<Array<Pick<DevelopmentChangedFile, "path" | "status" | "staged" | "previousPath">> | undefined>; }
export class WorkspaceChangeService {
  constructor(private readonly provider: WorkspaceChangeProvider) {}
  async detect(): Promise<DevelopmentChangeDetection> {
    const detected = await this.provider.detect();
    if (!detected) return { available: false, message: "Source-control change detection is unavailable. Select changed files manually.", changes: [] };
    const userChanges = detected.filter((change) => change.path !== ".keystone" && !change.path.startsWith(".keystone/"));
    const unique = new Map(userChanges.map((change) => [change.path, change]));
    return { available: true, changes: [...unique.values()].sort((left, right) => left.path.localeCompare(right.path)).map((change) => ({ ...change, associated: false })) };
  }
}
