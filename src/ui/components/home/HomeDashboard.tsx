import { useCallback, useEffect, useState } from "react";
import type { BootstrapSnapshot, AppRoute } from "../../../shared/contracts/domain";
import type {
  CopilotCapabilities,
  DevelopmentWorkflowSnapshot,
} from "../../../shared/contracts/delegation";
import type { CopilotIntegrationCapabilities } from "../../../shared/contracts/copilotIntegration";
import type { IntelligenceOverview } from "../../../shared/contracts/intelligence";
import type { WorkflowInstance } from "../../../shared/contracts/orchestration";
import type { WorkbenchCreateContext } from "../../../shared/contracts/workbench";
import { workbenchRoute } from "../../../shared/navigation";
import type { HostBridge } from "../../services/HostBridge";
import { Icon } from "../Icon";
import { toUiError, UiErrorState, type KeystoneUiError } from "../UiState";

export function HomeDashboard({
  bootstrap,
  overview,
  bridge,
  navigate,
}: {
  bootstrap: BootstrapSnapshot;
  overview?: IntelligenceOverview;
  bridge: HostBridge;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [workflows, setWorkflows] = useState<DevelopmentWorkflowSnapshot[]>([]);
  const [instances, setInstances] = useState<WorkflowInstance[]>([]);
  const [copilot, setCopilot] = useState<CopilotCapabilities>();
  const [integration, setIntegration] = useState<CopilotIntegrationCapabilities>();
  const [createContext, setCreateContext] = useState<WorkbenchCreateContext>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<KeystoneUiError>();
  const [refreshKey, setRefreshKey] = useState(0);
  const load = useCallback(async (): Promise<void> => {
    try {
      const [flows, orchestration, capabilities, integrationStatus, context] = await Promise.all([
        bridge.request("workflow/list", {}),
        bridge.request("orchestration/list", {}),
        bridge.request("copilot/capabilities", {}),
        bridge.request("copilot/getIntegrationStatus", {}),
        bridge.request("workbench/getCreateContext", {}),
      ]);
      setWorkflows(Array.isArray(flows) ? flows : []);
      setInstances(Array.isArray(orchestration) ? orchestration : []);
      if (capabilities) setCopilot(capabilities);
      setIntegration(integrationStatus);
      setCreateContext(context);
      setError(undefined);
    } catch (cause) {
      setError(
        toUiError(cause, {
          category: "home-load",
          title: "Home status is temporarily unavailable",
          fallbackMessage: "Keystone could not refresh the current workflow status.",
          retry: () => setRefreshKey((value) => value + 1),
          dismiss: () => setError(undefined),
        }),
      );
    }
  }, [bridge]);
  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load, refreshKey]);
  const workflow =
    workflows.find((item) => !["completed", "cancelled"].includes(item.status)) ?? workflows.at(-1);
  const instance = workflow
    ? instances.find((item) => item.intentId === workflow.intent.id)
    : undefined;
  const task =
    workflow?.tasks.find((item) => ["executing", "ready", "blocked"].includes(item.status)) ??
    workflow?.tasks[0];
  const resume: AppRoute = workflow
    ? workbenchRoute(
        workflow.id,
        workflow.tasks.length
          ? task?.status === "completed"
            ? "validate"
            : "build"
          : workflow.specification?.status === "approved"
            ? "plan"
            : "define",
      )
    : "/workbench/new";
  const importHandoff = async (): Promise<void> => {
    try {
      const imported = await bridge.request("handoff/import", { source: "file" });
      setNotice(
        imported
          ? `Imported ${imported.package.task.title} for review.`
          : "Handoff import cancelled.",
      );
    } catch (cause) {
      setError(
        toUiError(cause, {
          category: "handoff-import",
          title: "Task Handoff was not imported",
          fallbackMessage: "Keystone could not read the selected package.",
          preservedState: true,
          retry: () => void importHandoff(),
          dismiss: () => setError(undefined),
        }),
      );
    }
  };
  const branch =
    overview?.repository?.branch ??
    instance?.branch ??
    createContext?.repository.branch ??
    "Unavailable";
  const intelligenceStatus = (overview?.status ?? bootstrap.workspace.indexStatus).replace(
    "-",
    " ",
  );
  return (
    <section className="page home-page">
      <div className="hero">
        <div className="eyebrow">
          <Icon name="repo" size={14} /> Active repository · {bootstrap.workspace.name} · {branch}
        </div>
        <h1>
          Engineering work,
          <br />
          <em>in one lifecycle.</em>
        </h1>
        <p>
          Start from an intent, define the contract, plan tasks, build, validate, review, and
          complete only the capabilities this workflow needs.
        </p>
        <div className="button-row">
          <button className="primary-button" onClick={() => navigate("/workbench/new")}>
            Start new work
          </button>
          {workflow && (
            <button className="ghost-button" onClick={() => navigate(resume)}>
              Resume workflow
            </button>
          )}
          <button className="ghost-button" onClick={() => navigate("/intelligence")}>
            Ask repository
          </button>
          <button className="ghost-button" onClick={() => void importHandoff()}>
            Import handoff
          </button>
        </div>
      </div>
      {error && <UiErrorState error={error} />}{" "}
      {notice && (
        <div role="status" className="honesty-note">
          {notice}
        </div>
      )}
      <div className="status-grid">
        <Projection
          label="REPOSITORY"
          value={bootstrap.workspace.name}
          detail={`Branch ${branch}`}
          action="Open Repository Intelligence"
          onOpen={() => navigate("/intelligence")}
        />
        <Projection
          label="INTELLIGENCE"
          value={intelligenceStatus}
          detail={
            overview?.pendingUpdate
              ? "Updating; last complete generation remains available"
              : `Generation ${overview?.generation ?? 0}`
          }
          action="Ask repository"
          onOpen={() => navigate("/intelligence")}
        />
        <Projection
          label="ACTIVE WORKFLOW"
          value={workflow?.specification?.title ?? workflow?.intent.normalizedObjective ?? "None"}
          detail={workflow?.status ?? "Start new work to create a workflow"}
          {...(workflow ? { action: "Resume workflow", onOpen: () => navigate(resume) } : {})}
        />
        <Projection
          label="CURRENT TASK"
          value={task?.title ?? "None"}
          detail={task?.status ?? "No task is active"}
          {...(workflow
            ? {
                action: "Open task in Build",
                onOpen: () => navigate(workbenchRoute(workflow.id, "build")),
              }
            : {})}
        />
        <Projection
          label="PENDING APPROVALS"
          value={String(instance?.progress.pendingApprovals ?? 0)}
          detail="Explicit workflow approval gates"
          {...(workflow ? { action: "Open workflow", onOpen: () => navigate(resume) } : {})}
        />
        <Projection
          label="BLOCKING FINDINGS"
          value={String(instance?.progress.blockingFindings ?? 0)}
          detail="Open findings that prevent completion"
          {...(workflow
            ? {
                action: "Open Review",
                onOpen: () => navigate(workbenchRoute(workflow.id, "review")),
              }
            : {})}
        />
        <Projection
          label="VALIDATION FAILURES"
          value={String(instance?.progress.failedTasks ?? 0)}
          detail="Tasks with failed validation evidence"
          {...(workflow
            ? {
                action: "Open Validate",
                onOpen: () => navigate(workbenchRoute(workflow.id, "validate")),
              }
            : {})}
        />
        <Projection
          label="GITHUB COPILOT"
          value={
            integration
              ? integration.chatAvailable
                ? "Ready"
                : copilot?.extensionDetected
                  ? "Limited"
                  : "Unavailable"
              : copilot?.extensionDetected
                ? "Available"
                : "Unavailable"
          }
          detail={
            integration?.languageModelToolsAvailable
              ? "Keystone tools available"
              : integration?.assistedInvocationAvailable
                ? "Assisted mode required"
                : integration?.clipboardFallbackAvailable
                  ? "Clipboard fallback available"
                  : copilot?.directInvocationAvailable
                    ? "Direct invocation supported"
                    : "Workflow remains usable without Copilot"
          }
        />
      </div>
    </section>
  );
}

function Projection({
  label,
  value,
  detail,
  action,
  onOpen,
}: {
  label: string;
  value: string;
  detail: string;
  action?: string;
  onOpen?: () => void;
}): React.JSX.Element {
  const content = (
    <>
      <small>{label}</small>
      <h2>{value}</h2>
      <p>{detail}</p>
      {action && <span className="card-action">{action} →</span>}
    </>
  );
  return onOpen ? (
    <button
      className="status-card status-card-action"
      onClick={onOpen}
      aria-label={`${action}: ${value}`}
    >
      {content}
    </button>
  ) : (
    <article className="status-card">{content}</article>
  );
}
