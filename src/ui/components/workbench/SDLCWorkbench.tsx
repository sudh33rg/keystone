import { useCallback, useEffect, useState } from "react";
import type {
  DevelopmentSpecification,
  DevelopmentTask,
  DevelopmentWorkType,
  DevelopmentWorkflowSnapshot,
  RepositoryScopeSelection,
  TaskActionDescriptor,
} from "../../../shared/contracts/delegation";
import type {
  AppRoute,
  WorkbenchStage,
} from "../../../shared/contracts/domain";
import type {
  HandoffPackage,
  HandoffValidationResult,
  TaskAssignment,
  TeamParticipant,
} from "../../../shared/contracts/team";
import type {
  WorkbenchConstraintInput,
  WorkbenchCreateContext,
  WorkbenchDefineState,
  WorkbenchPlanState,
  WorkbenchStageState,
  WorkbenchWorkflowState,
} from "../../../shared/contracts/workbench";
import type { BuildTaskState } from "../../../shared/contracts/build";
import type { AssistedLaunchState, CopilotCustomizationRecord, CopilotIntegrationCapabilities, KeystoneToolDescriptor } from "../../../shared/contracts/copilotIntegration";
import type {
  CompletionState,
  WorkflowReviewState,
} from "../../../shared/contracts/review";
import {
  WORKBENCH_STAGES,
  parseWorkbenchRoute,
  workbenchRoute,
} from "../../../shared/navigation";
import type { HostBridge } from "../../services/HostBridge";
import { ExecutionValidationWorkspace } from "../execution/ExecutionValidationWorkspace";

const EXAMPLES: Record<DevelopmentWorkType, string> = {
  feature:
    "Add order cancellation with authorization checks and audit history.",
  bug: "Orders remain in pending status when payment confirmation arrives after a retry.",
  refactor:
    "Separate payment-provider logic from CheckoutService without changing behavior.",
  test: "Add regression coverage for retry ordering and duplicate payment confirmations.",
  modernization:
    "Replace the legacy payment adapter incrementally while preserving the public contract.",
  investigation:
    "Determine why payment confirmation processing occasionally stalls after a retry.",
};
const FALLBACK_DEFINITIONS = [
  {
    workType: "feature",
    label: "Feature",
    description:
      "Add user-visible behavior with specification, tests, and review.",
  },
  {
    workType: "bug",
    label: "Bug fix",
    description: "Repair incorrect behavior with regression evidence.",
  },
  {
    workType: "refactor",
    label: "Refactoring",
    description:
      "Improve internal structure without changing approved behavior.",
  },
  {
    workType: "test",
    label: "Test work",
    description: "Add or improve deterministic verification.",
  },
  {
    workType: "modernization",
    label: "Modernization",
    description:
      "Move toward an approved target while preserving compatibility.",
  },
  {
    workType: "investigation",
    label: "Investigation",
    description: "Produce bounded evidence before implementation.",
  },
] as const;

export function SDLCWorkbench({
  bridge,
  route,
  navigate,
}: {
  bridge: HostBridge;
  route: AppRoute;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const parsed = parseWorkbenchRoute(route);
  if (!parsed || parsed.kind === "new")
    return <StartNewWork bridge={bridge} navigate={navigate} />;
  return (
    <WorkbenchShell
      bridge={bridge}
      workflowId={parsed.workflowId!}
      stage={parsed.stage!}
      navigate={navigate}
    />
  );
}

function WorkbenchShell({
  bridge,
  workflowId,
  stage,
  navigate,
}: {
  bridge: HostBridge;
  workflowId: string;
  stage: WorkbenchStage;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [state, setState] = useState<WorkbenchWorkflowState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const refresh = async (): Promise<void> => {
    const next = await bridge.request("workbench/getWorkflow", { workflowId });
    if (!next)
      throw new Error(
        "Workflow not found. Your persisted data was not modified; return Home and choose another workflow.",
      );
    setState(next);
  };
  useEffect(() => {
    let active = true;
    void bridge
      .request("workbench/getWorkflow", { workflowId })
      .then((next) => {
        if (!active) return;
        if (!next)
          setError(
            "Workflow not found. Work was preserved; return Home and choose an available workflow. Diagnostic: WB-WORKFLOW-NOT-FOUND.",
          );
        else setState(next);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause, "WB-WORKFLOW-LOAD"));
      });
    return () => {
      active = false;
    };
  }, [bridge, workflowId]);
  useEffect(() => {
    if (!state || recovered) return;
    const requested = state.stageStates.find((item) => item.stage === stage);
    if (!requested || !["blocked", "unavailable"].includes(requested.status))
      return;
    const valid = state.summary.currentStage;
    void bridge
      .request("workbench/navigateStage", { workflowId, stage: valid })
      .then(() => {
        setRecovered(true);
        setNotice(
          `${stageLabel(stage)} was no longer available after recovery. Keystone restored ${stageLabel(valid)} and preserved the workflow. ${requested.blockers.map((item) => item.message).join(" ")}`,
        );
        navigate(workbenchRoute(workflowId, valid));
      })
      .catch((cause: unknown) => setError(message(cause, "WB-ROUTE-RECOVERY")));
  }, [bridge, navigate, recovered, stage, state, workflowId]);
  const go = async (target: WorkbenchStage): Promise<void> => {
    const projected = state?.stageStates.find((item) => item.stage === target);
    if (projected && ["blocked", "unavailable"].includes(projected.status)) {
      setNotice(
        `${stageLabel(target)} is ${projected.status}: ${projected.blockers.map((item) => `${item.message} ${item.recoveryAction}`).join(" ")}`,
      );
      return;
    }
    setBusy(true);
    try {
      await bridge.request("workbench/navigateStage", {
        workflowId,
        stage: target,
      });
      navigate(workbenchRoute(workflowId, target));
      setNotice(undefined);
    } catch (cause) {
      setNotice(message(cause, "WB-STAGE-NAVIGATION"));
    } finally {
      setBusy(false);
    }
  };
  if (error)
    return (
      <RecoveryState
        title="Workflow unavailable"
        detail={error}
        action="Return to Home or History and reopen a persisted workflow."
        onAction={() => navigate("/")}
      />
    );
  if (!state)
    return (
      <section className="loading-view" aria-live="polite">
        <div className="loader" />
        <p>Restoring workflow and recalculating stage readiness…</p>
      </section>
    );
  const workflow = state.workflow;
  return (
    <section className="workbench-shell">
      <WorkbenchHeader
        workflow={workflow}
        state={state}
        bridge={bridge}
        navigate={navigate}
      />
      {notice && (
        <div className="honesty-note" role="status">
          {notice}
        </div>
      )}
      <StageNavigation
        states={state.stageStates}
        active={stage}
        busy={busy}
        onNavigate={(target) => void go(target)}
      />
      <div className="workbench-layout">
        <main
          className="workbench-stage"
          aria-label={`${stageLabel(stage)} stage`}
        >
          {stage === "define" ? (
            <DefineStage
              bridge={bridge}
              workflowId={workflowId}
              onChanged={() => void refresh()}
              onContinue={() => void go("plan")}
            />
          ) : stage === "plan" ? (
            <PlanStage
              bridge={bridge}
              workflowId={workflowId}
              onChanged={() => void refresh()}
              onBack={() => void go("define")}
              onBuild={() => void go("build")}
            />
          ) : stage === "build" ? (
            <BuildStage bridge={bridge} workflow={workflow} />
          ) : stage === "validate" ? (
            <ExecutionValidationWorkspace
              bridge={bridge}
              workflowId={workflowId}
              onReturnToBuild={() => void go("build")}
            />
          ) : stage === "review" ? (
            <ReviewStage bridge={bridge} workflowId={workflowId} />
          ) : (
            <CompleteStage bridge={bridge} workflowId={workflowId} />
          )}
        </main>
        <WorkbenchContext state={state} />
      </div>
    </section>
  );
}

function WorkbenchHeader({
  workflow,
  state,
  bridge,
  navigate,
}: {
  workflow: DevelopmentWorkflowSnapshot;
  state: WorkbenchWorkflowState;
  bridge: HostBridge;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [copilot, setCopilot] = useState("Checking capability…");
  useEffect(() => {
    let active = true;
    void bridge
      .request("copilot/getIntegrationStatus", {})
      .then((value) => {
        if (active)
          setCopilot(
            value.chatAvailable
              ? `${value.directAgentInvocationAvailable ? "Copilot direct" : value.assistedInvocationAvailable ? "Copilot assisted" : "Copilot ready"}${value.languageModelToolsAvailable ? " · tools available" : ""}`
              : value.clipboardFallbackAvailable
                ? "Copilot limited · clipboard fallback"
                : "Copilot unavailable",
          );
      })
      .catch(() => {
        if (active) setCopilot("Copilot capability unknown");
      });
    return () => {
      active = false;
    };
  }, [bridge]);
  return (
    <header className="workbench-header">
      <div>
        <div className="eyebrow">
          {workflow.intent.workType
            ? workTypeLabel(workflow.intent.workType)
            : workflow.intent.category}{" "}
          · {state.repositoryName ?? "Active repository"}
        </div>
        <h1>
          {workflow.specification?.title ?? workflow.intent.normalizedObjective}
        </h1>
        <div className="workbench-metadata">
          <span>Repository {state.repositoryName ?? "available"}</span>
          <span>Branch {workflow.branch ?? "unknown"}</span>
          <span>Status {workflow.status}</span>
          <span>Intelligence {state.summary.intelligenceFreshness}</span>
          <span>{copilot}</span>
        </div>
      </div>
      <details className="workbench-overflow">
        <summary>Workflow actions</summary>
        <button onClick={() => navigate("/intelligence")}>
          Ask Repository Intelligence
        </button>
        <button onClick={() => navigate("/history")}>Open History</button>
        <button onClick={() => navigate("/workbench/new")}>
          Start new work
        </button>
      </details>
    </header>
  );
}

function StageNavigation({
  states,
  active,
  busy,
  onNavigate,
}: {
  states: WorkbenchStageState[];
  active: WorkbenchStage;
  busy: boolean;
  onNavigate: (stage: WorkbenchStage) => void;
}): React.JSX.Element {
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = WORKBENCH_STAGES.indexOf(active);
    const target =
      event.key === "Home"
        ? WORKBENCH_STAGES[0]
        : event.key === "End"
          ? WORKBENCH_STAGES.at(-1)
          : WORKBENCH_STAGES[
              Math.max(
                0,
                Math.min(
                  WORKBENCH_STAGES.length - 1,
                  index + (event.key === "ArrowRight" ? 1 : -1),
                ),
              )
            ];
    if (target) onNavigate(target);
  };
  return (
    <nav
      className="workbench-stages"
      aria-label="SDLC Workbench stages"
      onKeyDown={onKeyDown}
    >
      {states.map((item, index) => {
        const reasonId = `stage-${item.stage}-reason`;
        return (
          <div
            className={`workbench-stage-tab ${item.stage === active ? "active" : ""}`}
            key={item.stage}
          >
            <button
              aria-current={item.stage === active ? "step" : undefined}
              aria-describedby={reasonId}
              disabled={busy}
              onClick={() => onNavigate(item.stage)}
            >
              <span>{index + 1}</span>
              <strong>{stageLabel(item.stage)}</strong>
              <small>{item.status}</small>
            </button>
            <span id={reasonId} className="stage-reason">
              {item.blockers[0]?.message ??
                item.warnings[0] ??
                stageStatusDescription(item.status)}
            </span>
          </div>
        );
      })}
    </nav>
  );
}

function StartNewWork({
  bridge,
  navigate,
}: {
  bridge: HostBridge;
  navigate: (route: AppRoute) => void;
}): React.JSX.Element {
  const [context, setContext] = useState<WorkbenchCreateContext>();
  const [workType, setWorkType] = useState<DevelopmentWorkType>("feature");
  const [intent, setIntent] = useState("");
  const [scopeKind, setScopeKind] =
    useState<RepositoryScopeSelection["kind"]>("repository");
  const [paths, setPaths] = useState("");
  const [constraints, setConstraints] = useState<WorkbenchConstraintInput[]>(
    [],
  );
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void bridge
      .request("workbench/getCreateContext", {})
      .then((value) => {
        if (active) setContext(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause, "WB-CREATE-CONTEXT"));
      });
    return () => {
      active = false;
    };
  }, [bridge]);
  const definitions =
    context?.workflowDefinitions ??
    FALLBACK_DEFINITIONS.map((item) => ({
      ...item,
      definitionId: "inspect-after-create",
    }));
  const start = async (): Promise<void> => {
    if (!context?.repository.id) {
      setError(
        "No valid repository is available. Open a trusted repository and wait for Intelligence. Diagnostic: WB-NO-REPOSITORY.",
      );
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const repositoryScope: RepositoryScopeSelection = {
        kind: scopeKind,
        paths: scopeKind === "paths" ? splitPaths(paths) : [],
      };
      const workflow = await bridge.request("workbench/createWorkflow", {
        workType,
        intent: intent.trim(),
        repositoryScope,
        constraints,
        expectedRepositoryId: context.repository.id,
        expectedIntelligenceGeneration: context.intelligence.generation,
      });
      navigate(workbenchRoute(workflow.id, "define"));
    } catch (cause) {
      setError(message(cause, "WB-CREATE-WORKFLOW"));
    } finally {
      setBusy(false);
    }
  };
  const canStart = Boolean(
    context?.repository.available &&
    context.repository.trusted &&
    context.intelligence.status === "ready" &&
    intent.trim() &&
    (scopeKind !== "paths" || paths.trim()),
  );
  return (
    <section className="page workbench-new">
      <div className="eyebrow">
        Repository → Intelligence → Workflow → Tasks
      </div>
      <h1>Start new work</h1>
      <p>
        Create one durable workflow draft. Specification and tasks are generated
        only after explicit actions in Define and Plan.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <p>
            Your entered intent has not been discarded. Correct the issue and
            retry.
          </p>
        </div>
      )}
      <div className="create-context" aria-label="Repository context">
        <strong>{context?.repository.name ?? "No active repository"}</strong>
        <span>{context?.repository.branch ?? "No branch"}</span>
        <span>
          Intelligence {context?.intelligence.status ?? "checking"} · generation{" "}
          {context?.intelligence.generation ?? 0}
        </span>
        <span>
          {context?.repository.trusted
            ? "Trusted workspace"
            : "Workspace trust required"}
        </span>
        {context?.activeEditor && (
          <span>Active file: {context.activeEditor}</span>
        )}
      </div>
      <fieldset className="work-type-grid">
        <legend>Choose work type</legend>
        {definitions.map((item) => (
          <label
            className={workType === item.workType ? "selected" : ""}
            key={item.workType}
          >
            <input
              type="radio"
              name="work-type"
              value={item.workType}
              checked={workType === item.workType}
              onChange={() => setWorkType(item.workType)}
            />
            <strong>{item.label}</strong>
            <span>{item.description}</span>
          </label>
        ))}
      </fieldset>
      <label className="field-stack">
        <strong>Intent</strong>
        <textarea
          aria-label="Work intent"
          value={intent}
          onChange={(event) => setIntent(event.target.value)}
          placeholder={EXAMPLES[workType]}
          maxLength={50_000}
        />
        <small>Example: {EXAMPLES[workType]}</small>
      </label>
      <label className="field-stack">
        <strong>Repository scope</strong>
        <select
          aria-label="Repository scope"
          value={scopeKind}
          onChange={(event) =>
            setScopeKind(event.target.value as RepositoryScopeSelection["kind"])
          }
        >
          <option value="repository">Entire active repository</option>
          <option value="current-file" disabled={!context?.activeEditor}>
            Current editor file
          </option>
          <option value="paths">Selected modules or packages</option>
        </select>
      </label>
      {scopeKind === "paths" && (
        <textarea
          aria-label="Repository paths"
          value={paths}
          onChange={(event) => setPaths(event.target.value)}
          placeholder="src/orders, packages/payments"
        />
      )}
      <button
        className="text-button"
        aria-expanded={advanced}
        onClick={() => setAdvanced((value) => !value)}
      >
        Advanced constraints
      </button>
      {advanced && (
        <ConstraintEditor value={constraints} onChange={setConstraints} />
      )}
      <div aria-live="polite">
        {!canStart && context && (
          <p className="stage-reason">
            Starting requires a trusted repository, ready Intelligence, a
            non-empty intent, and valid selected scope.
          </p>
        )}
      </div>
      <button
        className="primary-button"
        disabled={busy || !canStart}
        onClick={() => void start()}
      >
        {busy ? "Starting…" : "Start workflow"}
      </button>
    </section>
  );
}

function ConstraintEditor({
  value,
  onChange,
}: {
  value: WorkbenchConstraintInput[];
  onChange: (value: WorkbenchConstraintInput[]) => void;
}): React.JSX.Element {
  const [kind, setKind] =
    useState<WorkbenchConstraintInput["kind"]>("compatibility");
  const [text, setText] = useState("");
  return (
    <section className="summary-card">
      <h2>Optional constraints</h2>
      <div className="button-row">
        <select
          aria-label="Constraint type"
          value={kind}
          onChange={(event) =>
            setKind(event.target.value as WorkbenchConstraintInput["kind"])
          }
        >
          <option value="avoid">Files or modules to avoid</option>
          <option value="framework">Required framework or pattern</option>
          <option value="compatibility">Backward compatibility</option>
          <option value="test">Test requirement</option>
          <option value="security">Security requirement</option>
          <option value="performance">Performance requirement</option>
          <option value="notes">User notes</option>
        </select>
        <input
          aria-label="Constraint value"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={5000}
        />
        <button
          disabled={!text.trim()}
          onClick={() => {
            onChange([...value, { kind, value: text.trim() }]);
            setText("");
          }}
        >
          Add
        </button>
      </div>
      {value.map((item, index) => (
        <div className="button-row" key={`${item.kind}:${index}`}>
          <span>
            {item.kind}: {item.value}
          </span>
          <button
            onClick={() =>
              onChange(value.filter((_, itemIndex) => itemIndex !== index))
            }
          >
            Remove
          </button>
        </div>
      ))}
    </section>
  );
}

function DefineStage({
  bridge,
  workflowId,
  onChanged,
  onContinue,
}: {
  bridge: HostBridge;
  workflowId: string;
  onChanged: () => void;
  onContinue: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<WorkbenchDefineState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = async (): Promise<void> => {
    const next = await bridge.request("workbench/getDefineState", {
      workflowId,
    });
    setState(next);
    onChanged();
  };
  useEffect(() => {
    let active = true;
    void bridge
      .request("workbench/getDefineState", { workflowId })
      .then((value) => {
        if (active) setState(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause, "WB-DEFINE-LOAD"));
      });
    return () => {
      active = false;
    };
  }, [bridge, workflowId]);
  const act = async (
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    setError(undefined);
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (cause) {
      setError(message(cause, "WB-DEFINE-ACTION"));
    }
  };
  if (!state) return <StageLoading error={error} />;
  const workflow = state.workflow;
  const spec = workflow.specification;
  return (
    <section className="stage-content">
      <StageHeading
        eyebrow="Define"
        title="Clarify and approve the behavioral contract"
        description="Repository evidence and deterministic rules support the draft. Unknown behavior remains explicit."
      />
      {error && <ErrorState value={error} />}{" "}
      {notice && (
        <p role="status" className="honesty-note">
          {notice}
        </p>
      )}
      <IntentEditor
        key={workflow.intent.revision}
        workflow={workflow}
        onSave={(text) =>
          act(
            () =>
              bridge.request("workbench/updateIntent", {
                workflowId,
                intent: text,
                reason: "User edited intent in Define",
              }),
            "Intent revision saved. Derived state was revalidated.",
          )
        }
      />
      <RepositoryUnderstanding
        bridge={bridge}
        state={state}
        onScope={(paths) =>
          act(
            () =>
              bridge.request("workbench/updateScope", {
                workflowId,
                repositoryScope: { kind: "paths", paths },
                reason: "User changed entity-backed repository scope",
              }),
            "Repository scope updated.",
          )
        }
      />
      <Clarifications
        state={state}
        onAnswer={(id, answer) =>
          act(
            () =>
              bridge.request("workbench/answerClarification", {
                workflowId,
                clarificationId: id,
                answer,
              }),
            "Clarification answer saved as a durable decision.",
          )
        }
        onDefer={(id) =>
          act(
            () =>
              bridge.request("workbench/deferClarification", {
                workflowId,
                clarificationId: id,
              }),
            "Clarification explicitly deferred.",
          )
        }
        onNotApplicable={(id) =>
          act(
            () =>
              bridge.request("workbench/markClarificationNotApplicable", {
                workflowId,
                clarificationId: id,
              }),
            "Clarification explicitly marked not applicable.",
          )
        }
        onReopen={(id) =>
          act(
            () =>
              bridge.request("workbench/reopenClarification", {
                workflowId,
                clarificationId: id,
              }),
            "Clarification reopened.",
          )
        }
      />
      {!spec ? (
        <section className="summary-card">
          <h2>Specification</h2>
          <p>
            No specification has been generated. Creation of the workflow did
            not approve or fabricate one.
          </p>
          <button
            className="primary-button"
            disabled={workflow.clarifications.some(
              (item) => item.blocking && item.status === "open",
            )}
            onClick={() =>
              void act(
                () =>
                  bridge.request("workbench/generateSpecification", {
                    workflowId,
                  }),
                "Specification draft generated.",
              )
            }
          >
            Generate specification
          </button>
        </section>
      ) : (
        <SpecificationEditor
          key={spec.revision}
          specification={spec}
          workflowId={workflowId}
          bridge={bridge}
          act={act}
        />
      )}{" "}
      {spec?.status === "approved" && (
        <button className="primary-button" onClick={onContinue}>
          Continue to Plan
        </button>
      )}
    </section>
  );
}

function IntentEditor({
  workflow,
  onSave,
}: {
  workflow: DevelopmentWorkflowSnapshot;
  onSave: (text: string) => Promise<void>;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(workflow.intent.originalText);
  return (
    <section className="summary-card">
      <header className="card-title">
        <div>
          <h2>Intent</h2>
          <p>
            Revision {workflow.intent.revision} · created{" "}
            {new Date(workflow.intent.createdAt).toLocaleString()}
          </p>
        </div>
        <button onClick={() => setEditing((value) => !value)}>
          {editing ? "Cancel edit" : "Edit intent"}
        </button>
      </header>
      {editing ? (
        <>
          <textarea
            aria-label="Edit workflow intent"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p>
            Saving creates a new intent revision and marks generated
            specification or plan state stale.
          </p>
          <button
            onClick={() => void onSave(text).then(() => setEditing(false))}
          >
            Save intent revision
          </button>
        </>
      ) : (
        <p>{workflow.intent.originalText}</p>
      )}
      <dl>
        <div>
          <dt>Work type</dt>
          <dd>
            {workflow.intent.workType
              ? workTypeLabel(workflow.intent.workType)
              : workflow.intent.category}
          </dd>
        </div>
        <div>
          <dt>Scope</dt>
          <dd>{workflow.intent.repositoryScope?.kind ?? "repository"}</dd>
        </div>
        <div>
          <dt>Constraints</dt>
          <dd>{workflow.intent.constraints.length}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{workflow.intent.risk}</dd>
        </div>
      </dl>
      {workflow.intent.constraints.map((item) => (
        <p key={item.description}>
          {item.description} · {item.provenance}
        </p>
      ))}
    </section>
  );
}

function RepositoryUnderstanding({
  bridge,
  state,
  onScope,
}: {
  bridge: HostBridge;
  state: WorkbenchDefineState;
  onScope: (paths: string[]) => Promise<void>;
}): React.JSX.Element {
  const currentPaths = state.workflow.intent.repositoryScope?.paths ?? [];
  const evidence = [
    ...state.repository.modules,
    ...state.repository.entities,
    ...state.repository.tests,
    ...state.repository.apisAndData,
  ].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.entityId === item.entityId) ===
      index,
  );
  return (
    <section className="summary-card">
      <header className="card-title">
        <div>
          <h2>Repository understanding</h2>
          <p>
            Generation {state.repository.generation} ·{" "}
            {state.repository.freshness}
          </p>
        </div>
        <button
          onClick={() =>
            void bridge.request("navigation/set", { route: "/intelligence" })
          }
        >
          Ask Repository
        </button>
      </header>
      {evidence.map((item) => (
        <article className="evidence-row" key={item.entityId}>
          <div>
            <strong>{item.name}</strong>
            <span>
              {item.type} · {item.classification} ·{" "}
              {Math.round(item.confidence * 100)}%
            </span>
            <p>{item.reason}</p>
          </div>
          <div className="button-row">
            {item.relativePath && (
              <button
                onClick={() =>
                  void bridge.request("intelligence/source/open", {
                    relativePath: item.relativePath!,
                  })
                }
              >
                Open source
              </button>
            )}
            <button
              onClick={() =>
                item.relativePath &&
                void onScope(
                  currentPaths.includes(item.relativePath)
                    ? currentPaths.filter((path) => path !== item.relativePath)
                    : [...currentPaths, item.relativePath],
                )
              }
              disabled={!item.relativePath}
            >
              {item.relativePath && currentPaths.includes(item.relativePath)
                ? "Remove from scope"
                : "Add to scope"}
            </button>
          </div>
        </article>
      ))}
      {!evidence.length && (
        <p>
          No exact entity was resolved. This is an explicit scope limitation,
          not an empty assurance.
        </p>
      )}
      {state.repository.limitations.map((item) => (
        <p className="stage-reason" key={item}>
          {item}
        </p>
      ))}
    </section>
  );
}

function Clarifications({
  state,
  onAnswer,
  onDefer,
  onNotApplicable,
  onReopen,
}: {
  state: WorkbenchDefineState;
  onAnswer: (id: string, answer: string) => Promise<void>;
  onDefer: (id: string) => Promise<void>;
  onNotApplicable: (id: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
}): React.JSX.Element {
  return (
    <section className="summary-card">
      <h2>Clarifications and decisions</h2>
      {state.clarifications.map((item) => (
        <Clarification
          key={item.id}
          item={item}
          onAnswer={onAnswer}
          onDefer={onDefer}
          onNotApplicable={onNotApplicable}
          onReopen={onReopen}
        />
      ))}
      {!state.clarifications.length && (
        <p>No deterministic clarification rule produced a question.</p>
      )}
      {state.workflow.decisions.map((item) => (
        <details key={item.id}>
          <summary>Decision: {item.title}</summary>
          <p>{item.decision}</p>
          <small>{item.evidenceReferences.length} evidence reference(s)</small>
        </details>
      ))}
    </section>
  );
}
function Clarification({
  item,
  onAnswer,
  onDefer,
  onNotApplicable,
  onReopen,
}: {
  item: WorkbenchDefineState["clarifications"][number];
  onAnswer: (id: string, answer: string) => Promise<void>;
  onDefer: (id: string) => Promise<void>;
  onNotApplicable: (id: string) => Promise<void>;
  onReopen: (id: string) => Promise<void>;
}): React.JSX.Element {
  const [answer, setAnswer] = useState(item.answer ?? "");
  return (
    <article className="clarification-card">
      <header>
        <strong>{item.question}</strong>
        <span>
          {item.status}
          {item.blocking ? " · blocking" : ""}
        </span>
      </header>
      <p>{item.whyItMatters}</p>
      <small>
        {item.evidenceReferences.length} repository evidence reference(s)
      </small>
      {item.options.length > 0 && (
        <div className="button-row">
          {item.options.map((option) => (
            <button key={option} onClick={() => setAnswer(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      {item.status === "open" ? (
        <>
          <textarea
            aria-label={`Answer: ${item.question}`}
            value={answer}
            onChange={(event) => setAnswer(event.target.value)}
          />
          <div className="button-row">
            <button
              disabled={!answer.trim()}
              onClick={() => void onAnswer(item.id, answer.trim())}
            >
              Answer
            </button>
            <button onClick={() => void onDefer(item.id)}>Defer</button>
            <button onClick={() => void onNotApplicable(item.id)}>
              Mark not applicable
            </button>
          </div>
        </>
      ) : (
        <div className="button-row">
          <span>
            {item.answer ??
              (item.status === "not-applicable"
                ? "Explicitly not applicable"
                : "No answer recorded")}
          </span>
          <button onClick={() => void onReopen(item.id)}>Reopen</button>
        </div>
      )}
    </article>
  );
}

function SpecificationEditor({
  specification,
  workflowId,
  bridge,
  act,
}: {
  specification: DevelopmentSpecification;
  workflowId: string;
  bridge: HostBridge;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
}): React.JSX.Element {
  const [objective, setObjective] = useState(specification.objective);
  const [requiredBehavior, setRequiredBehavior] = useState(
    specification.sections?.requiredBehavior ?? specification.objective,
  );
  const open = specification.sections?.openQuestions.length ?? 0;
  return (
    <section className="summary-card">
      <header className="card-title">
        <div>
          <h2>Specification</h2>
          <p>
            Revision {specification.revision} · {specification.status}
          </p>
        </div>
        <span>
          {specification.approval
            ? `Approved ${new Date(specification.approval.approvedAt).toLocaleString()}`
            : "Not approved"}
        </span>
      </header>
      <label className="field-stack">
        <strong>Objective</strong>
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <label className="field-stack">
        <strong>Required behavior</strong>
        <textarea
          value={requiredBehavior}
          onChange={(event) => setRequiredBehavior(event.target.value)}
        />
      </label>
      <button
        disabled={
          specification.status === "approved" &&
          objective === specification.objective &&
          requiredBehavior === specification.sections?.requiredBehavior
        }
        onClick={() =>
          void act(
            () =>
              bridge.request("workbench/updateSpecification", {
                workflowId,
                expectedRevision: specification.revision,
                reason: "User edited structured specification sections",
                patch: {
                  objective,
                  sections: {
                    currentBehavior:
                      specification.sections?.currentBehavior ?? "Unknown",
                    requiredBehavior,
                    errorBehavior:
                      specification.sections?.errorBehavior ?? "Unknown",
                    compatibility:
                      specification.sections?.compatibility ?? "Unknown",
                    security: specification.sections?.security ?? "Unknown",
                    performance:
                      specification.sections?.performance ?? "Unknown",
                    assumptions: specification.sections?.assumptions ?? [],
                    openQuestions: specification.sections?.openQuestions ?? [],
                  },
                },
              }),
            "Specification revision saved.",
          )
        }
      >
        Save specification revision
      </button>
      <SpecDetails specification={specification} />
      <div className="button-row">
        <button
          onClick={() =>
            void act(
              () =>
                bridge.request("workbench/generateAcceptanceCriteria", {
                  workflowId,
                }),
              "Acceptance criteria regenerated.",
            )
          }
        >
          Generate acceptance criteria
        </button>
        <button
          className="primary-button"
          disabled={open > 0 || specification.status === "approved"}
          onClick={() =>
            void act(
              () =>
                bridge.request("workbench/approveSpecification", {
                  workflowId,
                  expectedRevision: specification.revision,
                }),
              "Specification revision approved. Plan is ready.",
            )
          }
        >
          Approve specification
        </button>
      </div>
      {open > 0 && (
        <p className="stage-reason">
          Approval is blocked by {open} open specification question(s).
        </p>
      )}
    </section>
  );
}
function SpecDetails({
  specification,
}: {
  specification: DevelopmentSpecification;
}): React.JSX.Element {
  return (
    <div className="spec-sections">
      <details open>
        <summary>Requirements ({specification.requirements.length})</summary>
        {specification.requirements.map((item) => (
          <p key={item.id}>
            {item.id}: {item.description}
          </p>
        ))}
      </details>
      <details>
        <summary>
          Acceptance criteria ({specification.acceptanceCriteria.length})
        </summary>
        {specification.acceptanceCriteria.map((item) => (
          <p key={item.id}>
            {item.id} · {item.category ?? "behavior"} ·{" "}
            {item.blocking === false ? "non-blocking" : "blocking"}:{" "}
            {item.description} — verify: {item.validationMethod}
          </p>
        ))}
      </details>
      <details>
        <summary>Assumptions and unknowns</summary>
        {specification.sections?.assumptions.map((item) => (
          <p key={item}>{item}</p>
        ))}
        {specification.sections?.openQuestions.map((item) => (
          <p key={item}>Open: {item}</p>
        ))}
      </details>
    </div>
  );
}

function PlanStage({
  bridge,
  workflowId,
  onChanged,
  onBack,
  onBuild,
}: {
  bridge: HostBridge;
  workflowId: string;
  onChanged: () => void;
  onBack: () => void;
  onBuild: () => void;
}): React.JSX.Element {
  const [state, setState] = useState<WorkbenchPlanState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = async (): Promise<void> => {
    setState(await bridge.request("workbench/getPlanState", { workflowId }));
    onChanged();
  };
  useEffect(() => {
    let active = true;
    void bridge
      .request("workbench/getPlanState", { workflowId })
      .then((value) => {
        if (active) setState(value);
      })
      .catch((cause: unknown) => {
        if (active) setError(message(cause, "WB-PLAN-LOAD"));
      });
    return () => {
      active = false;
    };
  }, [bridge, workflowId]);
  const act = async (
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    try {
      await operation();
      setNotice(success);
      setError(undefined);
      await load();
    } catch (cause) {
      setError(message(cause, "WB-PLAN-ACTION"));
    }
  };
  if (!state) return <StageLoading error={error} />;
  const workflow = state.workflow;
  const graph = workflow.taskGraph;
  return (
    <section className="stage-content">
      <StageHeading
        eyebrow="Plan"
        title="Create and approve the executable task plan"
        description="Dependencies, coverage, routes, security/performance triggers, and validation are checked deterministically."
      />
      {error && <ErrorState value={error} />}{" "}
      {notice && (
        <p role="status" className="honesty-note">
          {notice}
        </p>
      )}
      <button onClick={onBack}>Return to Define</button>
      {!graph ? (
        <section className="summary-card">
          <h2>No task plan yet</h2>
          <p>
            Tasks are generated only after the approved specification and an
            explicit action.
          </p>
          <button
            className="primary-button"
            disabled={workflow.specification?.status !== "approved"}
            onClick={() =>
              void act(
                () =>
                  bridge.request("workbench/generateTaskPlan", { workflowId }),
                "Task-plan draft generated. No task was delegated.",
              )
            }
          >
            Generate task plan
          </button>
        </section>
      ) : (
        <>
          <PlanValidation state={state} />
          <TaskListEditor state={state} bridge={bridge} act={act} />
          <div className="button-row">
            <button
              onClick={() =>
                void act(
                  () =>
                    bridge.request("workbench/validateTaskPlan", {
                      workflowId,
                    }),
                  "Task-plan validation recalculated.",
                )
              }
            >
              Validate task plan
            </button>
            <button
              className="primary-button"
              disabled={!state.validation.valid || graph.status === "approved"}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("workbench/approveTaskPlan", {
                      workflowId,
                      expectedPlanRevision: graph.revision,
                    }),
                  "Task-plan revision approved. Build is ready; no Copilot delegation started.",
                )
              }
            >
              Approve task plan
            </button>
            {graph.status === "approved" && (
              <button className="primary-button" onClick={onBuild}>
                Start first task
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
function PlanValidation({
  state,
}: {
  state: WorkbenchPlanState;
}): React.JSX.Element {
  return (
    <section className="summary-card" aria-live="polite">
      <h2>Plan validation</h2>
      <p>
        {state.validation.valid
          ? "Ready for explicit approval"
          : "Approval blocked"}{" "}
        · revision {state.workflow.taskGraph?.revision ?? 0}
      </p>
      {state.validation.diagnostics.map((item) => (
        <p className={`diagnostic ${item.severity}`} key={item.id}>
          <strong>{item.code}</strong>: {item.message} {item.recoveryAction}
        </p>
      ))}
      <p>
        {state.validation.topologicalOrder.length} ordered task(s) ·{" "}
        {state.validation.uncoveredCriterionIds.length} uncovered
        criterion/criteria
      </p>
    </section>
  );
}
function TaskListEditor({
  state,
  bridge,
  act,
}: {
  state: WorkbenchPlanState;
  bridge: HostBridge;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
}): React.JSX.Element {
  const workflow = state.workflow;
  const revision = workflow.taskGraph!.revision;
  return (
    <section className="summary-card">
      <h2>Ordered dependency list</h2>
      {workflow.tasks.map((task, index) => (
        <TaskEditor
          key={task.id}
          task={task}
          index={index}
          allTasks={workflow.tasks}
          onSave={(patch) =>
            act(
              () =>
                bridge.request("workbench/updateTask", {
                  workflowId: workflow.id,
                  taskId: task.id,
                  expectedPlanRevision: revision,
                  patch,
                }),
              "Task updated; plan approval was invalidated.",
            )
          }
          onRemove={() =>
            act(
              () =>
                bridge.request("workbench/removeTask", {
                  workflowId: workflow.id,
                  taskId: task.id,
                  expectedPlanRevision: revision,
                }),
              "Task removed.",
            )
          }
          onReorder={(direction) =>
            act(
              () =>
                bridge.request("workbench/reorderTask", {
                  workflowId: workflow.id,
                  taskId: task.id,
                  direction,
                  expectedPlanRevision: revision,
                }),
              `Task moved ${direction}.`,
            )
          }
          onDependency={(dependencyId, action) =>
            act(
              () =>
                bridge.request("workbench/updateDependency", {
                  workflowId: workflow.id,
                  taskId: task.id,
                  dependencyId,
                  action,
                  expectedPlanRevision: revision,
                }),
              "Dependency updated and cycle detection rerun.",
            )
          }
        />
      ))}
      <AddTaskForm
        workflow={workflow}
        onAdd={(task) =>
          act(
            () =>
              bridge.request("workbench/addTask", {
                workflowId: workflow.id,
                expectedPlanRevision: revision,
                task,
              }),
            "Task added; plan approval was invalidated.",
          )
        }
      />
    </section>
  );
}
function TaskEditor({
  task,
  index,
  allTasks,
  onSave,
  onRemove,
  onReorder,
  onDependency,
}: {
  task: DevelopmentTask;
  index: number;
  allTasks: DevelopmentTask[];
  onSave: (patch: Partial<DevelopmentTask>) => Promise<void>;
  onRemove: () => Promise<void>;
  onReorder: (direction: "up" | "down") => Promise<void>;
  onDependency: (id: string, action: "add" | "remove") => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState(task.title);
  const [objective, setObjective] = useState(task.objective);
  const [category, setCategory] = useState(task.category);
  const [route, setRoute] = useState(task.executionRoute ?? "manual");
  const [optional, setOptional] = useState(task.optional ?? false);
  const [validation, setValidation] = useState(
    task.validationSteps
      .map((item) => item.command ?? item.manualCheck)
      .filter(Boolean)
      .join("\n"),
  );
  const dependency = allTasks.find(
    (item) => item.id !== task.id && !task.dependencies.includes(item.id),
  );
  return (
    <article className="task-plan-card">
      <header>
        <span>{index + 1}</span>
        <strong>{task.title}</strong>
        <small>
          {task.status} · {task.risk ?? "medium"} risk ·{" "}
          {task.optional ? "optional" : "required"}
        </small>
      </header>
      <label>
        Title
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Objective
        <textarea
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <label>
        Validation steps
        <textarea
          aria-label={`Validation for ${task.title}`}
          value={validation}
          onChange={(event) => setValidation(event.target.value)}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={optional}
          onChange={(event) => setOptional(event.target.checked)}
        />{" "}
        Optional task
      </label>
      <div className="button-row">
        <select
          aria-label={`Category for ${task.title}`}
          value={category}
          onChange={(event) =>
            setCategory(event.target.value as DevelopmentTask["category"])
          }
        >
          {[
            "investigation",
            "implementation",
            "testing",
            "validation",
            "review",
            "security",
            "performance",
            "documentation",
            "manual",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label={`Execution route for ${task.title}`}
          value={route}
          onChange={(event) =>
            setRoute(
              event.target.value as NonNullable<
                DevelopmentTask["executionRoute"]
              >,
            )
          }
        >
          <option value="deterministic">deterministic</option>
          <option value="github-copilot">github-copilot</option>
          <option value="manual">manual</option>
          <option value="unsupported">unsupported</option>
        </select>
        <button
          onClick={() =>
            void onSave({
              title,
              objective,
              category,
              executionRoute: route,
              optional,
              validationSteps: splitPaths(validation).map((manualCheck) => ({
                manualCheck,
              })),
            })
          }
        >
          Save task
        </button>
        <button disabled={index === 0} onClick={() => void onReorder("up")}>
          Move up
        </button>
        <button
          disabled={index === allTasks.length - 1}
          onClick={() => void onReorder("down")}
        >
          Move down
        </button>
        <button onClick={() => void onRemove()}>Remove task</button>
      </div>
      <p>
        Requirements: {task.requirementIds.join(", ")} · Criteria:{" "}
        {task.acceptanceCriterionIds.join(", ")}
      </p>
      <div className="button-row">
        {task.dependencies.map((id) => (
          <button key={id} onClick={() => void onDependency(id, "remove")}>
            Remove dependency:{" "}
            {allTasks.find((item) => item.id === id)?.title ?? id}
          </button>
        ))}
        {dependency && (
          <button onClick={() => void onDependency(dependency.id, "add")}>
            Add dependency: {dependency.title}
          </button>
        )}
      </div>
    </article>
  );
}
type AddTaskInput = Pick<
  DevelopmentTask,
  | "title"
  | "objective"
  | "description"
  | "category"
  | "requirementIds"
  | "acceptanceCriterionIds"
  | "expectedFiles"
  | "expectedEntityIds"
  | "validationSteps"
  | "executionRoute"
  | "risk"
  | "optional"
>;
function AddTaskForm({
  workflow,
  onAdd,
}: {
  workflow: DevelopmentWorkflowSnapshot;
  onAdd: (task: AddTaskInput) => Promise<void>;
}): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const specification = workflow.specification!;
  const requirement = specification.requirements[0];
  const criterion = specification.acceptanceCriteria[0];
  const submit = (): void => {
    if (!title.trim() || !objective.trim() || !requirement || !criterion)
      return;
    void onAdd({
      title: title.trim(),
      objective: objective.trim(),
      description: objective.trim(),
      category: "implementation",
      requirementIds: [requirement.id],
      acceptanceCriterionIds: [criterion.id],
      expectedFiles: specification.scope.expectedFiles,
      expectedEntityIds: specification.scope.entityIds,
      validationSteps: [{ manualCheck: `Verify ${criterion.description}` }],
      executionRoute: "github-copilot",
      risk: "medium",
      optional: false,
    }).then(() => {
      setTitle("");
      setObjective("");
    });
  };
  return (
    <details className="task-plan-card">
      <summary>Add task</summary>
      <label>
        Task title
        <input
          aria-label="New task title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <label>
        Objective
        <textarea
          aria-label="New task objective"
          value={objective}
          onChange={(event) => setObjective(event.target.value)}
        />
      </label>
      <button
        disabled={
          !title.trim() || !objective.trim() || !requirement || !criterion
        }
        onClick={submit}
      >
        Add task to plan
      </button>
    </details>
  );
}

function BuildStage({
  bridge,
  workflow,
}: {
  bridge: HostBridge;
  workflow: DevelopmentWorkflowSnapshot;
}): React.JSX.Element {
  const [state, setState] = useState<BuildTaskState>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);
  const load = async (taskId?: string): Promise<void> => {
    const target =
      taskId ??
      state?.task.id ??
      workflow.tasks.find((task) => task.status === "ready")?.id ??
      workflow.tasks[0]?.id;
    if (!target) return;
    setState(
      await bridge.request("build/getTaskState", {
        workflowId: workflow.id,
        taskId: target,
      }),
    );
  };
  useEffect(() => {
    let active = true;
    const target =
      workflow.tasks.find((task) => task.status === "ready")?.id ??
      workflow.tasks[0]?.id;
    if (target)
      void bridge
        .request("build/getTaskState", {
          workflowId: workflow.id,
          taskId: target,
        })
        .then((value) => {
          if (active) setState(value);
        })
        .catch((cause: unknown) => {
          if (active) setError(message(cause, "BUILD-LOAD"));
        });
    return () => {
      active = false;
    };
  }, [bridge, workflow.id, workflow.tasks]);
  const act = async (
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      await operation();
      setNotice(success);
      await load();
    } catch (cause) {
      setError(message(cause, "BUILD-ACTION"));
    } finally {
      setBusy(false);
    }
  };
  if (!workflow.tasks.length)
    return (
      <RecoveryState
        title="No Build tasks"
        detail="The approved plan contains no user tasks."
        action="Return to Plan"
        onAction={() => undefined}
      />
    );
  if (!state) return <StageLoading error={error} />;
  return (
    <section className="stage-content">
      <StageHeading
        eyebrow="Build"
        title="Task-centered execution workspace"
        description="Readiness, context, delegation, observed changes, validation, retry, and continuity use canonical persisted services."
      />
      {error && <ErrorState value={error} />}{" "}
      {notice && (
        <p className="honesty-note" role="status">
          {notice}
        </p>
      )}
      <div className="build-grid">
        <BuildTaskQueue
          state={state}
          busy={busy}
          select={(taskId) =>
            void act(
              () =>
                bridge
                  .request("build/selectTask", {
                    workflowId: workflow.id,
                    taskId,
                    specificationRevision:
                      state.workflow.specification!.revision,
                    intelligenceGeneration:
                      state.workflow.intelligenceGeneration,
                  })
                  .then(setState),
              "Task selected and readiness refreshed.",
            )
          }
        />
        <div className="build-active">
          <BuildTaskDetails
            state={state}
            busy={busy}
            act={act}
            bridge={bridge}
          />
          <BuildCopilotContext
            state={state}
            busy={busy}
            act={act}
            bridge={bridge}
          />
          <BuildExecutionControls
            state={state}
            busy={busy}
            act={act}
            bridge={bridge}
          />
        </div>
        <BuildChangesValidation
          state={state}
          busy={busy}
          act={act}
          bridge={bridge}
        />
      </div>
    </section>
  );
}
function BuildTaskQueue({
  state,
  busy,
  select,
}: {
  state: BuildTaskState;
  busy: boolean;
  select: (id: string) => void;
}): React.JSX.Element {
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [route, setRoute] = useState("all");
  const [owner, setOwner] = useState("all");
  const [blocking, setBlocking] = useState("all");
  const groups = [
    "ready",
    "in-progress",
    "blocked",
    "awaiting-validation",
    "awaiting-review",
    "completed",
  ] as const;
  const categories = [
    ...new Set(state.queue.items.map((item) => item.task.category)),
  ].sort();
  const statuses = [
    ...new Set(state.queue.items.map((item) => item.task.status)),
  ].sort();
  const routes = [
    ...new Set(
      state.queue.items.map((item) => item.task.executionRoute ?? "manual"),
    ),
  ].sort();
  const owners = [
    ...new Set(
      state.queue.items
        .map((item) => item.owner)
        .filter((item): item is string => Boolean(item)),
    ),
  ].sort();
  const visibleItems = state.queue.items.filter(
    (item) =>
      (category === "all" || item.task.category === category) &&
      (status === "all" || item.task.status === status) &&
      (route === "all" || (item.task.executionRoute ?? "manual") === route) &&
      (owner === "all" || item.owner === owner) &&
      (blocking === "all" ||
        (blocking === "blocked") === Boolean(item.blockerSummary)),
  );
  return (
    <aside
      className="build-queue"
      aria-label="Task queue"
      onKeyDown={(event) => {
        if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
        const index = visibleItems.findIndex(
          (item) => item.task.id === state.task.id,
        );
        const next =
          visibleItems[
            Math.max(
              0,
              Math.min(
                visibleItems.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            )
          ];
        if (next) select(next.task.id);
      }}
    >
      <details>
        <summary>Queue filters</summary>
        <label>
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">All</option>
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">All</option>
            {statuses.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Route
          <select
            value={route}
            onChange={(event) => setRoute(event.target.value)}
          >
            <option value="all">All</option>
            {routes.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Owner
          <select
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            <option value="all">All</option>
            {owners.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label>
          Blocking
          <select
            value={blocking}
            onChange={(event) => setBlocking(event.target.value)}
          >
            <option value="all">All</option>
            <option value="blocked">Blocked only</option>
            <option value="clear">Not blocked</option>
          </select>
        </label>
      </details>
      {groups.map((group) => {
        const items = visibleItems.filter((item) => item.group === group);
        return items.length ? (
          <section key={group}>
            <h3>
              {group.replace(/-/g, " ")} ({items.length})
            </h3>
            {items.map((item) => (
              <button
                className={item.task.id === state.task.id ? "selected" : ""}
                aria-current={item.task.id === state.task.id}
                disabled={busy}
                key={item.task.id}
                onClick={() => select(item.task.id)}
              >
                <strong>{item.task.title}</strong>
                <span>
                  {item.task.category} · {item.task.executionRoute ?? "manual"}
                </span>
                <small>
                  {item.validationSummary}
                  {item.blockerSummary ? ` · ${item.blockerSummary}` : ""}
                </small>
              </button>
            ))}
          </section>
        ) : null;
      })}
    </aside>
  );
}
function BuildTaskDetails({
  state,
  busy,
  act,
  bridge,
}: {
  state: BuildTaskState;
  busy: boolean;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: HostBridge;
}): React.JSX.Element {
  const task = state.task;
  const spec = state.workflow.specification!;
  const [blockReason, setBlockReason] = useState("");
  const [blockCategory, setBlockCategory] = useState<
    | "decision"
    | "dependency"
    | "external"
    | "repository"
    | "validation"
    | "other"
  >("other");
  const [blockDecision, setBlockDecision] = useState("");
  const [blockAction, setBlockAction] = useState("");
  const requirements = spec.requirements.filter((item) =>
    task.requirementIds.includes(item.id),
  );
  const criteria = spec.acceptanceCriteria.filter((item) =>
    task.acceptanceCriterionIds.includes(item.id),
  );
  return (
    <section className="summary-card">
      <header className="card-title">
        <div>
          <h2>{task.title}</h2>
          <p>
            {task.category} · {task.status} · {task.risk ?? "medium"} risk
          </p>
        </div>
        <span>{state.nextAction}</span>
      </header>
      <p>{task.objective}</p>
      <details open>
        <summary>
          Readiness ({state.readiness.filter((item) => item.passed).length}/
          {state.readiness.length})
        </summary>
        {state.readiness.map((item) => (
          <p
            className={`diagnostic ${item.passed ? "info" : "error"}`}
            key={item.code}
          >
            <strong>
              {item.passed ? "Pass" : "Blocked"}: {item.label}
            </strong>{" "}
            — {item.explanation} {!item.passed && item.recoveryAction}
          </p>
        ))}
      </details>
      <details>
        <summary>Requirements and acceptance criteria</summary>
        {requirements.map((item) => (
          <p key={item.id}>
            {item.id}: {item.description}
          </p>
        ))}
        {criteria.map((item) => (
          <p key={item.id}>
            {item.id}: {item.description} — {item.validationMethod}
          </p>
        ))}
      </details>
      <details>
        <summary>Scope and dependencies</summary>
        <p>Included: {spec.scope.included.join(" · ")}</p>
        <p>Excluded: {spec.scope.excluded.join(" · ")}</p>
        <p>
          Expected files: {task.expectedFiles.join(", ") || "No path assumed"}
        </p>
        <p>
          Expected entities:{" "}
          {task.expectedEntityIds.join(", ") || "No exact entity"}
        </p>
        <p>
          Dependencies:{" "}
          {task.dependencies
            .map(
              (id) =>
                state.workflow.tasks.find((item) => item.id === id)?.title ??
                id,
            )
            .join(", ") || "None"}
        </p>
      </details>
      <div className="button-row">
        <button
          disabled={
            busy ||
            !state.readiness.every((item) => item.passed || !item.blocking)
          }
          onClick={() =>
            void act(
              () =>
                bridge
                  .request("build/startTask", {
                    workflowId: state.workflow.id,
                    taskId: task.id,
                  })
                  .then(setNoop),
              "Task started; repository baseline captured. No delegation started.",
            )
          }
        >
          Start task
        </button>
        <button
          disabled={
            busy ||
            !["delegating", "executing", "blocked"].includes(task.status)
          }
          onClick={() =>
            void act(
              () =>
                bridge
                  .request(
                    task.status === "blocked"
                      ? "build/resumeTask"
                      : "build/pauseTask",
                    { workflowId: state.workflow.id, taskId: task.id },
                  )
                  .then(setNoop),
              task.status === "blocked"
                ? "Task resumed after readiness checks."
                : "Task paused with state preserved.",
            )
          }
        >
          {task.status === "blocked" ? "Resume" : "Pause"}
        </button>
        <button
          disabled={busy}
          onClick={() =>
            void act(
              () =>
                bridge
                  .request("build/cancelTask", {
                    workflowId: state.workflow.id,
                    taskId: task.id,
                  })
                  .then(setNoop),
              "Task cancelled without Git actions.",
            )
          }
        >
          Cancel
        </button>
      </div>
      <details>
        <summary>Mark blocked</summary>
        <label className="field-stack">
          Reason
          <textarea
            value={blockReason}
            maxLength={2_000}
            onChange={(event) => setBlockReason(event.target.value)}
          />
        </label>
        <label>
          Category
          <select
            value={blockCategory}
            onChange={(event) =>
              setBlockCategory(event.target.value as typeof blockCategory)
            }
          >
            <option value="decision">Decision</option>
            <option value="dependency">Dependency</option>
            <option value="external">External</option>
            <option value="repository">Repository</option>
            <option value="validation">Validation</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field-stack">
          Required decision (optional)
          <textarea
            value={blockDecision}
            maxLength={2_000}
            onChange={(event) => setBlockDecision(event.target.value)}
          />
        </label>
        <label className="field-stack">
          Suggested next action
          <textarea
            value={blockAction}
            maxLength={2_000}
            onChange={(event) => setBlockAction(event.target.value)}
          />
        </label>
        <button
          disabled={
            busy ||
            task.status === "completed" ||
            !blockReason.trim() ||
            !blockAction.trim()
          }
          onClick={() =>
            void act(
              () =>
                bridge
                  .request("build/blockTask", {
                    workflowId: state.workflow.id,
                    taskId: task.id,
                    reason: blockReason.trim(),
                    category: blockCategory,
                    ...(blockDecision.trim()
                      ? { requiredDecision: blockDecision.trim() }
                      : {}),
                    suggestedAction: blockAction.trim(),
                  })
                  .then(setNoop),
              "Task blocked with a durable reason; downstream readiness was recalculated.",
            )
          }
        >
          Confirm blocker
        </button>
      </details>
    </section>
  );
}
function BuildCopilotContext({
  state,
  busy,
  act,
  bridge,
}: {
  state: BuildTaskState;
  busy: boolean;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: HostBridge;
}): React.JSX.Element {
  const task = state.task;
  const [budget, setBudget] = useState(
    state.context?.budget.maxEstimatedTokens ?? 12_000,
  );
  const [intendedAgent, setIntendedAgent] = useState("");
  const [integration, setIntegration] = useState<CopilotIntegrationCapabilities>();
  const [guidance, setGuidance] = useState<CopilotCustomizationRecord[]>([]);
  const [tools, setTools] = useState<KeystoneToolDescriptor[]>([]);
  const [launch, setLaunch] = useState<AssistedLaunchState>();
  useEffect(() => { let active = true; const scope = { repositoryId: state.workflow.repositoryId, workflowId: state.workflow.id, taskId: task.id, intelligenceGeneration: state.workflow.intelligenceGeneration }; void Promise.all([bridge.request("copilot/getIntegrationStatus", {}), bridge.request("copilot/getApplicableCustomizations", scope), bridge.request("copilot/listKeystoneTools", {})]).then(([capabilities, items, descriptors]) => { if (active) { setIntegration(capabilities); setGuidance(items); setTools(descriptors); } }).catch(() => undefined); return () => { active = false; }; }, [bridge, state.workflow.id, state.workflow.intelligenceGeneration, state.workflow.repositoryId, task.id]);
  return (
    <section className="summary-card">
      <h2>Copilot and context</h2>
      <p>
        {state.capabilities?.extensionDetected
          ? state.capabilities.directInvocationAvailable
            ? "Direct invocation available"
            : state.capabilities.promptInsertionAvailable
              ? "Assisted prompt insertion available"
              : "Clipboard fallback available"
          : "Copilot unavailable; context and manual work remain available"}
      </p>
      <div className="capability-strip" role="status" aria-label="Copilot integration capabilities">
        <span>{integration?.chatAvailable ? "Copilot ready" : "Copilot limited"}</span>
        <span>{integration?.languageModelToolsAvailable ? `${tools.filter((item) => item.available).length} tools available` : "Tools unavailable"}</span>
        <span>{guidance.filter((item) => item.kind === "agent").length} agent definitions</span>
        <span>{guidance.filter((item) => item.applicable && item.enabled).length} guidance items active</span>
        <span>{integration?.assistedInvocationAvailable ? "Assisted mode available" : integration?.clipboardFallbackAvailable ? "Clipboard fallback" : "Launch unavailable"}</span>
      </div>
      {integration?.limitations.map((item) => <p className="stage-reason" key={item}>{item}</p>)}
      <div className="agent-grid">
        {state.agents.map((agent) => (
          <button
            disabled={busy || agent.availability === "unavailable"}
            className={task.assignedAgentId === agent.id ? "selected" : ""}
            key={agent.id}
            onClick={() =>
              void act(
                () =>
                  bridge.request("copilot/selectAgent", {
                    workflowId: state.workflow.id,
                    taskId: task.id,
                    agentId: agent.id,
                    confirmed: true,
                  }),
                "Agent selection persisted.",
              )
            }
          >
            <strong>{agent.displayName}</strong>
            <small>
              {agent.availability} · {agent.capabilities.join(", ")}
            </small>
          </button>
        ))}
      </div>
      <div className="button-row">
        <label>
          Intended agent label
          <input
            value={intendedAgent}
            maxLength={200}
            onChange={(event) => setIntendedAgent(event.target.value)}
            placeholder="Unverified agent label"
          />
        </label>
        <button
          disabled={busy || !intendedAgent.trim()}
          onClick={() =>
            void act(
              () =>
                bridge.request("build/selectAgent", {
                  workflowId: state.workflow.id,
                  taskId: task.id,
                  intendedAgentLabel: intendedAgent.trim(),
                  confirmed: true,
                }),
              "Unverified intended agent label persisted. Keystone will use only assisted or clipboard delegation and cannot verify that agent.",
            )
          }
        >
          Use intended label
        </button>
      </div>
      <details>
        <summary>
          Repository guidance (
          {state.customizations.filter((item) => item.selected).length}{" "}
          selected)
        </summary>
        {state.customizations.map((item) => (
          <label className="context-row" key={item.id}>
            <input
              type="checkbox"
              checked={item.selected}
              disabled={busy || !item.enabled || !item.applicable}
              onChange={(event) =>
                void act(
                  () =>
                    bridge.request("build/updateCustomizationSelection", {
                      workflowId: state.workflow.id,
                      taskId: task.id,
                      customizationId: item.id,
                      selected: event.target.checked,
                    }),
                  "Customization selection changed; context requires regeneration.",
                )
              }
            />
            <span>
              <strong>{item.name}</strong> · {item.kind} · {item.trustState}
              <small>{item.applicabilityReason}</small>
            </span>
          </label>
        ))}
      </details>
      <details>
        <summary>Customization applicability and trust ({guidance.length})</summary>
        {guidance.map((item) => <div className="context-row" key={item.id}><div><strong>{item.name}</strong><span>{item.kind} · {item.source} · {item.trustState} · {item.applicability}</span><small>{item.applicabilityReason}</small>{item.duplicateOf && <small>Duplicate of {item.duplicateOf}; excluded from prompt duplication.</small>}</div><button aria-pressed={item.enabled} disabled={busy || item.trustState === "untrusted"} onClick={() => void act(async () => { const values = await bridge.request("copilot/setCustomizationEnabled", { repositoryId: state.workflow.repositoryId, workflowId: state.workflow.id, taskId: task.id, intelligenceGeneration: state.workflow.intelligenceGeneration, customizationId: item.id, enabled: !item.enabled }); setGuidance(values); }, `${item.name} ${item.enabled ? "disabled" : "enabled"}.`)}>{item.enabled ? "Disable" : "Enable"}</button></div>)}
      </details>
      <details>
        <summary>Keystone Intelligence tools ({tools.filter((item) => item.available).length} available)</summary>
        <p>All registered tools are read-only, bounded, generation-aware, cancellable, and audited without prompt or source bodies.</p>
        <ul>{tools.map((item) => <li key={item.name}><strong>{item.name}</strong> — {item.available ? item.description : item.limitation}</li>)}</ul>
      </details>
      <section className="subpanel" aria-live="polite">
        <h3>Assisted Copilot launch</h3>
        <p>Prepare and review the exact prompt first. Opening or copying never claims submission; confirm only after you submit it yourself.</p>
        {!launch ? <button disabled={busy || !task.assignedAgentId} onClick={() => void act(async () => { const value = await bridge.request("copilot/prepareAssistedLaunch", { repositoryId: state.workflow.repositoryId, workflowId: state.workflow.id, taskId: task.id, intelligenceGeneration: state.workflow.intelligenceGeneration, ...(task.assignedAgentId ? { selectedAgentId: task.assignedAgentId } : {}) }); setLaunch(value); }, "Assisted launch prepared for review; nothing was submitted.")}>Prepare assisted launch</button> : <><p><strong>Status:</strong> {launch.status} · fingerprint {launch.promptFingerprint.slice(0, 20)}…</p><textarea aria-label="Prepared Copilot prompt" readOnly value={launch.prompt} rows={12} /><div className="button-row"><button disabled={busy || !integration?.chatAvailable} onClick={() => void act(async () => setLaunch(await bridge.request("copilot/openChat", { launchId: launch.id })), "Copilot Chat opened; submission is still awaiting your confirmation.")}>Open Copilot Chat</button><button disabled={busy || !integration?.clipboardFallbackAvailable} onClick={() => void act(async () => setLaunch(await bridge.request("copilot/copyPrompt", { launchId: launch.id })), "Prompt copied; submission is still awaiting your confirmation.")}>Copy prompt</button><button disabled={busy || !["opened", "copied", "uncertain"].includes(launch.status)} onClick={() => void act(async () => setLaunch(await bridge.request("copilot/confirmSubmission", { launchId: launch.id })), "User submission confirmation recorded; Keystone did not infer Copilot progress.")}>I submitted it</button><button disabled={busy || launch.status === "confirmed"} onClick={() => void act(async () => setLaunch(await bridge.request("copilot/cancelAssistedLaunch", { launchId: launch.id })), "Assisted launch cancelled.")}>Cancel</button></div></>}
      </section>
      {!state.context ? (
        <button
          disabled={busy || !task.assignedAgentId}
          onClick={() =>
            void act(
              () =>
                bridge.request("context/build", {
                  workflowId: state.workflow.id,
                  taskId: task.id,
                }),
              "Deterministic context package built.",
            )
          }
        >
          Build context
        </button>
      ) : (
        <>
          <p>
            {state.context.estimatedTokens} estimated tokens /{" "}
            {state.context.budget.maxEstimatedTokens} ·{" "}
            {state.context.completeness} ·{" "}
            {state.context.reviewed ? "approved" : "review required"}
          </p>
          {state.context.items.map((item) => (
            <article className="context-row" tabIndex={0} key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <span>
                  {item.kind} · {item.tier} · {item.confidence * 100}%
                </span>
                <small>
                  {item.reason} · {item.estimatedTokens} tokens
                </small>
              </div>
              <div className="button-row">
                <button
                  onClick={() =>
                    void act(
                      () =>
                        bridge.request(
                          item.pinned ? "context/unpinItem" : "context/pinItem",
                          { taskId: task.id, itemId: item.id },
                        ),
                      item.pinned
                        ? "Context item unpinned."
                        : "Context item pinned.",
                    )
                  }
                >
                  {item.pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  disabled={item.required}
                  onClick={() =>
                    void act(
                      () =>
                        bridge.request("context/removeItem", {
                          taskId: task.id,
                          itemId: item.id,
                        }),
                      "Optional context item excluded.",
                    )
                  }
                >
                  Exclude
                </button>
                {item.relativePath && (
                  <button
                    onClick={() =>
                      void bridge.request("intelligence/source/open", {
                        relativePath: item.relativePath!,
                      })
                    }
                  >
                    Open
                  </button>
                )}
              </div>
            </article>
          ))}
          <div className="button-row">
            <button
              disabled={state.context.reviewed}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("context/validate", {
                      taskId: task.id,
                      contentFingerprint: state.context!.contentFingerprint,
                    }),
                  "Context fingerprint approved.",
                )
              }
            >
              Approve context
            </button>
            <button
              disabled={!state.context.reviewed || !task.assignedAgentId}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("delegation/prepare", {
                      workflowId: state.workflow.id,
                      taskId: task.id,
                      userSections: {
                        repositoryGuidance: state.customizations
                          .filter((item) => item.selected)
                          .map(
                            (item) =>
                              `${item.kind}: ${item.sourcePath ?? item.name} — ${item.applicabilityReason ?? "user selected"}`,
                          )
                          .join("\n"),
                      },
                    }),
                  "Exact delegation prompt prepared for review.",
                )
              }
            >
              Prepare prompt
            </button>
            <label>
              Token budget
              <input
                type="number"
                min={1_000}
                max={1_000_000}
                value={budget}
                onChange={(event) => setBudget(Number(event.target.value))}
              />
            </label>
            <button
              disabled={
                busy || budget === state.context.budget.maxEstimatedTokens
              }
              onClick={() =>
                void act(
                  () =>
                    bridge.request("context/changeBudget", {
                      workflowId: state.workflow.id,
                      taskId: task.id,
                      budget: { maxEstimatedTokens: budget },
                    }),
                  "Context rebuilt under the selected bounded token budget; preserved pins were reconsidered.",
                )
              }
            >
              Apply budget
            </button>
          </div>
          {state.context.exclusions.length > 0 && (
            <details>
              <summary>
                Excluded context ({state.context.exclusions.length})
              </summary>
              {state.context.exclusions.map((entry) => (
                <article className="context-row" key={entry.item.id}>
                  <span>
                    <strong>{entry.item.title}</strong> · {entry.reason}
                  </span>
                  <button
                    disabled={busy || !entry.restorable}
                    onClick={() =>
                      void act(
                        () =>
                          bridge.request("context/update", {
                            taskId: task.id,
                            itemId: entry.item.id,
                          }),
                        "Excluded context item restored and the package fingerprint changed.",
                      )
                    }
                  >
                    Restore
                  </button>
                </article>
              ))}
            </details>
          )}
        </>
      )}
      {state.prepared && (
        <details open>
          <summary>Prompt preview · {state.prepared.promptFingerprint}</summary>
          <pre className="prompt-preview">{state.prepared.prompt}</pre>
          <button
            disabled={state.prepared.approved}
            onClick={() =>
              void act(
                () =>
                  bridge.request("delegation/approve", {
                    taskId: task.id,
                    promptFingerprint: state.prepared!.promptFingerprint,
                    contextFingerprint: state.prepared!.contextFingerprint,
                  }),
                "Delegation explicitly approved; execution has not started.",
              )
            }
          >
            Approve delegation
          </button>
        </details>
      )}
    </section>
  );
}
function BuildExecutionControls({
  state,
  busy,
  act,
  bridge,
}: {
  state: BuildTaskState;
  busy: boolean;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: HostBridge;
}): React.JSX.Element {
  const [notes, setNotes] = useState("");
  const delegation = state.delegationSession;
  const execution = state.execution;
  const startDelegation = (): void => {
    void act(
      () =>
        bridge.request("delegation/start", {
          workflowId: state.workflow.id,
          taskId: state.task.id,
          overlapOverride: false,
        }),
      "Delegation entered the supported mode. Assisted and clipboard modes still require your confirmation.",
    );
  };
  return (
    <section className="summary-card" aria-live="polite">
      <h2>Execution</h2>
      <p>
        Delegation: {delegation?.mode ?? "not started"} ·{" "}
        {delegation?.status ??
          (state.prepared?.approved ? "approved" : "not approved")}
      </p>
      <p>Execution evidence: {execution?.status ?? "not started"}</p>
      <div className="button-row">
        {state.prepared?.approved && !delegation && (
          <button disabled={busy} onClick={startDelegation}>
            Start delegation
          </button>
        )}
        {delegation &&
          ["assisted", "clipboard"].includes(delegation.mode) &&
          !delegation.startedAt && (
            <>
              {delegation.mode === "assisted" && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        bridge.request("delegation/openCopilot", {
                          taskId: state.task.id,
                        }),
                      "Copilot Chat opened. Keystone has not claimed that execution started.",
                    )
                  }
                >
                  Open Copilot
                </button>
              )}
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("delegation/copyPrompt", {
                        taskId: state.task.id,
                      }),
                    "The approved prompt was copied. Submission is still unconfirmed.",
                  )
                }
              >
                Copy approved prompt
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("delegation/confirmStarted", {
                        workflowId: state.workflow.id,
                        sessionId: delegation.id,
                      }),
                    "You confirmed external execution started; this is a user assertion.",
                  )
                }
              >
                Confirm prompt submitted
              </button>
            </>
          )}
        {delegation && !execution && delegation.startedAt && (
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  bridge.request("execution/start", {
                    workflowId: state.workflow.id,
                    taskId: state.task.id,
                    delegationSessionId: delegation.id,
                  }),
                "Execution observation was prepared from the persisted baseline; start is still explicit.",
              )
            }
          >
            Prepare execution tracking
          </button>
        )}
        {execution?.status === "awaiting-start" && (
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  bridge.request("execution/confirmStarted", {
                    sessionId: execution.id,
                  }),
                "Implementation start explicitly confirmed.",
              )
            }
          >
            Confirm implementation started
          </button>
        )}
        {execution &&
          ["executing", "repository-changed"].includes(execution.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("execution/confirmStopped", {
                      sessionId: execution.id,
                    }),
                  "Implementation stopped; result evidence must now be captured.",
                )
              }
            >
              Confirm implementation finished
            </button>
          )}
        {delegation &&
          !["cancelled", "completed-later"].includes(delegation.status) && (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("delegation/cancel", {
                      workflowId: state.workflow.id,
                      sessionId: delegation.id,
                    }),
                  "Delegation tracking cancelled; unsupported external work may continue.",
                )
              }
            >
              Cancel delegation tracking
            </button>
          )}
      </div>
      {execution?.status === "awaiting-result-capture" && (
        <div className="field-stack">
          <label htmlFor={`result-notes-${execution.id}`}>
            Execution notes
          </label>
          <textarea
            id={`result-notes-${execution.id}`}
            value={notes}
            maxLength={20_000}
            onChange={(event) => setNotes(event.target.value)}
          />
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  bridge.request("execution/captureResult", {
                    sessionId: execution.id,
                    mode:
                      delegation?.mode === "direct"
                        ? "direct"
                        : delegation
                          ? "assisted"
                          : "repository-only",
                    userNotes: notes,
                  }),
                "Result captured as repository observations and user-labelled notes, not as proof of completion.",
              )
            }
          >
            Capture result
          </button>
        </div>
      )}
      {execution?.diagnostics.map((item) => (
        <p className={`diagnostic ${item.severity}`} key={item.code}>
          {item.message}
        </p>
      ))}
    </section>
  );
}
function BuildChangesValidation({
  state,
  busy,
  act,
  bridge,
}: {
  state: BuildTaskState;
  busy: boolean;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: HostBridge;
}): React.JSX.Element {
  const execution = state.execution;
  const [manualEvidence, setManualEvidence] = useState("");
  const [retryAgentId, setRetryAgentId] = useState("");
  const [diff, setDiff] = useState<{
    path: string;
    text: string;
    truncated: boolean;
  }>();
  const failedStep = state.validationRun?.stepResults.find(
    (step) => step.status === "failed",
  );
  const manualCriterion = state.validationRun?.acceptanceCriteriaResults.find(
    (criterion) => criterion.status === "requires-manual-review",
  );
  return (
    <aside className="build-evidence">
      <section>
        <h2>Changes</h2>
        <p>
          Baseline:{" "}
          {execution?.repositoryBaseline.headCommit ??
            "Captured when the task starts or delegation begins"}
        </p>
        {execution?.observedChanges.map((change) => (
          <article key={change.relativePath}>
            <strong>{change.relativePath}</strong>
            <span>
              {change.kind} ·{" "}
              {change.userOverride?.classification ?? change.classification} ·{" "}
              {Math.round(change.confidence * 100)}%
            </span>
            <small>{change.reasons.join(" ")}</small>
            <div className="button-row">
              {(["expected", "pre-existing", "excluded"] as const).map(
                (classification) => (
                  <button
                    key={classification}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        () =>
                          bridge.request("execution/attributeChange", {
                            sessionId: execution.id,
                            relativePath: change.relativePath,
                            classification,
                            reason: `User classified this change as ${classification} in Build.`,
                          }),
                        `Change marked ${classification}; the audit record was preserved.`,
                      )
                    }
                  >
                    Mark {classification}
                  </button>
                ),
              )}
              <button
                onClick={() =>
                  void bridge
                    .request("build/getDiff", {
                      path: change.relativePath,
                      mode: "working-head",
                      maxBytes: 50_000,
                    })
                    .then((value) =>
                      setDiff({
                        path: value.path,
                        text: value.text,
                        truncated: value.truncated,
                      }),
                    )
                }
              >
                Load bounded diff
              </button>
              <button
                onClick={() =>
                  void bridge.request("intelligence/source/open", {
                    relativePath: change.relativePath,
                  })
                }
              >
                Open file
              </button>
            </div>
          </article>
        ))}
        {execution && (
          <button
            disabled={busy}
            onClick={() =>
              void act(
                () =>
                  bridge.request("execution/observeChanges", {
                    sessionId: execution.id,
                  }),
                "Repository changes refreshed without staging or attribution assumptions.",
              )
            }
          >
            Refresh changes
          </button>
        )}
        {!execution?.observedChanges.length && (
          <p>No repository changes detected for this execution session.</p>
        )}
        {diff && (
          <details open>
            <summary>
              {diff.path}
              {diff.truncated ? " · truncated" : ""}
            </summary>
            <pre className="prompt-preview">{diff.text}</pre>
          </details>
        )}
      </section>
      <section>
        <h2>Validation</h2>
        {execution &&
          ["result-captured", "planning-validation"].includes(
            execution.status,
          ) &&
          !state.validationPlan && (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("validation/plan", {
                      sessionId: execution.id,
                      testMode: "impacted",
                    }),
                  "Focused validation plan created from repository commands, impacted tests, and acceptance criteria.",
                )
              }
            >
              Create validation plan
            </button>
          )}
        {state.validationPlan ? (
          <>
            {state.validationPlan.steps.map((step) => (
              <p key={step.id}>
                <strong>{step.type}</strong> ·{" "}
                {step.required ? "required" : "optional"} · {step.status}
              </p>
            ))}
            <button
              disabled={busy || state.validationRun?.status === "running"}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("validation/run", {
                      planId: state.validationPlan!.id,
                    }),
                  "Validation completed; evidence and criteria were refreshed.",
                )
              }
            >
              Run required validation
            </button>
            {state.validationRun?.status === "running" && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("validation/cancel", {
                        runId: state.validationRun!.id,
                      }),
                    "Validation cancellation requested; completed evidence was preserved.",
                  )
                }
              >
                Cancel validation
              </button>
            )}
            {failedStep && state.validationRun && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("validation/rerunStep", {
                        runId: state.validationRun!.id,
                        stepId: failedStep.stepId,
                      }),
                    "Failed validation step rerun with the same bounded descriptor.",
                  )
                }
              >
                Rerun failed step
              </button>
            )}
          </>
        ) : (
          <p>
            Validation plan is available after an execution result is captured.
          </p>
        )}
        {state.validationRun && (
          <>
            <p role="status">
              {state.validationRun.status}:{" "}
              {state.validationRun.summary.requiredStepsPassed +
                state.validationRun.summary.optionalStepsPassed}{" "}
              passed, {state.validationRun.summary.requiredStepsFailed} failed
            </p>
            {state.validationRun.acceptanceCriteriaResults.map((criterion) => (
              <p key={criterion.criterionId}>
                {criterion.criterionId}: {criterion.status} ·{" "}
                {criterion.explanation}
              </p>
            ))}
            {manualCriterion && (
              <div className="field-stack">
                <label
                  htmlFor={`manual-evidence-${manualCriterion.criterionId}`}
                >
                  Manual evidence for {manualCriterion.criterionId}
                </label>
                <textarea
                  id={`manual-evidence-${manualCriterion.criterionId}`}
                  value={manualEvidence}
                  maxLength={5_000}
                  onChange={(event) => setManualEvidence(event.target.value)}
                />
                <button
                  disabled={busy || !manualEvidence.trim()}
                  onClick={() =>
                    void act(
                      () =>
                        bridge.request("validation/manualEvidence", {
                          runId: state.validationRun!.id,
                          criterionId: manualCriterion.criterionId,
                          statement: manualEvidence.trim(),
                        }),
                      "Manual evidence recorded as user verification, not automated proof.",
                    )
                  }
                >
                  Add manual evidence
                </button>
              </div>
            )}
          </>
        )}
      </section>
      <section>
        <h2>Continuity</h2>
        <p>
          Retry history: {execution?.retryAttempt ?? 0} · Handoff eligibility
          requires an accepted or active assignment.
        </p>
        {execution &&
          [
            "validation-failed",
            "failed",
            "blocked",
            "awaiting-user-review",
          ].includes(execution.status) &&
          !state.retry && (
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("retry/plan", {
                      sessionId: execution.id,
                      mode: "same-agent",
                      reason:
                        "Repair failed validation or incomplete acceptance criteria from Build.",
                    }),
                  "Focused retry plan prepared; the prior attempt remains intact.",
                )
              }
            >
              Prepare retry
            </button>
          )}
        {execution &&
          [
            "validation-failed",
            "failed",
            "blocked",
            "awaiting-user-review",
          ].includes(execution.status) &&
          !state.retry && (
            <div className="button-row">
              <label>
                Different retry agent
                <select
                  value={retryAgentId}
                  onChange={(event) => setRetryAgentId(event.target.value)}
                >
                  <option value="">Select available agent</option>
                  {state.agents
                    .filter(
                      (agent) =>
                        agent.availability !== "unavailable" &&
                        agent.id !== execution.agentId,
                    )
                    .map((agent) => (
                      <option value={agent.id} key={agent.id}>
                        {agent.displayName}
                      </option>
                    ))}
                </select>
              </label>
              <button
                disabled={busy || !retryAgentId}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("retry/plan", {
                        sessionId: execution.id,
                        mode: "different-agent",
                        agentId: retryAgentId,
                        reason:
                          "Use a different reviewed agent for failed validation or incomplete criteria.",
                      }),
                    "Different-agent retry plan prepared; the prior attempt remains intact.",
                  )
                }
              >
                Prepare with different agent
              </button>
            </div>
          )}
        {state.retry && (
          <details open>
            <summary>
              Retry attempt {state.retry.attempt} · {state.retry.status}
            </summary>
            <p>{state.retry.reason}</p>
            <p>
              {state.retry.failedCriterionIds.length} failed criteria ·{" "}
              {state.retry.findingIds.length} findings ·{" "}
              {state.retry.repairContext.length} focused context items
            </p>
            {state.retry.status === "planned" && execution && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await bridge.request("retry/buildContext", {
                      sessionId: execution.id,
                    });
                    return bridge.request("retry/prepare", {
                      sessionId: execution.id,
                    });
                  }, "Retry context and repair prompt prepared for explicit start.")
                }
              >
                Prepare retry prompt
              </button>
            )}
            {state.retry.status === "prepared" && execution && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("retry/start", {
                        sessionId: execution.id,
                      }),
                    "Retry session created with a fresh baseline; execution remains awaiting explicit start.",
                  )
                }
              >
                Start retry
              </button>
            )}
          </details>
        )}
        <button
          disabled={!execution || state.completion?.status !== "ready"}
          onClick={() =>
            execution &&
            void act(
              () =>
                bridge.request("completion/evaluate", {
                  sessionId: execution.id,
                }),
              "Completion readiness refreshed; no task was completed automatically.",
            )
          }
        >
          Request completion review
        </button>
        <p>
          {state.completion?.blockers.join(" ") ??
            "Completion readiness requires validation evidence."}
        </p>
        <BuildHandoffPanel
          state={state}
          busy={busy}
          act={act}
          bridge={bridge}
        />
      </section>
    </aside>
  );
}
function BuildHandoffPanel({
  state,
  busy,
  act,
  bridge,
}: {
  state: BuildTaskState;
  busy: boolean;
  act: (operation: () => Promise<unknown>, success: string) => Promise<void>;
  bridge: HostBridge;
}): React.JSX.Element {
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [participants, setParticipants] = useState<TeamParticipant[]>([]);
  const [handoff, setHandoff] = useState<HandoffPackage>();
  const [validation, setValidation] = useState<HandoffValidationResult>();
  const [receiverId, setReceiverId] = useState("");
  useEffect(() => {
    let active = true;
    void Promise.all([
      bridge.request("assignment/list", { workflowId: state.workflow.id }),
      bridge.request("team/participants", {}),
    ]).then(([nextAssignments, nextParticipants]) => {
      if (!active) return;
      setAssignments(nextAssignments);
      setParticipants(nextParticipants);
      const current = nextAssignments.find(
        (item) => item.taskId === state.task.id,
      );
      setReceiverId(
        nextParticipants.find(
          (item) => item.id !== current?.assignedTo && item.active,
        )?.id ?? "",
      );
    });
    return () => {
      active = false;
    };
  }, [bridge, state.task.id, state.workflow.id]);
  const assignment = assignments.find(
    (item) =>
      item.taskId === state.task.id &&
      ["accepted", "in-progress", "handoff-requested"].includes(item.status),
  );
  const senderId = assignment?.assignedTo;
  const canPrepare = Boolean(assignment && senderId && receiverId);
  return (
    <details>
      <summary>Task handoff</summary>
      {!assignment && (
        <p>
          Handoff unavailable: this task requires an accepted or active
          assignment.
        </p>
      )}
      {assignment && (
        <>
          <label className="field-stack">
            Intended receiver
            <select
              value={receiverId}
              onChange={(event) => setReceiverId(event.target.value)}
            >
              <option value="">Select a different active participant</option>
              {participants
                .filter((item) => item.active && item.id !== senderId)
                .map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.displayName} · {item.role}
                  </option>
                ))}
            </select>
          </label>
          {!handoff && (
            <button
              disabled={busy || !canPrepare}
              onClick={() =>
                void act(async () => {
                  const value = await bridge.request("handoff/prepare", {
                    assignmentId: assignment.id,
                    senderParticipantId: senderId!,
                    receiverParticipantId: receiverId,
                    completedWork: state.execution
                      ? [
                          `Execution ${state.execution.status}; ${state.execution.observedChanges.length} observed changes.`,
                        ]
                      : [],
                    remainingWork: [state.nextAction],
                    blockers:
                      state.task.status === "blocked"
                        ? [
                            {
                              id: crypto.randomUUID(),
                              category: "task",
                              description:
                                state.task.staleReasons.at(-1) ??
                                "Task is blocked.",
                              blocking: true,
                            },
                          ]
                        : [],
                    openQuestions: [],
                    senderNotes:
                      "Prepared from the task-centered Build workspace.",
                  });
                  setHandoff(value);
                }, "Bounded handoff package prepared for review; no credentials or active agent state were included.")
              }
            >
              Preview handoff package
            </button>
          )}
        </>
      )}
      {handoff && (
        <div className="handoff-preview">
          <p>
            {handoff.task.title} · {handoff.progress.stage} ·{" "}
            {handoff.changedFiles.length} changed files
          </p>
          <p>
            {handoff.execution?.attemptCount ?? 0} execution attempts ·{" "}
            {handoff.validation?.latestStatus ?? "validation unavailable"}
          </p>
          <p>
            Context fingerprint:{" "}
            {handoff.context[0]?.contentFingerprint ?? "none"}
          </p>
          {handoff.changedFiles.map((file) => (
            <p key={file.path}>
              {file.kind}: {file.path} · {file.classification}
            </p>
          ))}
          <div className="button-row">
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const value = await bridge.request("handoff/validate", {
                    package: handoff,
                  });
                  setValidation(value);
                }, "Handoff package fingerprint, bounds, and sanitization validated.")
              }
            >
              Validate package
            </button>
            <button
              disabled={busy || !validation?.valid}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("handoff/export", {
                      packageId: handoff.id,
                      mode: "json",
                    }),
                  "Reviewed handoff package exported through the existing local artifact service.",
                )
              }
            >
              Export JSON
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await bridge.request("handoff/cancel", {
                    packageId: handoff.id,
                  });
                  setHandoff(undefined);
                  setValidation(undefined);
                }, "Handoff preparation cancelled; the task and repository were unchanged.")
              }
            >
              Cancel handoff
            </button>
          </div>
          {validation && (
            <p role="status">
              Validation: {validation.valid ? "valid" : "blocked"} ·{" "}
              {validation.diagnostics.map((item) => item.message).join(" ")}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
function setNoop(): void {
  /* Response is reloaded from canonical Build state by the action wrapper. */
}
function ReviewStage({
  bridge,
  workflowId,
}: {
  bridge: HostBridge;
  workflowId: string;
}): React.JSX.Element {
  const [state, setState] = useState<WorkflowReviewState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [diff, setDiff] = useState<{ path: string; text: string; truncated: boolean }>();
  const [note, setNote] = useState("");
  const [decisionReason, setDecisionReason] = useState("I reviewed the retained specification, changes, validation evidence, findings, and limitations.");
  const refresh = useCallback(async (): Promise<void> => {
    try { setState(await bridge.request("review/getState", { workflowId })); setError(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, [bridge, workflowId]);
  useEffect(() => { queueMicrotask(() => void refresh()); return bridge.subscribe((message) => { if (message.type.startsWith("review/")) void refresh(); }); }, [bridge, refresh]);
  const act = async (action: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError(undefined);
    try { await action(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return (
    <>
      <StageHeading
        eyebrow="Review"
        title="Review implementation evidence"
        description="Compare the approved specification with attributed changes, current validation, findings, and explicit reviewer decisions."
      />
      {error && <div className="honesty-note" role="alert">{error}</div>}
      {!state ? <p role="status">Loading review evidence…</p> : <>
        <section className="summary-card" aria-labelledby="review-summary-title">
          <div className="section-heading"><div><span className="eyebrow">Review summary</span><h2 id="review-summary-title">{state.summary.title}</h2></div><span className={`status-pill status-${state.summary.status}`}>{state.summary.status}</span></div>
          <dl className="review-metrics">
            <div><dt>Specification</dt><dd>Revision {state.summary.specificationRevision}</dd></div>
            <div><dt>Repository</dt><dd>{state.summary.repositoryId}</dd></div>
            <div><dt>Branch / HEAD</dt><dd>{state.summary.branch ?? "unavailable"} · {state.summary.headCommit?.slice(0, 12) ?? "unavailable"}</dd></div>
            <div><dt>Tasks</dt><dd>{state.summary.tasksCompleted} complete · {state.summary.tasksIncomplete} incomplete</dd></div>
            <div><dt>Validation</dt><dd>{state.summary.validationPassed} passed · {state.summary.validationFailed} failed</dd></div>
            <div><dt>Findings</dt><dd>{state.summary.blockingFindings} blocking · {state.summary.warnings} warnings</dd></div>
          </dl>
          {state.readinessBlockers.length > 0 && <div className="review-blockers"><h3>Completion blockers</h3><ul>{state.readinessBlockers.map((item) => <li key={item}>{item}</li>)}</ul></div>}
        </section>
        <details open className="summary-card"><summary><strong>Requirement traceability</strong> · {state.traceability.length}</summary>
          <div className="review-list">{state.traceability.map((item) => <article key={`${item.kind}-${item.id}`} className="review-row"><div><strong>{item.description}</strong><p>{item.kind} · {item.status}</p></div><p>{item.taskIds.length} tasks · {item.changedFiles.length} files · {item.validationEvidenceIds.length} evidence</p>{item.openConcern && <p className="honesty-note">{item.openConcern}</p>}</article>)}</div>
        </details>
        <details open className="summary-card"><summary><strong>Change review</strong> · {state.changes.length}</summary>
          <div className="review-list">{state.changes.map((change) => <article key={change.path} className="review-row"><div><strong>{change.path}</strong><p>{change.kind} · {change.classification} · {change.changedSymbols.length} changed symbols</p></div><div className="button-row"><button disabled={busy} onClick={() => void act(async () => { const value = await bridge.request("review/getDiff", { workflowId, path: change.path, maxBytes: 50_000 }); setDiff({ path: value.path, text: value.text, truncated: value.truncated }); })}>Open bounded diff</button>{["unexpected", "ambiguous", "concurrent"].includes(change.classification) && <><button disabled={busy} onClick={() => void act(() => bridge.request("review/attributeChange", { workflowId, path: change.path, classification: "expected", reason: "Reviewer confirmed this change is within approved scope." }))}>Mark expected</button><button disabled={busy} onClick={() => void act(() => bridge.request("review/attributeChange", { workflowId, path: change.path, classification: "excluded", reason: "Reviewer marked this change unrelated to workflow completion." }))}>Mark unrelated</button></>}</div></article>)}</div>
          {diff && <div className="bounded-diff" aria-label={`Diff for ${diff.path}`}><div><strong>{diff.path}</strong>{diff.truncated && <span> · truncated</span>}</div><pre>{diff.text}</pre></div>}
        </details>
        {(["qa", "security", "performance", "documentation"] as const).map((source) => { const findings = state.findings.filter((item) => item.source === source); if (!findings.length && source !== "qa" && source !== "documentation") return null; return <details key={source} className="summary-card"><summary><strong>{source === "qa" ? "Validation and QA" : source[0]!.toUpperCase() + source.slice(1)}</strong> · {findings.length}</summary><div className="review-list">{findings.length ? findings.map((entry) => <article key={entry.finding.id} className="review-row"><div><strong>{entry.finding.title}</strong><p>{entry.finding.severity} · {entry.staticOrMeasured} · {entry.finding.description}</p><p>Limitation: {entry.limitation}</p></div>{entry.finding.severity === "blocking" && !entry.disposition && <button disabled={busy} onClick={() => void act(() => bridge.request("review/dispositionFinding", { workflowId, findingId: entry.finding.id, disposition: source === "security" ? "accepted-risk" : "accepted", reason: "Explicitly accepted after reviewing retained evidence and limitations.", scope: entry.finding.title }))}>Record explicit disposition</button>}{entry.disposition && <span className="status-pill">{entry.disposition.disposition}</span>}</article>) : <p>Not triggered by retained evidence.</p>}</div></details>; })}
        <details className="summary-card"><summary><strong>PR review package</strong></summary><p>Generate a deterministic, editable package. This does not create a pull request.</p><button disabled={busy} onClick={() => void act(() => bridge.request("review/generatePrDraft", { workflowId }))}>{state.prDraft ? "Regenerate draft" : "Generate PR draft"}</button>{state.prDraft && <><label>Title<input value={state.prDraft.title} onChange={(event) => setState({ ...state, prDraft: { ...state.prDraft!, title: event.target.value } })} /></label><label>Description<textarea rows={10} value={state.prDraft.body} onChange={(event) => setState({ ...state, prDraft: { ...state.prDraft!, body: event.target.value } })} /></label><button disabled={busy} onClick={() => void act(() => bridge.request("review/updatePrDraft", { draft: state.prDraft! }))}>Save PR draft edits</button></>}</details>
        <section className="summary-card"><h2>Review notes and decision</h2><label>Add workflow note<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Question, issue, risk, or follow-up" /></label><button disabled={busy || !note.trim()} onClick={() => void act(async () => { await bridge.request("review/addNote", { workflowId, targetType: "workflow", targetId: workflowId, type: "issue", text: note, blocking: true }); setNote(""); })}>Add blocking note</button><div className="review-list">{state.notes.map((item) => <article key={item.id} className="review-row"><div><strong>{item.type}</strong><p>{item.text}</p><small>{item.blocking ? "Blocking" : "Advisory"} · {item.resolvedAt ? `Resolved: ${item.resolution}` : "Open"}</small></div>{!item.resolvedAt && <button disabled={busy} onClick={() => void act(() => bridge.request("review/resolveNote", { workflowId, noteId: item.id, resolution: "Resolved during explicit review." }))}>Resolve</button>}</article>)}</div><label>Decision rationale<textarea value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><div className="button-row"><button disabled={busy || state.readinessBlockers.length > 0} onClick={() => void act(() => bridge.request("review/approve", { workflowId, reason: decisionReason, confirm: true }))}>Approve review</button><button disabled={busy || state.readinessBlockers.length > 0} onClick={() => void act(() => bridge.request("review/approveWithWarnings", { workflowId, reason: decisionReason, confirm: true }))}>Approve with warnings</button><button className="secondary" disabled={busy} onClick={() => void act(() => bridge.request("review/reject", { workflowId, reason: decisionReason, confirm: true }))}>Reject</button></div></section>
      </>}
    </>
  );
}
function CompleteStage({
  bridge,
  workflowId,
}: {
  bridge: HostBridge;
  workflowId: string;
}): React.JSX.Element {
  const [state, setState] = useState<CompletionState>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("Complete from the approved review while preserving retained evidence.");
  const [approval, setApproval] = useState<{ stage?: string; commit?: string; push?: string; pr?: string; patch?: string }>({});
  const refresh = useCallback(async (): Promise<void> => { try { setState(await bridge.request("complete/getState", { workflowId })); setError(undefined); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }, [bridge, workflowId]);
  useEffect(() => { queueMicrotask(() => void refresh()); return bridge.subscribe((message) => { if (message.type.startsWith("complete/") || message.type.startsWith("review/")) void refresh(); }); }, [bridge, refresh]);
  const act = async (action: () => Promise<unknown>): Promise<void> => { setBusy(true); setError(undefined); try { await action(); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); } };
  return (
    <>
      <StageHeading
        eyebrow="Complete"
        title="Choose how this workflow ends"
        description="Local completion is first-class. Git, pull request, patch, and Handoff actions remain optional and capability-gated."
      />
      {error && <div className="honesty-note" role="alert">{error}</div>}
      {!state ? <p role="status">Loading completion options…</p> : <>
        <section className="summary-card"><div className="section-heading"><div><span className="eyebrow">Completion summary</span><h2>{state.review.summary.title}</h2></div><span className="status-pill">{state.completion?.status ?? (state.review.summary.completionReady ? "ready" : "blocked")}</span></div><p>Review: {state.review.decision?.status ?? "not approved"} · {state.review.readinessBlockers.length} blockers · {state.review.warnings.length} warnings</p>{state.completion && <pre className="completion-report">{state.completion.report}</pre>}</section>
        <section className="summary-card"><h2>Completion modes</h2><div className="completion-options">{state.options.map((option) => <article key={option.mode} className="completion-option"><div><strong>{option.label}</strong><p>{option.explanation}</p><small>Changes: {option.mutation} Approval: {option.approvalRequired}. Capability: {option.capabilityRequired}. {option.reversible ? "Reversible." : "May not be reversible."}</small></div>{option.mode === "local" && <button disabled={busy || !option.available || Boolean(state.completion)} onClick={() => void act(() => bridge.request("complete/completeLocally", { workflowId, reason, confirm: true }))}>Complete locally</button>}{option.mode === "closed-partial" && <button disabled={busy || !option.available || Boolean(state.completion)} onClick={() => void act(() => bridge.request("complete/closePartial", { workflowId, reason, confirm: true }))}>Close partial</button>}{option.mode === "cancelled-with-changes" && <button disabled={busy || !option.available || Boolean(state.completion)} onClick={() => void act(() => bridge.request("complete/cancelWithChanges", { workflowId, reason, confirm: true }))}>Cancel, retain changes</button>}</article>)}</div><label>Final confirmation rationale<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label></section>
        <details className="summary-card"><summary><strong>Optional Git and PR actions</strong></summary><dl className="review-metrics"><div><dt>Git repository</dt><dd>{state.gitCapabilities.repositoryDetected ? "Available" : "Unavailable"}</dd></div><div><dt>Commit</dt><dd>{state.gitCapabilities.commitAvailable ? "Available" : "Unavailable"}</dd></div><div><dt>Push</dt><dd>{state.gitCapabilities.pushAvailable ? "Available" : "Unavailable"}</dd></div><div><dt>PR provider</dt><dd>{state.prCapabilities?.integrationMethod ?? "Unavailable"}</dd></div></dl><p>Each approval is single-use and bound to the current reviewed fingerprint. Repository changes invalidate the next mutation.</p><div className="button-row"><button disabled={busy || !state.gitCapabilities.repositoryDetected} onClick={() => void act(() => bridge.request("complete/getChangeSet", { workflowId }))}>{state.changeSet ? "Refresh change set" : "Prepare change set"}</button><button disabled={busy || !state.changeSet} onClick={() => void act(() => bridge.request("complete/generateCommitPlan", { changeSetId: state.changeSet!.id }))}>{state.commitPlan ? "Regenerate commit plan" : "Generate commit plan"}</button></div>{state.changeSet && <p>{state.changeSet.includedFileIds.length} included · {state.changeSet.excludedFileIds.length} excluded · sensitive files remain excluded.</p>}{state.commitPlan && <ol>{state.commitPlan.commits.map((item) => <li key={item.id}><strong>{item.title}</strong> · {item.includedFileIds.length} files · {item.risks.length} risks</li>)}</ol>}<div className="completion-options"><article className="completion-option"><div><strong>Staging</strong><p>Approval records exact reviewed paths. Staging is a separate second action.</p></div>{approval.stage ? <button disabled={busy} onClick={() => void act(async () => { await bridge.request("complete/stageChanges", { approvalId: approval.stage! }); setApproval((value) => ({ ...value, stage: undefined })); })}>Stage approved paths</button> : <button disabled={busy || !state.changeSet || !state.review.summary.completionReady} onClick={() => void act(async () => { const value = await bridge.request("complete/approveStaging", { workflowId, fingerprint: state.review.repositoryFingerprint, confirm: true }); setApproval((current) => ({ ...current, stage: value.id })); })}>Approve staging</button>}</article><article className="completion-option"><div><strong>Commit</strong><p>Approval binds the next proposed commit and message. Commit is a separate second action.</p></div>{approval.commit ? <button disabled={busy} onClick={() => void act(async () => { await bridge.request("complete/createCommit", { approvalId: approval.commit! }); setApproval((value) => ({ ...value, commit: undefined })); })}>Create approved commit</button> : <button disabled={busy || !state.commitPlan || !state.review.summary.completionReady} onClick={() => void act(async () => { const value = await bridge.request("complete/approveCommit", { workflowId, fingerprint: state.review.repositoryFingerprint, confirm: true }); setApproval((current) => ({ ...current, commit: value.id })); })}>Approve next commit</button>}</article><article className="completion-option"><div><strong>Push</strong><p>Push never force-pushes and is blocked when behind, conflicted, or detached.</p></div>{approval.push ? <button disabled={busy} onClick={() => void act(async () => { await bridge.request("complete/push", { approvalId: approval.push! }); setApproval((value) => ({ ...value, push: undefined })); })}>Push approved branch</button> : <button disabled={busy || !state.gitCapabilities.pushAvailable || !state.review.summary.completionReady} onClick={() => void act(async () => { const value = await bridge.request("complete/approvePush", { workflowId, fingerprint: state.review.repositoryFingerprint, confirm: true }); setApproval((current) => ({ ...current, push: value.id })); })}>Approve push</button>}</article><article className="completion-option"><div><strong>Pull request</strong><p>Prepare is non-mutating. Direct or assisted creation requires its own approval and provider capability.</p></div>{!state.prDraft ? <button disabled={busy || !state.review.summary.completionReady} onClick={() => void act(() => bridge.request("complete/preparePr", { workflowId }))}>Prepare PR</button> : approval.pr ? <button disabled={busy} onClick={() => void act(async () => { await bridge.request("complete/createPr", { approvalId: approval.pr! }); setApproval((value) => ({ ...value, pr: undefined })); })}>Create or open approved PR</button> : <button disabled={busy} onClick={() => void act(async () => { const value = await bridge.request("complete/approvePrCreation", { workflowId, fingerprint: state.review.repositoryFingerprint, confirm: true }); setApproval((current) => ({ ...current, pr: value.id })); })}>Approve PR creation</button>}</article><article className="completion-option"><div><strong>Patch export</strong><p>Writes a reviewed patch under .keystone/exports and never applies it.</p></div>{approval.patch ? <button disabled={busy} onClick={() => void act(async () => { await bridge.request("complete/exportPatch", { workflowId, approvalId: approval.patch! }); setApproval((value) => ({ ...value, patch: undefined })); })}>Export approved patch</button> : <button disabled={busy || !state.changeSet || !state.gitCapabilities.diffAvailable || !state.review.summary.completionReady} onClick={() => void act(async () => { const value = await bridge.request("complete/approvePatchExport", { workflowId, fingerprint: state.review.repositoryFingerprint, confirm: true }); setApproval((current) => ({ ...current, patch: value.id })); })}>Approve patch export</button>}</article></div></details>
        <TaskHandoffActions bridge={bridge} workflowId={workflowId} />
        {state.completion && <button disabled={busy || state.completion.status === "archived"} onClick={() => void act(() => bridge.request("complete/archive", { workflowId }))}>Archive completed workflow</button>}
      </>}
    </>
  );
}
function WorkbenchContext({
  state,
}: {
  state: WorkbenchWorkflowState;
}): React.JSX.Element {
  const summary = state.summary;
  const ready = state.workflow.tasks.find(
    (task) => task.id === summary.currentReadyTaskId,
  );
  const blockers = state.stageStates.flatMap((stage) =>
    stage.blockers.map((item) => ({ stage: stage.stage, ...item })),
  );
  return (
    <aside className="workbench-context" aria-label="Workflow context summary">
      <h2>Workflow context</h2>
      <dl>
        <div>
          <dt>Current stage</dt>
          <dd>{stageLabel(summary.currentStage)}</dd>
        </div>
        <div>
          <dt>Specification</dt>
          <dd>{summary.specificationStatus}</dd>
        </div>
        <div>
          <dt>Task plan</dt>
          <dd>{summary.taskPlanStatus}</dd>
        </div>
        <div>
          <dt>Pending approvals</dt>
          <dd>{summary.pendingApprovals}</dd>
        </div>
        <div>
          <dt>Blocking diagnostics</dt>
          <dd>{summary.blockingDiagnostics}</dd>
        </div>
        <div>
          <dt>Repository</dt>
          <dd>{summary.repositoryFreshness}</dd>
        </div>
        <div>
          <dt>Intelligence</dt>
          <dd>{summary.intelligenceFreshness}</dd>
        </div>
      </dl>
      <h3>Current task</h3>
      <p>{ready?.title ?? "No ready task"}</p>
      <details>
        <summary>Task counts</summary>
        {Object.entries(summary.taskCounts).map(([status, count]) => (
          <p key={status}>
            {status}: {count}
          </p>
        ))}
      </details>
      <details>
        <summary>Blockers ({blockers.length})</summary>
        {blockers.map((item) => (
          <p key={`${item.stage}:${item.code}`}>
            <strong>{stageLabel(item.stage)}</strong>: {item.message}
          </p>
        ))}
      </details>
      <h3>Reserved context</h3>
      <p>
        Findings, repository changes, context package, and validation status
        will appear here as those stages become active.
      </p>
    </aside>
  );
}

function TaskHandoffActions({
  bridge,
  workflowId,
}: {
  bridge: HostBridge;
  workflowId: string;
}): React.JSX.Element {
  const [workflow, setWorkflow] = useState<DevelopmentWorkflowSnapshot>();
  const [assignments, setAssignments] = useState<TaskAssignment[]>([]);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    let active = true;
    void Promise.all([
      bridge.request("workflow/get", { workflowId }),
      bridge.request("assignment/list", { workflowId }),
    ]).then(([selected, current]) => {
      if (active) {
        setWorkflow(selected);
        setAssignments(current);
      }
    });
    return () => {
      active = false;
    };
  }, [bridge, workflowId]);
  return (
    <section className="summary-card">
      <h2>Task continuity</h2>
      <p>
        Full Handoff preparation is deferred. Existing eligible task actions and
        services remain available.
      </p>
      {notice && <p role="status">{notice}</p>}
      {workflow?.tasks.map((task) => {
        const assignment = assignments.find(
          (item) =>
            item.taskId === task.id &&
            ["accepted", "in-progress", "handoff-requested"].includes(
              item.status,
            ),
        );
        const action: TaskActionDescriptor = {
          id: "hand-off",
          label: "Hand off",
          eligible: Boolean(assignment),
          reason: assignment
            ? "This task has an eligible assignment."
            : "An accepted or active assignment is required.",
        };
        return (
          <div className="button-row" key={task.id}>
            <span>{task.title}</span>
            <button
              disabled={!action.eligible}
              title={`${action.reason} Full UI is deferred.`}
              onClick={() =>
                setNotice(
                  "Handoff eligibility is confirmed. Full preparation UI belongs to a later task.",
                )
              }
            >
              {action.label}
            </button>
          </div>
        );
      })}
    </section>
  );
}

function StageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <header className="stage-heading">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </header>
  );
}
function StageLoading({ error }: { error?: string }): React.JSX.Element {
  return error ? (
    <ErrorState value={error} />
  ) : (
    <section className="loading-view" aria-live="polite">
      <div className="loader" />
      <p>Loading stage state…</p>
    </section>
  );
}
function ErrorState({ value }: { value: string }): React.JSX.Element {
  return (
    <div className="error-banner" role="alert">
      <strong>Workbench action failed</strong>
      <p>{value}</p>
      <p>
        Your persisted workflow was preserved. Review the recovery action and
        retry.
      </p>
    </div>
  );
}
function RecoveryState({
  title,
  detail,
  action,
  onAction,
}: {
  title: string;
  detail: string;
  action: string;
  onAction: () => void;
}): React.JSX.Element {
  return (
    <section className="empty-state">
      <h1>{title}</h1>
      <p>{detail}</p>
      <button onClick={onAction}>{action}</button>
    </section>
  );
}
function stageLabel(stage: string): string {
  return stage[0]!.toUpperCase() + stage.slice(1);
}
function stageStatusDescription(status: WorkbenchStageState["status"]): string {
  return (
    {
      complete: "Completed stages can be revisited.",
      current: "Current workflow stage.",
      ready: "Prerequisites are complete.",
      blocked: "Prerequisites are incomplete.",
      optional: "Optional capability-driven stage.",
      unavailable: "Not available for current workflow state.",
    } as const
  )[status];
}
function workTypeLabel(value: DevelopmentWorkType): string {
  return (
    {
      feature: "Feature",
      bug: "Bug fix",
      refactor: "Refactoring",
      test: "Test work",
      modernization: "Modernization",
      investigation: "Investigation",
    } as const
  )[value];
}
function splitPaths(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);
}
function message(cause: unknown, diagnostic: string): string {
  return `${cause instanceof Error ? cause.message : String(cause)} Diagnostic: ${diagnostic}.`;
}
