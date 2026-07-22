import type { Activity } from "../../shared/contracts/activity";
import type { CanonicalWorkflow } from "../../shared/contracts/canonicalWorkflow";
import type { HomeState } from "../../shared/contracts/home";
import type { IntelligenceOverview } from "../../shared/contracts/intelligence";
import type { WorkspaceSummary } from "../../shared/contracts/domain";

interface IntelligenceOverviewSource { overview(): Promise<IntelligenceOverview>; }
interface WorkflowSource { listWorkflows(): CanonicalWorkflow[]; getActiveWorkflow(): CanonicalWorkflow | null; }
interface DevelopmentSummarySource { getHomeSummary(workflowId: string): Promise<{ nextRequiredAction: string } | undefined>; }

export class HomeStateService {
  constructor(
    private readonly workspace: () => WorkspaceSummary,
    private readonly intelligence: IntelligenceOverviewSource,
    private readonly workflows: WorkflowSource,
    private readonly activities: () => Activity[],
    private readonly development?: DevelopmentSummarySource,
  ) {}

  async getState(): Promise<HomeState> {
    const workspace = this.workspace();
    const overview = await this.intelligence.overview();
    const active = this.workflows.getActiveWorkflow();
    const currentStage = active?.stages?.find((stage) => stage.id === active.currentStageId);
    const development = active && this.development ? await this.development.getHomeSummary(active.id) : undefined;
    const progress = overview.runtime?.progress;
    return {
      repository: {
        name: overview.repository?.displayName ?? workspace.name,
        status: workspace.rootCount === 0 ? "unavailable" : overview.status,
        ...(overview.generation > 0 ? { generation: overview.generation } : {}),
        ...(overview.updatedAt ? { lastSuccessfulUpdate: overview.updatedAt } : {}),
        ...(overview.pendingUpdate ? { pendingUpdate: true } : {}),
        ...(progress ? { progress: { completed: progress.fileCount, total: progress.totalFiles, label: progress.stage } } : {}),
        refreshSupported: workspace.rootCount > 0,
      },
      activeWorkflow: active ? {
        id: active.id,
        title: active.intent.text,
        intent: active.intent.text,
        workType: active.intent.workType,
        status: active.status,
        ...(currentStage ? { currentStage: currentStage.displayName, currentStageStatus: currentStage.status } : {}),
        ...(development?.nextRequiredAction ? { nextRequiredAction: development.nextRequiredAction } : active.stages?.some((stage) => stage.type === "development") ? { nextRequiredAction: "Open Development" } : {}),
        updatedAt: active.updatedAt,
      } : null,
      recentActivities: this.activities()
        .slice()
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 10)
        .map((activity) => ({ id: activity.id, title: activity.title, status: activity.status, updatedAt: activity.updatedAt })),
    };
  }
}
