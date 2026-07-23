import { useCallback, useEffect, useState } from "react";
import type { CanonicalWorkflow } from "../../../shared/contracts/canonicalWorkflow";
import type { ImpactQaAggregate, QaPlanItem } from "../../../shared/contracts/impactQa";
import type {
  QaTestIntelligenceAggregate,
  FailureCategory,
  TestGenerationRequest,
  TestScenario,
} from "../../../shared/contracts/qaTestIntelligence";
import type { HostBridge } from "../../services/HostBridge";

type LooseRequest = (type: string, payload: unknown) => Promise<unknown>;

const FAILURE_CATEGORIES: FailureCategory[] = [
  "production-defect",
  "stale-expectation",
  "fixture-problem",
  "mock-problem",
  "environment-problem",
  "infrastructure-problem",
  "flaky-candidate",
  "timeout",
  "unknown",
];

function emptyIntelligence(workflowId: string): QaTestIntelligenceAggregate {
  return {
    workflowId,
    generationRequests: [],
    scenarios: [],
    generationProposals: [],
    failureAnalyses: [],
    failureRecords: [],
    flakyRuns: [],
    flakyClassifications: [],
    remediationProposals: [],
    policyAssessments: [],
    validations: [],
    appliedChanges: [],
    updatedAt: new Date(0).toISOString(),
  };
}

export function QaStage({ bridge, workflowId, onWorkflowChange }: { bridge: HostBridge; workflowId: string; onWorkflowChange: (workflow: CanonicalWorkflow) => void }): React.JSX.Element {
  const request = bridge.request.bind(bridge) as LooseRequest;
  const [state, setState] = useState<ImpactQaAggregate>({ workflowId, changedEntities: [], capabilities: [] });
  const [ti, setTi] = useState<QaTestIntelligenceAggregate>(emptyIntelligence(workflowId));
  const [busy, setBusy] = useState<string>();
  const [output, setOutput] = useState("");
  const [runningCommandId, setRunningCommandId] = useState<string>();
  const [error, setError] = useState<string>();
  const [qaMode, setQaMode] = useState<string>("recommend");
  const [testMode, setTestMode] = useState<string>("impacted");
  const [userPrompt, setUserPrompt] = useState<string>("");
  const recommendations = deriveRecommendations(state, ti, qaMode, userPrompt);

  const load = useCallback(() => {
    void request("impact.load", { correlationId: crypto.randomUUID(), workflowId })
      .then((value) => value && setState(value as ImpactQaAggregate))
      .catch(report(setError));
  }, [request, workflowId]);

  const loadTi = useCallback(() => {
    void request("testIntelligence.load", { correlationId: crypto.randomUUID(), workflowId })
      .then((value) => value && setTi(value as QaTestIntelligenceAggregate))
      .catch(report(setError));
  }, [request, workflowId]);

  useEffect(load, [load]);
  useEffect(loadTi, [loadTi]);

  useEffect(() => bridge.subscribe((message) => {
    if (message.type !== "qa.progress") return;
    if (message.payload.status === "running" && message.payload.commandId) setRunningCommandId(message.payload.commandId);
    else if (message.payload.status !== "running") setRunningCommandId(undefined);
    if ("output" in message.payload && typeof message.payload.output === "string")
      setOutput((value) => `${value}${message.payload.output}`.slice(-50_000));
  }), [bridge]);

  useEffect(() => bridge.subscribe((message) => {
    if (message.type !== "testIntelligence.updated") return;
    const next = message.payload;
    if (next.workflowId === workflowId) setTi(next);
  }), [bridge, workflowId]);

  const act = (name: string, type: string, payload: Record<string, unknown> = {}): void => {
    setBusy(name);
    setError(undefined);
    void request(type, { correlationId: crypto.randomUUID(), workflowId, ...payload })
      .then((value) => value && setState(value as ImpactQaAggregate))
      .then(() => request("workflow.getCanonical", { workflowId }))
      .then((workflow) => workflow && onWorkflowChange(workflow as CanonicalWorkflow))
      .catch(report(setError))
      .finally(() => setBusy(undefined));
  };

  const tiAct = (name: string, type: string, payload: Record<string, unknown> = {}): void => {
    setBusy(name);
    setError(undefined);
    void request(type, { correlationId: crypto.randomUUID(), workflowId, ...payload })
      .then((value) => value && setTi(value as QaTestIntelligenceAggregate))
      .catch(report(setError))
      .finally(() => setBusy(undefined));
  };

  const groups: Array<{ title: string; items: QaPlanItem[] }> = [
    { title: "Required Tests", items: state.qaPlan?.requiredItems ?? [] },
    { title: "Recommended Tests", items: state.qaPlan?.recommendedItems ?? [] },
    { title: "Optional Regression", items: state.qaPlan?.optionalItems ?? [] },
  ];

  const gaps = state.impactAnalysis?.coverageGaps ?? [];
  const requestsByGap = (gapId: string): TestGenerationRequest[] => ti.generationRequests.filter((r) => r.coverageGapId === gapId);
  const scenariosFor = (requestId: string): TestScenario[] => ti.scenarios.filter((s) => s.generationRequestId === requestId);

  return (
    <section className="phase7-stage qa-stage" aria-labelledby="qa-title">
      <header>
        <span className="eyebrow">Controlled execution</span>
        <h2 id="qa-title">QA</h2>
        <p>Review exact repository-derived commands, approve once, then observe real execution.</p>
      </header>
      {error && <div role="alert" className="diagnostic error">{error}</div>}
      <div className="qa-mode-bar">
        <label>
          QA mode
          <select
            value={qaMode}
            onChange={(event) => setQaMode(event.target.value)}
            disabled={Boolean(busy)}
          >
            <option value="recommend">Recommend only</option>
            <option value="legacy-modernize">Legacy modernization</option>
            <option value="flaky-focused">Flaky-focused</option>
            <option value="coverage-gap">Coverage-gap generation</option>
          </select>
        </label>
        <label>
          Test selection
          <select
            value={testMode}
            onChange={(event) => setTestMode(event.target.value)}
            disabled={Boolean(busy)}
          >
            <option value="impacted">Impacted tests</option>
            <option value="affected-suite">Affected suite</option>
            <option value="all">Full test suite</option>
          </select>
        </label>
        <textarea
          value={userPrompt}
          onChange={(event) => setUserPrompt(event.target.value)}
          placeholder="Optional guidance for recommendations..."
          disabled={Boolean(busy)}
        />
      </div>
      <div className="button-row">
        <button className="primary-button" disabled={Boolean(busy) || !state.impactAnalysis} onClick={() => act("generate", "qa.generatePlan", { qaMode, testMode })}>Generate QA Plan</button>
        <button disabled={Boolean(busy)} onClick={load}>Reload persisted QA</button>
        <button disabled={Boolean(busy)} onClick={loadTi}>Reload Test Intelligence</button>
      </div>
      <section><h3>Plan Summary</h3><p>{state.qaPlan ? `${state.qaPlan.requiredItems.length} required · ${state.qaPlan.recommendedItems.length} recommended · ${state.qaPlan.optionalItems.length} optional` : "No plan generated."}</p></section>
      {groups.map((group) => (
        <section key={group.title}><h3>{group.title}</h3>
          {group.items.length ? (
            <ul className="qa-plan-list">{group.items.map((item) => (
              <li key={item.id}><label><input type="checkbox" checked={item.selected} onChange={(event) => act("select", "qa.updatePlan", { itemId: item.id, selected: event.target.checked, overrideReason: item.category === "required" && !event.target.checked ? "User explicitly excluded this required test." : undefined })} /> <strong>{item.label}</strong></label><p>{item.reason}</p><small>{item.command.executable} {item.command.arguments.join(" ")} · cwd {item.command.workingDirectory} · timeout {item.command.timeoutMs}ms · confidence {item.confidence.toFixed(2)}</small></li>
            ))}</ul>
          ) : <p>No {group.title.toLowerCase()} selected.</p>}
        </section>
      ))}
      {recommendations.length ? (
        <section><h3>Recommendations</h3>
          <ul>{recommendations.map((item, index) => (
            <li key={index}>
              <strong>{item.title}</strong> — {item.rationale}
              {item.testFile && <p>Test: <code>{item.testFile}</code></p>}
              {item.command && <small>{item.command.executable} {item.command.arguments.join(" ")} · confidence {item.confidence.toFixed(2)}</small>}
              <div className="button-row">
                {item.acceptRoute && <button disabled={Boolean(busy)} onClick={() => item.acceptRoute && tiAct("accept-rec", item.acceptRoute.type, item.acceptRoute.payload)}>Accept recommendation</button>}
              </div>
            </li>
          ))}</ul>
        </section>
      ) : <p>No recommendations for the selected mode.</p>}
      <section><h3>Coverage Gaps</h3>
        {gaps.length ? (
          <ul>{gaps.map((gap) => {
            const reqs = requestsByGap(gap.id);
            return (
              <li key={gap.id}>
                <strong>{gap.blocking ? "Blocking" : "Warning"}:</strong> {gap.reason}
                <ul>
                  {reqs.map((req) => (
                    <li key={req.id}>Generation request <code>{req.id}</code> — layer {req.testLayer}, status <code>{req.status}</code>
                      {req.status === "draft" && <button disabled={Boolean(busy)} onClick={() => tiAct("derive", "testIntelligence.deriveScenarios", { generationRequestId: req.id })}>Derive scenarios</button>}
                      {req.status === "scenarios-ready" && <button disabled={Boolean(busy)} onClick={() => tiAct("approve", "testIntelligence.approveScenarios", { generationRequestId: req.id })}>Approve scenarios</button>}
                      {req.status === "awaiting-approval" && <button disabled={Boolean(busy)} onClick={() => tiAct("build", "testIntelligence.buildGenerationContext", { generationRequestId: req.id, budgetTokens: 8000 })}>Build prompt context</button>}
                      <ul>{scenariosFor(req.id).map((s) => (
                        <li key={s.id}><label><input type="checkbox" checked={s.selected} onChange={(event) => tiAct("scenario", "testIntelligence.updateScenario", { scenarioId: s.id, selected: event.target.checked, removalReason: s.importance === "required" && !event.target.checked ? "Removed by reviewer." : undefined })} /> <strong>{s.title}</strong> ({s.importance})</label><p>{s.behaviour}</p></li>
                      ))}</ul>
                    </li>
                  ))}
                </ul>
                {!reqs.length && <button disabled={Boolean(busy)} onClick={() => tiAct("create-gen", "testIntelligence.createGenerationRequest", { coverageGapId: gap.id })}>Generate tests for this gap</button>}
              </li>
            );
          })}</ul>
        ) : <p>No known coverage gaps.</p>}
      </section>
      <section><h3>Test Generation Proposals</h3>
        {ti.generationProposals.length ? (
          <ul>{ti.generationProposals.map((p) => (
            <li key={p.id}><strong>{p.status}</strong> — {p.summary} ({p.fileChanges.length} file change(s)){p.status === "received" && <button disabled={Boolean(busy)} onClick={() => tiAct("apply", "testIntelligence.applyProposal", { proposalId: p.id, selectedChangeIds: p.fileChanges.map((c) => c.id) })}>Apply selected changes</button>}</li>
          ))}</ul>
        ) : <p>No generation proposals recorded.</p>}
      </section>
      <section><h3>Failure Analysis</h3>
        {ti.failureAnalyses.length ? (
          <ul>{ti.failureAnalyses.map((a) => (
            <li key={a.id}><strong>{a.category}</strong> (conf {a.confidence.toFixed(2)}) · recommended: {a.recommendedAction} · status {a.status}
              {a.status !== "accepted" && a.status !== "rejected" && (
                <label> Accept as{" "}
                  <select defaultValue="" onChange={(event) => { const v = event.target.value as FailureCategory; if (v) tiAct("accept", "testIntelligence.acceptFailureClassification", { analysisId: a.id, category: v }); }}>
                    <option value="" disabled>Choose…</option>
                    {FAILURE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {a.category === "production-defect" && <span> — routed to Development (no test healing).</span>}
            </li>
          ))}</ul>
        ) : <p>No failure analyses. Use “Analyze failure” to classify a failing test.</p>}
        <div className="button-row">
          <button disabled={Boolean(busy)} onClick={() => { const id = prompt("Test failure id (e.g. test file::name):"); if (!id) return; const path = prompt("Test file path (optional):") ?? undefined; const msg = prompt("Failure message (optional):") ?? undefined; tiAct("analyze-failure", "testIntelligence.createFailureAnalysis", { testFailureId: id, ...(path ? { testFilePath: path } : {}), ...(msg ? { message: msg } : {}) }); }}>Analyze failure</button>
        </div>
      </section>
      <section><h3>Flaky-Test Analysis</h3>
        {ti.flakyClassifications.length ? (
          <ul>{ti.flakyClassifications.map((c) => (
            <li key={`${c.testId}:${c.environmentFingerprint}:${c.revision}`}><strong>{c.state}</strong> — test <code>{c.testId}</code>, runs {c.runCount}, passes {c.passes}, fails {c.failures}, conf {c.confidence.toFixed(2)}<p>{c.evidenceRequiredForStronger}</p></li>
          ))}</ul>
        ) : <p>No flaky classification yet.</p>}
        <div className="button-row">
          <button disabled={Boolean(busy)} onClick={() => { const id = prompt("Test id to repeat:"); if (!id) return; tiAct("repeats", "testIntelligence.requestRepeatedRuns", { testId: id, count: 3, mode: "default" }); }}>Request 3 repeated runs</button>
        </div>
      </section>
      <section><h3>Policy Assessments</h3>
        {ti.policyAssessments.length ? (
          <ul>{ti.policyAssessments.map((pa) => (
            <li key={pa.id}><strong>{pa.status}</strong> — {pa.findings.length} finding(s){pa.findings.filter((f) => f.severity === "blocking").map((f) => <span key={f.id} className="diagnostic error"> {f.rule}: {f.recommendedAction}</span>)}</li>
          ))}</ul>
        ) : <p>No policy assessments.</p>}
      </section>
      <section><h3>Command Approval</h3>
        <button className="primary-button" disabled={!state.qaPlan || state.qaPlan.status !== "ready-for-review" || Boolean(busy)} onClick={() => act("approve", "qa.approvePlan", { qaPlanId: state.qaPlan!.id, expectedHash: state.qaPlan!.contentHash })}>Approve Exact Commands</button>
        <button disabled={!state.qaPlan || state.qaPlan.status !== "approved" || Boolean(busy)} onClick={() => act("execute", "qa.execute", { qaPlanId: state.qaPlan!.id })}>Run Approved Tests</button>
        <button disabled={!runningCommandId} onClick={() => { const commandId = runningCommandId; if (!commandId) return; setError(undefined); void request("qa.cancel", { correlationId: crypto.randomUUID(), workflowId, commandId }).catch(report(setError)); }}>Cancel Running Tests</button>
      </section>
      {output && <details open><summary>Live bounded output</summary><pre className="qa-output">{output}</pre></details>}
      {state.execution && (
        <section><h3>Test Results</h3><p>Status: {state.execution.status} · {state.execution.commandRuns.length} command(s)</p>
          {state.execution.parsedResults.map((result, index) => (
            <article key={index}><strong>{result.framework} · {result.parseStatus}</strong><p>Tests: {result.tests.passed ?? "?"} passed · {result.tests.failed ?? "?"} failed · {result.tests.skipped ?? "?"} skipped</p></article>
          ))}
          <details><summary>Raw command output</summary><pre className="qa-output">{state.execution.commandRuns.map((run) => run.rawOutput).join("\n")}</pre></details>
        </section>
      )}
      {state.decision && (
        <section className={`qa-decision decision-${state.decision.decision}`}><h3>QA Decision</h3><strong>{state.decision.decision}</strong>
          <ul>{state.decision.gates.map((gate) => <li key={gate.id}>{gate.passed ? "Passed" : "Not passed"}: {gate.message}</li>)}</ul>
        </section>
      )}
    </section>
  );
}

function report(setter: (value: string) => void) {
  return (cause: unknown): void => setter(cause instanceof Error ? cause.message : String(cause));
}

type QaRecommendation = {
  title: string;
  rationale: string;
  confidence: number;
  testFile?: string;
  command?: QaPlanItem["command"];
  acceptRoute?: { type: string; payload: Record<string, unknown> };
};

const QA_RECOMMENDATION_ROUTES: Record<string, { type: string; buildPayload: (arg: unknown) => Record<string, unknown> }> = {
  coverageGap: {
    type: "testIntelligence.createGenerationRequest",
    buildPayload: (gapId: unknown) => ({ coverageGapId: String(gapId) }),
  },
  flakyRepeats: {
    type: "testIntelligence.requestRepeatedRuns",
    buildPayload: (testId: unknown) => ({ testId: String(testId), count: 3, mode: "default" }),
  },
  legacyModernize: {
    type: "qa.updatePlan",
    buildPayload: (itemId: unknown) => ({ itemId: String(itemId), selected: true, overrideReason: "Modernize legacy test path." }),
  },
  blockingGap: {
    type: "testIntelligence.createGenerationRequest",
    buildPayload: (gapId: unknown) => ({ coverageGapId: String(gapId) }),
  },
};

function buildAcceptRoute(routeKey: string, arg: unknown): { type: string; payload: Record<string, unknown> } | undefined {
  const route = QA_RECOMMENDATION_ROUTES[routeKey];
  if (!route) return undefined;
  return { type: route.type, payload: route.buildPayload(arg) };
}

function deriveRecommendations(
  state: ImpactQaAggregate,
  ti: QaTestIntelligenceAggregate,
  qaMode: string,
  userPrompt: string,
): QaRecommendation[] {
  const recommendations: QaRecommendation[] = [];
  const prompt = userPrompt.trim().toLowerCase();
  const gaps = state.impactAnalysis?.coverageGaps ?? [];
  const flaky = ti.flakyClassifications;

  if (qaMode === "coverage-gap" || prompt.includes("coverage") || prompt.includes("test gap")) {
    for (const gap of gaps.slice(0, 5)) {
      if (!gap.blocking) continue;
      const existing = ti.generationRequests.some((r) => r.coverageGapId === gap.id);
      recommendations.push({
        title: `Generate tests for coverage gap`,
        rationale: gap.reason,
        confidence: 0.9,
        testFile: gap.recommendedTestLayer,
        acceptRoute: existing ? undefined : buildAcceptRoute("coverageGap", gap.id),
      });
    }
  }

  if (qaMode === "flaky-focused" || prompt.includes("flaky") || prompt.includes("heal")) {
    for (const entry of flaky.slice(0, 5)) {
      const confidence = Math.min(0.99, 0.55 + entry.confidence * 0.35);
      recommendations.push({
        title: `Investigate flaky test ${entry.testId}`,
        rationale: `${entry.state} · ${entry.evidenceRequiredForStronger}`,
        confidence,
        testFile: entry.testId,
        acceptRoute: buildAcceptRoute("flakyRepeats", entry.testId),
      });
    }
  }

  if (qaMode === "legacy-modernize" || prompt.includes("legacy") || prompt.includes("modernize")) {
    const legacyAnnotations = ["skip", "todo", "fixme", "pending"];
    const legacyTests = (state.qaPlan?.requiredItems ?? []).filter((item) =>
      legacyAnnotations.some((token) => item.reason.toLowerCase().includes(token)),
    );
    for (const item of legacyTests.slice(0, 5)) {
      const testFile = item.command.arguments.find((arg) => /\.(spec|test)\./.test(arg));
      recommendations.push({
        title: `Modernize legacy test path: ${item.label}`,
        rationale: item.reason,
        confidence: 0.8,
        testFile,
        command: item.command,
        acceptRoute: buildAcceptRoute("legacyModernize", item.id),
      });
    }
  }

  if (qaMode === "recommend" || prompt) {
    const blocking = gaps.filter((gap) => gap.blocking).slice(0, 3);
    for (const gap of blocking) {
      recommendations.push({
        title: `Prioritize blocking coverage gap`,
        rationale: gap.reason,
        confidence: 0.86,
        testFile: gap.recommendedTestLayer,
        acceptRoute: buildAcceptRoute("blockingGap", gap.id),
      });
    }
  }

  return recommendations;
}
