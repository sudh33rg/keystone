import { useEffect, useMemo, useState } from "react";
import type { HostBridge } from "../../services/HostBridge";
import type {
  CompletionDecision,
  RetryPlan,
  TaskExecutionSession,
  ValidationPlan,
  ValidationRunV2,
  WorkflowCompletionReport,
} from "../../../shared/contracts/execution";

export function ExecutionValidationWorkspace({
  bridge,
  workflowId,
  onReturnToBuild,
}: {
  bridge: HostBridge;
  workflowId?: string;
  onReturnToBuild?: () => void;
}): React.JSX.Element {
  const [sessions, setSessions] = useState<TaskExecutionSession[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [plan, setPlan] = useState<ValidationPlan>();
  const [run, setRun] = useState<ValidationRunV2>();
  const [retry, setRetry] = useState<RetryPlan>();
  const [decision, setDecision] = useState<CompletionDecision>();
  const [report, setReport] = useState<WorkflowCompletionReport>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [testMode, setTestMode] =
    useState<ValidationPlan["testMode"]>("impacted");
  const [excludedTestIds, setExcludedTestIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const session = useMemo(
    () => sessions.find((item) => item.id === selectedId) ?? sessions.at(-1),
    [selectedId, sessions],
  );
  useEffect(() => {
    void bridge
      .request("execution/list", {})
      .then((items) => {
        const scoped = workflowId
          ? items.filter((item) => item.workflowId === workflowId)
          : items;
        setSessions(scoped);
        setSelectedId(scoped.at(-1)?.id);
      })
      .catch(display(setError));
  }, [bridge, workflowId]);
  useEffect(() => {
    if (typeof bridge.subscribe !== "function") return;
    return bridge.subscribe((message) => {
      if (message.type === "validation/started" && message.payload.runId)
        setActiveRunId(message.payload.runId);
      if (
        message.type === "validation/completed" ||
        message.type === "validation/cancelled"
      )
        setActiveRunId(undefined);
    });
  }, [bridge]);
  const applySession = (value: TaskExecutionSession): void => {
    setSessions((items) => [
      ...items.filter((item) => item.id !== value.id),
      value,
    ]);
    setSelectedId(value.id);
  };
  const act = async <T,>(
    operation: () => Promise<T>,
    apply: (value: T) => void,
  ): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      apply(await operation());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="page delegation-page">
      <div className="eyebrow">Evidence before completion</div>
      <h1>{workflowId ? "Workflow validation" : "Execution and validation"}</h1>
      <p>
        Repository changes and agent claims remain observations. Only mapped
        acceptance criteria, safe validation evidence, resolved findings, and
        explicit confirmation can complete a task.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {!session ? (
        <div className="ui-state ui-empty">
          <div>
            <strong>No validation session for this workflow</strong>
            <p>Start execution tracking from an approved task in Build. Validation configuration remains attached to that task.</p>
          </div>
          {onReturnToBuild && <button className="primary-button" onClick={onReturnToBuild}>Return to Build</button>}
        </div>
      ) : (
        <>
          {onReturnToBuild && <button className="ghost-button" onClick={onReturnToBuild}>Return to Build</button>}
          <label className="workflow-picker">
            Execution session
            <select
              value={session.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.taskId.slice(0, 8)} · {item.status} · attempt{" "}
                  {item.retryAttempt + 1}
                </option>
              ))}
            </select>
          </label>
          <ExecutionSummary session={session} />
          <div className="button-row">
            <button
              disabled={busy || session.status !== "awaiting-start"}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("execution/confirmStarted", {
                      sessionId: session.id,
                    }),
                  applySession,
                )
              }
            >
              Confirm execution start
            </button>
            <button
              disabled={
                busy ||
                !["executing", "repository-changed"].includes(session.status)
              }
              onClick={() =>
                void act(
                  () =>
                    bridge.request("execution/observeChanges", {
                      sessionId: session.id,
                    }),
                  applySession,
                )
              }
            >
              Observe changes
            </button>
            <button
              disabled={
                busy ||
                !["executing", "repository-changed"].includes(session.status)
              }
              onClick={() =>
                void act(
                  () =>
                    bridge.request("execution/confirmStopped", {
                      sessionId: session.id,
                    }),
                  applySession,
                )
              }
            >
              Confirm execution stopped
            </button>
          </div>
          {session.observedChanges.length > 0 && (
            <ChangeList
              session={session}
              disabled={busy}
              onAttribute={(relativePath, classification) =>
                void act(
                  () =>
                    bridge.request("execution/attributeChange", {
                      sessionId: session.id,
                      relativePath,
                      classification,
                      reason:
                        notes.trim() ||
                        "User reviewed and corrected repository attribution.",
                    }),
                  applySession,
                )
              }
            />
          )}
          <div className="result-capture">
            <label>
              Optional agent report, manual evidence, or override/retry reason
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={20_000}
              />
            </label>
            <button
              disabled={busy || session.status !== "awaiting-result-capture"}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("execution/captureResult", {
                      sessionId: session.id,
                      mode: notes.trim() ? "assisted" : "repository-only",
                      ...(notes.trim()
                        ? { agentClaims: { summary: notes }, userNotes: notes }
                        : {}),
                    }),
                  applySession,
                )
              }
            >
              Capture result for validation
            </button>
          </div>
          <div className="button-row">
            <label>
              Test scope
              <select
                value={testMode}
                onChange={(event) =>
                  setTestMode(event.target.value as ValidationPlan["testMode"])
                }
              >
                <option value="impacted">Evidence-ranked impacted tests</option>
                <option value="affected-suite">Affected suite</option>
                <option value="all">All repository tests</option>
              </select>
            </label>
            <button
              disabled={busy || session.status !== "result-captured"}
              onClick={() =>
                void act(
                  async () => {
                    const value = await bridge.request("validation/plan", {
                      sessionId: session.id,
                      testMode,
                      excludedTestEntityIds: excludedTestIds,
                    });
                    return {
                      value,
                      refreshed: await bridge.request("execution/get", {
                        sessionId: session.id,
                      }),
                    };
                  },
                  ({ value, refreshed }) => {
                    setPlan(value);
                    if (refreshed) applySession(refreshed);
                  },
                )
              }
            >
              Build validation plan
            </button>
            {plan && (
              <button
                disabled={busy || session.status !== "planning-validation"}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("validation/updatePlan", {
                        planId: plan.id,
                        testMode,
                        excludedTestEntityIds: excludedTestIds,
                      }),
                    (value) => value && setPlan(value),
                  )
                }
              >
                Update test scope
              </button>
            )}
            {plan && (
              <button
                disabled={busy || session.status !== "planning-validation"}
                onClick={() =>
                  void act(
                    async () => {
                      const value = await bridge.request("validation/run", {
                        planId: plan.id,
                      });
                      return {
                        value,
                        refreshed: await bridge.request("execution/get", {
                          sessionId: session.id,
                        }),
                      };
                    },
                    ({ value, refreshed }) => {
                      setRun(value);
                      if (refreshed) applySession(refreshed);
                    },
                  )
                }
              >
                Run safe validation
              </button>
            )}
            {activeRunId && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("validation/cancel", {
                        runId: activeRunId,
                      }),
                    () => setActiveRunId(undefined),
                  )
                }
              >
                Cancel validation
              </button>
            )}
            <button
              disabled={busy || !session.validationRunIds.length}
              onClick={() =>
                void act(
                  () =>
                    bridge.request("completion/evaluate", {
                      sessionId: session.id,
                    }),
                  setDecision,
                )
              }
            >
              Evaluate completion
            </button>
            {run && run.status !== "passed" && (
              <button
                disabled={busy || !notes.trim()}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("retry/plan", {
                        sessionId: session.id,
                        mode: "same-agent",
                        reason: notes,
                      }),
                    setRetry,
                  )
                }
              >
                Plan focused retry
              </button>
            )}
            {retry && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(
                    () =>
                      bridge.request("retry/start", { sessionId: session.id }),
                    applySession,
                  )
                }
              >
                Start retry tracker
              </button>
            )}
          </div>
          {run?.acceptanceCriteriaResults.some((item) =>
            ["requires-manual-review", "not-verifiable", "not-run"].includes(
              item.status,
            ),
          ) && (
            <div className="button-row">
              {run.acceptanceCriteriaResults
                .filter((item) =>
                  [
                    "requires-manual-review",
                    "not-verifiable",
                    "not-run",
                    "partially-passed",
                  ].includes(item.status),
                )
                .map((item) => (
                  <button
                    key={item.criterionId}
                    disabled={busy || !notes.trim()}
                    onClick={() =>
                      void act(
                        () =>
                          bridge.request("validation/manualEvidence", {
                            runId: run.id,
                            criterionId: item.criterionId,
                            statement: notes,
                          }),
                        setRun,
                      )
                    }
                  >
                    Record manual evidence for {item.criterionId}
                  </button>
                ))}
            </div>
          )}
          {plan && (
            <PlanView
              plan={plan}
              excludedTestIds={excludedTestIds}
              onExcludedTestIdsChange={setExcludedTestIds}
            />
          )}{" "}
          {run && <RunView run={run} />}{" "}
          {retry && (
            <div className="summary-card">
              <h2>Repair context · attempt {retry.attempt}</h2>
              {retry.repairContext.map((item) => (
                <p key={item.title}>
                  <strong>{item.title}</strong>: {item.reason}
                </p>
              ))}
            </div>
          )}{" "}
          {decision && (
            <CompletionView
              decision={decision}
              busy={busy}
              canOverride={Boolean(notes.trim())}
              onComplete={() =>
                void act(
                  () =>
                    bridge.request("completion/completeTask", {
                      sessionId: session.id,
                      confirm: true,
                    }),
                  (result) => {
                    setDecision(result.decision);
                    if (result.report) setReport(result.report);
                    const current = sessions.find(
                      (item) => item.id === session.id,
                    );
                    if (current)
                      applySession({
                        ...current,
                        status: "completed",
                        completedAt: new Date().toISOString(),
                      });
                  },
                )
              }
              onOverride={() =>
                void act(
                  () =>
                    bridge.request("completion/acceptWithOverride", {
                      sessionId: session.id,
                      confirm: true,
                      overrideReason: notes,
                    }),
                  (result) => setDecision(result.decision),
                )
              }
            />
          )}
          {report && <WorkflowReportView report={report} />}
        </>
      )}
    </section>
  );
}
function ExecutionSummary({
  session,
}: {
  session: TaskExecutionSession;
}): React.JSX.Element {
  return (
    <div className="summary-card">
      <h2>{session.status}</h2>
      <dl>
        <div>
          <dt>Agent</dt>
          <dd>{session.agentSnapshot.displayName}</dd>
        </div>
        <div>
          <dt>Mode</dt>
          <dd>{session.delegationMode}</dd>
        </div>
        <div>
          <dt>Baseline</dt>
          <dd>
            {session.repositoryBaseline.branch} ·{" "}
            {session.repositoryBaseline.headCommit.slice(0, 10)}
          </dd>
        </div>
        <div>
          <dt>Baseline generation</dt>
          <dd>{session.repositoryBaseline.intelligenceGeneration}</dd>
        </div>
        <div>
          <dt>Baseline hashes / diagnostics</dt>
          <dd>
            {Object.keys(session.repositoryBaseline.fileHashes).length} /{" "}
            {session.repositoryBaseline.diagnosticFingerprints.length}
          </dd>
        </div>
        <div>
          <dt>Expected files</dt>
          <dd>{session.expectedFiles.length}</dd>
        </div>
        <div>
          <dt>Observed / semantic changes</dt>
          <dd>
            {session.metrics.filesChanged} / {session.changedEntities.length}
          </dd>
        </div>
        <div>
          <dt>Execution / validation</dt>
          <dd>
            {Math.round(session.metrics.executionDurationMs)} ms /{" "}
            {Math.round(session.metrics.validationDurationMs)} ms
          </dd>
        </div>
      </dl>
      <p>
        Opening Copilot did not start this session. Completion is not inferred
        from changed files or stopped chat activity.
      </p>
    </div>
  );
}
function ChangeList({
  session,
  disabled,
  onAttribute,
}: {
  session: TaskExecutionSession;
  disabled: boolean;
  onAttribute: (
    relativePath: string,
    classification: TaskExecutionSession["observedChanges"][number]["classification"],
  ) => void;
}): React.JSX.Element {
  return (
    <div className="context-preview">
      <h2>Attributed repository changes</h2>
      {session.observedChanges.map((item) => (
        <article key={item.relativePath}>
          <header>
            <strong>{item.relativePath}</strong>
            <span>
              {item.classification} · {Math.round(item.confidence * 100)}%
            </span>
          </header>
          <p>{item.reasons.join(" ")}</p>
          <label>
            Correct attribution
            <select
              disabled={disabled}
              value={item.classification}
              onChange={(event) =>
                onAttribute(
                  item.relativePath,
                  event.target
                    .value as TaskExecutionSession["observedChanges"][number]["classification"],
                )
              }
            >
              {[
                "expected",
                "related",
                "unexpected",
                "pre-existing",
                "concurrent",
                "ambiguous",
                "excluded",
                "generated-output",
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </article>
      ))}
      {session.changedEntities.length > 0 && (
        <>
          <h3>Changed entities</h3>
          {session.changedEntities.slice(0, 200).map((item) => (
            <article key={`${item.entityId}:${item.changeKind}`}>
              <header>
                <strong>{item.qualifiedName}</strong>
                <span>{item.changeKind}</span>
              </header>
              <p>
                {item.entityType} · {Math.round(item.confidence * 100)}%
                {item.limitations.length
                  ? ` · ${item.limitations.join(" ")}`
                  : ""}
              </p>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
function PlanView({
  plan,
  excludedTestIds,
  onExcludedTestIdsChange,
}: {
  plan: ValidationPlan;
  excludedTestIds: string[];
  onExcludedTestIdsChange: (value: string[]) => void;
}): React.JSX.Element {
  return (
    <div className="context-preview">
      <h2>Validation plan</h2>
      <p>
        Test mode: {plan.testMode}.{" "}
        {plan.testSelections.filter((item) => item.selected).length} selected
        from {plan.testSelections.length} evidence-ranked candidate(s).
      </p>
      {plan.testSelections.map((item) => (
        <article key={item.testEntityId}>
          <header>
            <strong>{item.qualifiedName}</strong>
            <span>
              {item.selected ? "selected" : "suggested"} · {item.tier} ·{" "}
              {Math.round(item.confidence * 100)}%
            </span>
          </header>
          <p>{item.reasons.join(" ")}</p>
          {item.tier !== "naming-candidate" && (
            <label>
              <input
                type="checkbox"
                checked={!excludedTestIds.includes(item.testEntityId)}
                onChange={(event) =>
                  onExcludedTestIdsChange(
                    event.target.checked
                      ? excludedTestIds.filter((id) => id !== item.testEntityId)
                      : [...new Set([...excludedTestIds, item.testEntityId])],
                  )
                }
              />
              Include in the next impacted-test plan
            </label>
          )}
        </article>
      ))}
      {plan.steps.map((step) => (
        <article key={step.id}>
          <header>
            <strong>{step.type}</strong>
            <span>
              {step.required ? "required" : "optional"} ·{" "}
              {step.command?.safety ?? "static"}
            </span>
          </header>
          <p>{step.description}</p>
          {step.command && (
            <code>
              {step.command.executable} {step.command.args.join(" ")}
            </code>
          )}
        </article>
      ))}
    </div>
  );
}
function RunView({ run }: { run: ValidationRunV2 }): React.JSX.Element {
  return (
    <div className="context-preview">
      <h2>Validation report · {run.status}</h2>
      <p>
        {run.summary.requiredStepsPassed} required passed ·{" "}
        {run.summary.requiredStepsFailed} failed ·{" "}
        {run.summary.blockingFindings} blocking findings ·{" "}
        {run.summary.cacheReuseCount} reused · {run.summary.staleInvalidations}{" "}
        stale
      </p>
      {run.stepResults.map((item) => (
        <article key={item.stepId}>
          <header>
            <strong>{item.stepId.slice(0, 8)}</strong>
            <span>
              {item.status} · {Math.round(item.durationMs)} ms
              {item.reused ? " · cached" : ""}
              {item.outputTruncated ? " · output truncated" : ""}
            </span>
          </header>
          <p>{item.errorTail || item.outputTail || "No command output."}</p>
        </article>
      ))}
      {run.acceptanceCriteriaResults.map((item) => (
        <article key={item.criterionId}>
          <header>
            <strong>{item.criterionId}</strong>
            <span>{item.status}</span>
          </header>
          <p>{item.explanation}</p>
        </article>
      ))}
      {run.findings.map((item) => (
        <article key={item.id}>
          <header>
            <strong>{item.title}</strong>
            <span>{item.severity}</span>
          </header>
          <p>{item.description}</p>
          {item.details && (
            <p>
              {item.details.rule ? `Rule: ${item.details.rule}. ` : ""}
              {item.details.source ? `Source: ${item.details.source}. ` : ""}
              {item.details.sink ? `Sink: ${item.details.sink}. ` : ""}
              {item.details.limitations?.join(" ")}
            </p>
          )}
        </article>
      ))}
      <details>
        <summary>Evidence ({run.evidence.length})</summary>
        {run.evidence.map((item) => (
          <p key={item.id}>
            {item.kind} · {item.reliability} · {item.summary}
          </p>
        ))}
      </details>
    </div>
  );
}
function WorkflowReportView({
  report,
}: {
  report: WorkflowCompletionReport;
}): React.JSX.Element {
  return (
    <div className="summary-card">
      <h2>Workflow completion report</h2>
      <p>
        Specification revision {report.specificationRevision} ·{" "}
        {report.attempts} attempt(s) · generation{" "}
        {report.intelligenceGeneration}
      </p>
      <p>
        {report.filesChanged.length} files · {report.symbolsChanged.length}
        symbols · {report.apiChanges.length} API changes ·{" "}
        {report.dataChanges.length} data changes · {report.testsChanged.length}
        test changes
      </p>
      {report.validationOutcomes.map((item) => (
        <p key={item}>{item}</p>
      ))}
      {report.overrides.map((item) => (
        <p key={item}>Override: {item}</p>
      ))}
    </div>
  );
}
function CompletionView({
  decision,
  busy,
  canOverride,
  onComplete,
  onOverride,
}: {
  decision: CompletionDecision;
  busy: boolean;
  canOverride: boolean;
  onComplete: () => void;
  onOverride: () => void;
}): React.JSX.Element {
  return (
    <div className="summary-card">
      <h2>Completion {decision.status}</h2>
      {decision.blockers.map((item) => (
        <p key={item}>Blocker: {item}</p>
      ))}
      {decision.warnings.map((item) => (
        <p key={item}>Warning: {item}</p>
      ))}
      <div className="button-row">
        <button
          className="primary-button"
          disabled={busy || decision.status === "blocked"}
          onClick={onComplete}
        >
          Explicitly complete task
        </button>
        <button
          disabled={busy || decision.status !== "blocked" || !canOverride}
          onClick={onOverride}
        >
          Accept overridable blockers with recorded reason
        </button>
      </div>
    </div>
  );
}
function display(setter: (value: string) => void): (cause: unknown) => void {
  return (cause) =>
    setter(cause instanceof Error ? cause.message : String(cause));
}
