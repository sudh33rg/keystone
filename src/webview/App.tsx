import { vscode } from "./vscodeApi.js";
import { GraphCanvas, type VisualGraphNode } from "./GraphCanvas.js";
import { selectIntentPrimaryAction, type IntentPrimaryAction } from "@core/intent/primaryAction";
import type {
  ApplicationState,
  BacklogStory,
  BackgroundWorkerId,
  BackgroundWorkerState,
  CopilotDelegationResult,
  CorrectionPacket,
  EvidenceItem,
  IntelligenceCpgResult,
  IntelligenceExplorerItem,
  IntelligenceExplorerResult,
  IntelligenceGraphMode,
  IntelligenceGraphNode,
  IntelligenceGraphResult,
  IntelligenceQueryResult,
  IntelligenceSummary,
  IntelligenceView,
  IngestionState,
  IntentDecision,
  Operation,
  LanguageCapability,
  Nav,
  ContextPacketPayload,
  ContextPacketSegmentKind,
  ContextFragment,
  ContextInspectorItem,
  IntentLifecycle,
  SdlcPlan,
  Story,
  TaskResult
} from "./model.js";

interface AppState {
  nav: Nav;
  application: ApplicationState;
  task?: TaskResult;
  plan?: SdlcPlan;
  notice: string;
  intent: string;
  passphrase: string;
  handoffText: string;
  manualSyncConfirmed: boolean;
  query: string;
  queryItems: EvidenceItem[];
  queryResult?: IntelligenceQueryResult;
  intelligenceView: IntelligenceView;
  explorerQuery: string;
  explorerKind: string;
  explorer?: IntelligenceExplorerResult;
  graphMode: IntelligenceGraphMode;
  graphQuery: string;
  graphRelationshipKind: string;
  graph?: IntelligenceGraphResult;
  selectedGraphNodeId?: string;
  collapsedGraphNodeIds: string[];
  loadedContextPackets: Record<string, ContextPacketPayload>;
  expandedContext?: ContextFragment;
  contextInspectorOpen: boolean;
  expandingContextReference?: string;
  cpg?: IntelligenceCpgResult;
  cpgPath: string;
  cpgEdgeKind: string;
  selectedCpgNodeId?: string;
  agent: string;
  skills: string;
  instructions: string;
  valueEdgeFeatureId: string;
  evidenceText: string;
  selectedCriteria: Record<string, boolean>;
  intentQuestion: string;
  intentBlocker: string;
  selectedStoryId?: string;
  decisionDiscussion?: {
    decisionId: string;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
    input: string;
    pending: boolean;
  };
  rejectingDecisionId?: string;
  rejectionReason: string;
}

const emptyApplication: ApplicationState = {
  version: 1,
  status: "idle",
  intelligenceActivity: [],
  handoffs: [],
  operations: []
};
const intelligenceViews: IntelligenceView[] = [
  "Overview",
  "Explorer",
  "Graph",
  "CPG",
  "Flows",
  "Query"
];
const graphModes: IntelligenceGraphMode[] = [
  "repository",
  "architecture",
  "dependencies",
  "calls",
  "tests",
  "impact"
];
const intentLifecycleTransitions: Record<IntentLifecycle, IntentLifecycle[]> = {
  DRAFT: ["UNDERSTANDING"],
  UNDERSTANDING: ["READY", "DRAFT", "BLOCKED"],
  READY: ["IN_PROGRESS", "UNDERSTANDING", "BLOCKED"],
  IN_PROGRESS: ["BLOCKED", "REVIEW", "READY"],
  BLOCKED: ["IN_PROGRESS"],
  REVIEW: ["COMPLETE", "IN_PROGRESS"],
  COMPLETE: ["REVIEW"]
};
const intentLifecycleLabel = (lifecycle: IntentLifecycle): string =>
  lifecycle
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

export class App extends React.Component<Record<string, never>, AppState> {
  state: AppState = {
    nav: navFromHash(),
    application: emptyApplication,
    notice: "",
    intent: "",
    passphrase: "",
    handoffText: "",
    manualSyncConfirmed: false,
    query: "",
    queryItems: [],
    intelligenceView: "Overview",
    explorerQuery: "",
    explorerKind: "all",
    graphMode: "repository",
    graphQuery: "",
    graphRelationshipKind: "all",
    collapsedGraphNodeIds: [],
    loadedContextPackets: {},
    contextInspectorOpen: false,
    expandingContextReference: undefined,
    cpgPath: "",
    cpgEdgeKind: "all",
    agent: "GitHub Copilot",
    skills: "",
    instructions:
      "Follow the approved specification and repository instructions. Use only the supplied evidence. Do not perform Git write operations.",
    valueEdgeFeatureId: "",
    evidenceText: "",
    selectedCriteria: {},
    intentQuestion: "",
    intentBlocker: "",
    rejectionReason: ""
  };
  private readonly onMessage = (event: MessageEvent): void =>
    this.handle(event.data as { type?: string; [key: string]: unknown });
  private readonly onHash = (): void => this.setState({ nav: navFromHash(), notice: "" });
  private intentInput?: HTMLTextAreaElement;

  componentDidMount(): void {
    window.addEventListener("message", this.onMessage);
    window.addEventListener("hashchange", this.onHash);
    vscode.postMessage({ type: "WEBVIEW_READY" });
    vscode.postMessage({ type: "LOAD_INTELLIGENCE" });
    vscode.postMessage({ type: "LOAD_RESTORED_TASK_HANDOFF" });
  }
  componentWillUnmount(): void {
    window.removeEventListener("message", this.onMessage);
    window.removeEventListener("hashchange", this.onHash);
  }

  private handle(message: { type?: string; [key: string]: unknown }): void {
    if (!message.type) return;
    if (message.type === "APPLICATION_STATE") {
      const application = message.state as ApplicationState;
      this.setState({
        application,
        task: application.taskAnalysis ?? this.state.task,
        plan: application.sdlc ?? this.state.plan
      });
    } else if (message.type === "STATE_UPDATE") {
      const patch = message.state as Partial<ApplicationState>;
      this.setState((previous) => ({
        application: {
          ...previous.application,
          ...patch,
          version: previous.application.version + 1
        }
      }));
    } else if (message.type === "TASK_RESULT") {
      this.setState({
        task: message.result as TaskResult,
        loadedContextPackets: {},
        expandedContext: undefined,
        contextInspectorOpen: false,
        expandingContextReference: undefined,
        notice: "Intent R&D is ready. Review evidence and create the SDLC plan."
      });
    } else if (message.type === "SDLC_PLAN_RESULT") {
      const plan = message.plan as SdlcPlan;
      this.setState({
        plan,
        nav: "Work",
        evidenceText: "",
        selectedCriteria: {},
        selectedStoryId:
          this.state.selectedStoryId &&
          plan.stories.some((story) => story.id === this.state.selectedStoryId)
            ? this.state.selectedStoryId
            : undefined
      });
    } else if (message.type === "INDEX_PROGRESS") {
      const progress = Number(message.progress ?? 0);
      const progressMessage = String(message.message ?? "");
      const workerPool = message.workerPool as IngestionState["workerPool"] | undefined;
      this.setState((previous) => {
        const ingestion: IngestionState = {
          ...(previous.application.ingestion ?? {
            active: true,
            progress: 0,
            stage: "indexing",
            message: "Repository indexing is in progress."
          }),
          active: progress < 100,
          progress,
          stage: String(message.stage ?? "indexing"),
          message: progressMessage,
          queuedRefresh: progress < 100 ? previous.application.ingestion?.queuedRefresh : false,
          ...(workerPool ? { workerPool } : {})
        };
        const operation: Operation = {
          id: "repository-index",
          kind: "intelligence",
          status: progress >= 100 ? "completed" : "running",
          progress,
          message: progressMessage,
          updatedAt: new Date().toISOString()
        };
        return {
          application: {
            ...previous.application,
            status: progress >= 100 ? "ready" : "indexing",
            ingestion,
            operations: [
              operation,
              ...(previous.application.operations ?? []).filter((item) => item.id !== operation.id)
            ],
            version: previous.application.version + 1
          },
          notice: `${String(message.stage ?? "indexing")} · ${progress}% · ${progressMessage}`
        };
      });
    } else if (message.type === "QA_BACKGROUND_STATUS") {
      const status = message.status as BackgroundWorkerState["status"];
      this.setState((previous) => ({
        application: {
          ...previous.application,
          backgroundWorkers: {
            ...previous.application.backgroundWorkers,
            qa: {
              status,
              progress: Number(message.progress ?? (status === "complete" ? 100 : 0)),
              message: String(message.message ?? `QA background worker is ${status}.`),
              error:
                status === "failed" || status === "cancelled" || status === "stale"
                  ? String(message.message ?? "")
                  : undefined,
              result: message.result,
              canonicalEvidence: (
                message.result as
                  | {
                      canonicalEvidence?: BackgroundWorkerState["canonicalEvidence"];
                    }
                  | undefined
              )?.canonicalEvidence,
              workerId: message.workerId as string | undefined,
              snapshotDigest: message.snapshotDigest as string | undefined,
              extractionRunId: message.extractionRunId as string | undefined,
              scopePaths: message.scopePaths
                ? [...(message.scopePaths as readonly string[])]
                : undefined,
              startedAt: message.startedAt as string | undefined,
              completedAt: message.completedAt as string | undefined,
              durationMs: message.durationMs as number | undefined,
              attempt: message.attempt as number | undefined,
              maxAttempts: message.maxAttempts as number | undefined,
              retryCount: message.retryCount as number | undefined,
              retryAt: message.retryAt as string | undefined,
              updatedAt: new Date().toISOString()
            }
          },
          version: previous.application.version + 1
        },
        notice: message.message ? String(message.message) : `QA background worker is ${status}.`
      }));
    } else if (message.type === "BACKGROUND_ANALYSIS_STATUS") {
      const worker = String(message.worker) as BackgroundWorkerId;
      const status = message.status as BackgroundWorkerState["status"];
      this.setState((previous) => ({
        application: {
          ...previous.application,
          backgroundWorkers: {
            ...previous.application.backgroundWorkers,
            [worker]: {
              status,
              progress: status === "complete" ? 100 : 0,
              message: String(message.error ?? `${worker} background worker is ${status}.`),
              error: message.error ? String(message.error) : undefined,
              result: message.result,
              canonicalEvidence: (
                message.result as
                  | {
                      canonicalEvidence?: BackgroundWorkerState["canonicalEvidence"];
                    }
                  | undefined
              )?.canonicalEvidence,
              workerId: message.workerId as string | undefined,
              snapshotDigest: message.snapshotDigest as string | undefined,
              extractionRunId: message.extractionRunId as string | undefined,
              scopePaths: message.scopePaths
                ? [...(message.scopePaths as readonly string[])]
                : undefined,
              startedAt: message.startedAt as string | undefined,
              completedAt: message.completedAt as string | undefined,
              durationMs: message.durationMs as number | undefined,
              attempt: message.attempt as number | undefined,
              maxAttempts: message.maxAttempts as number | undefined,
              retryCount: message.retryCount as number | undefined,
              retryAt: message.retryAt as string | undefined,
              updatedAt: new Date().toISOString()
            }
          },
          version: previous.application.version + 1
        },
        notice: String(message.error ?? `${worker} background worker is ${status}.`)
      }));
    } else if (message.type === "INTELLIGENCE_QUERY_RESULT") {
      const result = message.result as IntelligenceQueryResult;
      this.setState({
        queryResult: result,
        queryItems: result.items ?? [],
        notice: `${result.intent} query traversed ${result.traversedRelationships} relationship(s) and returned ${result.items?.length ?? 0} evidence-backed result(s).`
      });
    } else if (message.type === "INTELLIGENCE_EXPLORER_RESULT") {
      const result = message.result as IntelligenceExplorerResult;
      const previous = this.state.explorer;
      const isContinuation = Boolean(
        result.cursor &&
        previous?.nextCursor === result.cursor &&
        previous.query === result.query &&
        (previous.kind ?? "all") === (result.kind ?? "all")
      );
      const explorer = isContinuation
        ? { ...result, items: [...(previous?.items ?? []), ...result.items] }
        : result;
      this.setState({
        explorer,
        notice: ""
      });
    } else if (message.type === "INTELLIGENCE_GRAPH_RESULT") {
      const result = message.result as IntelligenceGraphResult;
      const relationshipKind =
        this.state.graphRelationshipKind === "all" ||
        result.relationshipKinds.includes(this.state.graphRelationshipKind)
          ? this.state.graphRelationshipKind
          : "all";
      this.setState({
        graph: result,
        graphMode: result.mode,
        graphRelationshipKind: relationshipKind,
        selectedGraphNodeId: result.seedIds[0],
        collapsedGraphNodeIds: [],
        notice: `${result.mode} graph loaded ${result.nodes.length} node(s) and ${result.edges.length} relationship(s).`
      });
    } else if (message.type === "CPG_VIEW_RESULT") {
      const result = message.result as IntelligenceCpgResult;
      this.setState({
        cpg: result,
        cpgPath: result.sourcePath ?? this.state.cpgPath,
        selectedCpgNodeId: result.nodes[0]?.id,
        notice: result.sourcePath
          ? `CPG loaded for ${result.sourcePath}.`
          : "No persisted CPG shard is available yet."
      });
    } else if (message.type === "CONTEXT_PACKET_RESULT") {
      const packet = message.packet as ContextPacketPayload | undefined;
      this.setState((previous) => ({
        loadedContextPackets: packet
          ? { ...previous.loadedContextPackets, [packet.id]: packet }
          : previous.loadedContextPackets,
        notice: message.stale
          ? `Context packet ${String(message.packetId)} is stale. Regenerate intent context after the latest indexing run.`
          : `Loaded context packet ${String(message.packetId)} (${packet?.segmentKinds.join(" · ") ?? "no segments"}).`
      }));
    } else if (message.type === "CONTEXT_FRAGMENT_RESULT") {
      this.setState({
        expandedContext: message.fragment as ContextFragment,
        expandingContextReference: undefined,
        notice: `Expanded ${String((message.fragment as ContextFragment).candidates.length)} retained context candidate(s).`
      });
    } else if (message.type === "VALIDATION_RESULT") {
      const results = (message.results as Array<{ status: string }> | undefined) ?? [];
      this.setState({
        notice: results.every((item) => item.status === "passed")
          ? `Validation passed for ${results.length} command(s).`
          : "Validation requires review; inspect the active SDLC story."
      });
    } else if (message.type === "CORRECTION_PACKET_RESULT") {
      const packet = message.packet as CorrectionPacket;
      this.setState((previous) => ({
        application: { ...previous.application, correctionPacket: packet },
        notice: `Correction packet ${packet.id} is ready from ${packet.validation.failures.length} validation failure(s) and ${packet.canonical.unitIds.length} OKF unit(s).`
      }));
    } else if (message.type === "DELEGATION_RESULT") {
      const result = message as unknown as CopilotDelegationResult;
      this.setState((previous) => ({
        application: { ...previous.application, delegationResult: result },
        notice: result.success
          ? result.captured
            ? "Copilot response was captured by Keystone and linked to the active SDLC story."
            : "Copilot delegation opened externally; Keystone is waiting for concrete returned evidence."
          : String(result.error ?? "Delegation failed.")
      }));
    } else if (message.type === "DECISION_DISCUSSION_RESULT") {
      const result = message.result as CopilotDelegationResult;
      this.setState((previous) => {
        const discussion = previous.decisionDiscussion;
        if (!discussion || discussion.decisionId !== String(message.decisionId)) return null;
        const last = discussion.messages.at(-1);
        const messages = result.text
          ? last?.role === "assistant"
            ? [...discussion.messages.slice(0, -1), { role: "assistant" as const, text: result.text }]
            : [...discussion.messages, { role: "assistant" as const, text: result.text }]
          : discussion.messages;
        return {
          decisionDiscussion: {
            ...discussion,
            pending: false,
            messages
          },
          notice: result.success
            ? "Copilot replied in the decision discussion. Resolve it when the conclusion is clear."
            : String(result.error ?? "Discussion failed.")
        };
      });
    } else if (message.type === "COPILOT_ACTIVITY") {
      this.setState({ notice: String(message.message) });
    } else if (message.type === "COPILOT_STREAM") {
      const stream = message as {
        contextPackageId?: string;
        storyId?: string;
        discussionId?: string;
        text?: string;
      };
      if (stream.discussionId) {
        this.setState((previous) => {
          const discussion = previous.decisionDiscussion;
          if (!discussion || discussion.decisionId !== stream.discussionId || !stream.text)
            return null;
          const last = discussion.messages.at(-1);
          const messages =
            last?.role === "assistant"
              ? [
                  ...discussion.messages.slice(0, -1),
                  { role: "assistant" as const, text: `${last.text}${stream.text}` }
                ]
              : [...discussion.messages, { role: "assistant" as const, text: stream.text }];
          return { decisionDiscussion: { ...discussion, messages } };
        });
        return;
      }
      this.setState((previous) => ({
        application: {
          ...previous.application,
          delegationResult: {
            ...(previous.application.delegationResult ?? {
              success: true,
              captured: true,
              mode: "Copilot Chat",
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString()
            }),
            contextPackageId: stream.contextPackageId,
            storyId: stream.storyId,
            streaming: true,
            text: `${previous.application.delegationResult?.text ?? ""}${stream.text ?? ""}`
          }
        }
      }));
    } else if (message.type === "TASK_HANDOFF_CREATED") {
      this.setState({
        handoffText: String(message.encryptedPackage ?? ""),
        notice: `Encrypted Task Handoff created and copied to the clipboard. Checksum ${String(message.checksum ?? "").slice(0, 12)}…`
      });
    } else if (message.type === "TASK_HANDOFF_RESTORED") {
      this.setState({
        plan:
          (message.packageValue as { sdlcPlan?: SdlcPlan } | undefined)?.sdlcPlan ??
          this.state.plan,
        notice: "Task Handoff restored. Continue from the exact next action."
      });
    } else if (message.type === "BROWSER_VIEW_OPENED") {
      this.setState({ notice: "The synchronized Browser View is open." });
    } else if (message.type === "VALUEEDGE_FEATURE_RESULT") {
      const feature = message.feature as { id?: string; name?: string; description?: string };
      this.setState({
        intent: [feature.name, feature.description].filter(Boolean).join("\n\n"),
        notice: `Imported ValueEdge feature ${feature.id ?? ""}.`
      });
    } else if (message.type === "VALUEEDGE_PUBLISH_RESULT") {
      this.setState({
        notice: `Published ${((message.published as unknown[]) ?? []).length} approved stories to ValueEdge.`
      });
    } else if (message.type === "NOTIFICATION" || message.type === "ERROR") {
      const notification = String(message.message ?? "Operation failed.");
      this.setState((previous) => ({
        application: notification.startsWith("Refresh queued")
          ? {
              ...previous.application,
              status: "indexing",
              ingestion: {
                ...(previous.application.ingestion ?? {
                  active: true,
                  progress: 0,
                  stage: "indexing",
                  message: "Repository indexing is in progress."
                }),
                active: true,
                queuedRefresh: true
              },
              version: previous.application.version + 1
            }
          : previous.application,
        notice: notification,
        expandingContextReference: undefined
      }));
    }
  }

  private navigate(nav: Nav): void {
    location.hash = nav;
    this.setState({ nav, notice: "" });
    if (nav === "Intelligence") this.loadIntelligenceSurface(this.state.intelligenceView);
  }
  private startNewWork(): void {
    this.navigate("Home");
    window.setTimeout(() => this.intentInput?.focus(), 0);
  }
  private dismissNotice(): void {
    this.setState({ notice: "" });
  }
  private field(name: keyof AppState, value: string | boolean): void {
    this.setState({ [name]: value } as unknown as Pick<AppState, keyof AppState>);
  }
  private toggleCriterion(criterion: string, checked: boolean): void {
    this.setState((previous) => ({
      selectedCriteria: { ...previous.selectedCriteria, [criterion]: checked }
    }));
  }
  private currentStory(): Story | undefined {
    const selected = this.state.selectedStoryId
      ? this.state.plan?.stories.find((story) => story.id === this.state.selectedStoryId)
      : undefined;
    return (
      selected ??
      this.state.plan?.stories.find((story) =>
        [
          "in-progress",
          "awaiting-delegation-approval",
          "delegated",
          "awaiting-validation",
          "review-required"
        ].includes(story.status)
      ) ??
      this.state.plan?.stories.find((story) => story.status === "ready")
    );
  }
  private isIndexing(): boolean {
    return (
      this.state.application.status === "indexing" ||
      (this.state.application.operations ?? []).some(
        (operation) => operation.id === "repository-index" && operation.status === "running"
      )
    );
  }
  private indexButtonLabel(defaultLabel: string): string {
    return this.isIndexing() ? "Stop ingestion" : defaultLabel;
  }
  private ingestionStatus(): JSX.Element | null {
    const ingestion = this.state.application.ingestion;
    if (!ingestion) return null;
    const progress = Math.max(0, Math.min(100, ingestion.progress));
    const pool = ingestion.workerPool;
    return (
      <Panel
        title="Repository ingestion"
        subtitle="Structural discovery, OKF promotion, and intelligence stages run in the background."
      >
        <div className="ingestion-header">
          <div>
            <strong>{ingestion.active ? "In progress" : "Ready"}</strong>
            <small>
              {ingestion.stage} · {progress}%
            </small>
          </div>
          <Status value={ingestion.active ? "running" : "complete"} />
        </div>
        <div className="progress" aria-label={`Repository ingestion ${progress}%`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <p className="result-summary">{ingestion.message}</p>
        {pool && (
          <div className="worker-pool-summary">
            <div>
              <span>Worker pool</span>
              <strong>
                {pool.activeWorkers}/{pool.maxWorkers} active
              </strong>
            </div>
            <div>
              <span>Stages</span>
              <strong>
                {pool.completedStages}/{pool.totalStages} complete
              </strong>
            </div>
            <div>
              <span>Queued</span>
              <strong>{pool.queuedStages}</strong>
            </div>
            {pool.currentStages.length > 0 && (
              <div className="worker-stage-list">
                <span>Running now</span>
                <div>
                  {pool.currentStages.map((stage) => (
                    <span className="worker-chip" key={stage}>
                      {stage}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {ingestion.queuedRefresh && (
          <div className="callout warning">
            Refresh queued. It will start automatically after this run completes.
          </div>
        )}
      </Panel>
    );
  }
  private backgroundWorkerPanel(): JSX.Element {
    const workerLabels: Record<BackgroundWorkerId, string> = {
      qa: "QA gap analysis",
      security: "Security analysis",
      performance: "Performance analysis",
      modernization: "Modernization analysis"
    };
    const workers: BackgroundWorkerId[] = ["qa", "security", "performance", "modernization"];
    return (
      <Panel
        title="Background workers"
        subtitle="Four independent analysis workers turn indexed repository evidence into findings and next actions."
      >
        <div className="background-worker-grid">
          {workers.map((worker) => {
            const state = this.state.application.backgroundWorkers?.[worker];
            const progress = state?.progress;
            return (
              <article className="background-worker-card" key={worker}>
                <div className="background-worker-header">
                  <strong>{workerLabels[worker]}</strong>
                  <Status value={state?.status ?? "idle"} />
                </div>
                <p>{state?.message ?? "Waiting for the workspace scan to start."}</p>
                {state?.canonicalEvidence ? (
                  <small className="worker-evidence">
                    Repository evidence · {state.canonicalEvidence.unitIds.length} code element(s) ·{" "}
                    {state.canonicalEvidence.relationshipIds.length} relationship(s) ·{" "}
                    {state.canonicalEvidence.evidenceIds.length} evidence link(s)
                  </small>
                ) : state?.status === "complete" ? (
                  <small className="worker-evidence">
                    Completed without additional persisted repository evidence.
                  </small>
                ) : null}
                {state?.error && <small className="worker-error">{state.error}</small>}
                {state?.scopePaths?.length ? (
                  <small className="worker-meta">
                    Analysis scope: {state.scopePaths.length} repository path(s)
                    {state.durationMs !== undefined ? ` · ${state.durationMs}ms` : ""}
                  </small>
                ) : null}
                {state?.status === "complete" && (
                  <WorkerInsights worker={worker} result={state.result} />
                )}
                {state?.retryAt && state.status === "failed" && (
                  <small className="worker-meta">
                    Retry scheduled for {new Date(state.retryAt).toLocaleTimeString()}.
                  </small>
                )}
                {progress !== undefined && (
                  <div className="progress" aria-label={`${workerLabels[worker]} ${progress}%`}>
                    <i style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
      </Panel>
    );
  }
  private selectStory(story: Story): void {
    this.setState({
      selectedStoryId: story.id,
      evidenceText: "",
      selectedCriteria: Object.fromEntries(story.satisfiedCriteria.map((value) => [value, true]))
    });
  }

  private completeStory(story: Story): void {
    const evidence = this.state.evidenceText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean);
    const satisfied = story.acceptanceCriteria.filter(
      (criterion) =>
        this.state.selectedCriteria[criterion] || story.satisfiedCriteria.includes(criterion)
    );
    if (!evidence.length || satisfied.length !== story.acceptanceCriteria.length) {
      this.setState({
        notice:
          "Completion requires concrete evidence and every acceptance criterion to be explicitly confirmed."
      });
      return;
    }
    vscode.postMessage({
      type: "SDLC_TRANSITION",
      storyId: story.id,
      status: "completed",
      evidence,
      satisfiedCriteria: satisfied
    });
  }

  render(): JSX.Element {
    const intel = this.state.application.intelligence;
    return (
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <span className="mark" role="img" aria-label="Keystone" />
            <div>
              <strong>Keystone</strong>
              <span>Deterministic engineering intelligence</span>
            </div>
          </div>
          <div className="header-actions">
            <span className="surface-pill">
              {vscode.surface === "browser" ? "Browser View · shared state" : "VS Code Webview"}
            </span>
            <button className="primary" onClick={() => this.startNewWork()}>
              Start new work
            </button>
            <button onClick={() => vscode.postMessage({ type: "OPEN_BROWSER_VIEW" })}>
              Open in Browser
            </button>
          </div>
        </header>
        <aside className="nav">
          {(["Home", "Intelligence", "Work", "Activity"] as Nav[]).map((nav) => (
            <button
              key={nav}
              className={this.state.nav === nav ? "active" : ""}
              onClick={() => this.navigate(nav)}
            >
              <span className="nav-dot" />
              {nav}
            </button>
          ))}
        </aside>
        <main>
          {this.state.notice && (
            <div className="notice" role="status" aria-live="polite">
              <span className="pulse" />
              <span className="notice-message">{this.state.notice}</span>
              <button
                className="notice-close"
                type="button"
                aria-label="Dismiss notification"
                title="Dismiss notification"
                onClick={() => this.dismissNotice()}
              >
                ×
              </button>
            </div>
          )}
          {this.state.nav === "Home"
            ? this.home(intel)
            : this.state.nav === "Intelligence"
              ? this.intelligence(intel)
              : this.state.nav === "Work"
                ? this.work()
                : this.activity()}
        </main>
      </div>
    );
  }

  private home(intel?: IntelligenceSummary): JSX.Element {
    const plan = this.state.plan;
    const completed = plan?.stories.filter((story) => story.status === "completed").length ?? 0;
    const total = plan?.stories.length ?? 0;
    return (
      <section>
        <div className="page-title">
          <div>
            <p className="eyebrow">ACTIVE WORKSPACE</p>
            <h1>{this.state.application.workspace?.name ?? "Keystone workspace"}</h1>
            <p>
              One intelligence model, one SDLC state, and the same UI in VS Code and the browser.
            </p>
          </div>
          <div className="actions">
            <button
              className="primary"
              onClick={() =>
                this.isIndexing()
                  ? vscode.postMessage({ type: "CANCEL_INGESTION" })
                  : vscode.postMessage({ type: "INDEX_REPO", force: true })
              }
            >
              {this.indexButtonLabel("Index / refresh")}
            </button>
            <button onClick={() => this.navigate("Intelligence")}>Explore intelligence</button>
            <button onClick={() => this.navigate("Work")}>Open work</button>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Intelligence"
            value={this.state.application.status}
            detail={intel?.okf?.validated ? "OKF validated" : "Awaiting validated snapshot"}
          />
          <Metric
            label="Repository"
            value={`${intel?.fileCount ?? 0} files`}
            detail={`${intel?.languageCapabilities?.filter((item) => (item.files ?? 0) > 0).length ?? 0} detected language frontends`}
          />
          <Metric
            label="Context"
            value={
              this.state.task ? `${this.state.task.tokenReduction ?? 0}% smaller` : "Not prepared"
            }
            detail={
              this.state.task?.contextManifest
                ? `${this.state.task.contextManifest.usedTokens}/${this.state.task.contextManifest.delegationTokenBudget} delegation tokens`
                : "Ingestion is never budget-limited"
            }
          />
          <Metric
            label="SDLC"
            value={total ? `${completed}/${total}` : "No active plan"}
            detail={plan?.specificationStatus ?? "Start from an intent"}
          />
        </div>
        {this.ingestionStatus()}
        <div className="two-column">
          <Panel
            title="Start from intent"
            subtitle="Keystone researches the actual repository first, then hands only relevant intelligence to Copilot for implementation."
          >
            <textarea
              ref={(element: HTMLTextAreaElement | null) => {
                this.intentInput = element ?? undefined;
              }}
              value={this.state.intent}
              onChange={(event: React.FormEvent<HTMLTextAreaElement>) =>
                this.field("intent", event.currentTarget.value)
              }
              placeholder="Describe the feature, defect, modernization, QA, security, or performance intent…"
            />
            <div className="actions">
              <button
                className="primary"
                disabled={!this.state.intent.trim()}
                onClick={() =>
                  vscode.postMessage({ type: "ANALYZE_INTENT", text: this.state.intent.trim() })
                }
              >
                Understand Intent
              </button>
              {this.state.task?.researchStatus === "ready" && (
                <button
                  onClick={() =>
                    vscode.postMessage({
                      type: "APPROVE_INTENT_RESEARCH",
                      intentId: this.state.task!.intentId
                    })
                  }
                >
                  Approve R&D
                </button>
              )}
              {this.state.task?.researchStatus === "approved" && (
                <button
                  onClick={() =>
                    vscode.postMessage({
                      type: "CREATE_SDLC_PLAN",
                      intent: this.state.task!.researchDocument.problemStatement
                    })
                  }
                >
                  Create plan from R&D
                </button>
              )}
            </div>
          </Panel>
          <Panel
            title="Current evidence"
            subtitle="The active task is grounded in persisted repository intelligence."
          >
            <EvidenceList
              items={(this.state.task?.evidence ?? []).slice(0, 8)}
              empty="Analyze an intent to see source-backed evidence."
              onOpen={(path, line) => this.openSource(path, line)}
            />
          </Panel>
        </div>
        <Panel
          title="Context"
          subtitle="A focused view of what Keystone prepared for the active intent and what can be retrieved if needed."
        >
          {this.contextExperience(this.state.task)}
        </Panel>
        {this.state.task && !plan && this.prePlanResearch(this.state.task)}
        <Panel
          title="ValueEdge feature"
          subtitle="Import a Feature, research it locally, approve the plan, then publish draft user and quality stories."
        >
          <div className="inline-form">
            <input
              value={this.state.valueEdgeFeatureId}
              onChange={(event: React.FormEvent<HTMLInputElement>) =>
                this.field("valueEdgeFeatureId", event.currentTarget.value)
              }
              placeholder="Feature ID"
            />
            <button onClick={() => vscode.postMessage({ type: "CONFIGURE_VALUEEDGE" })}>
              Configure
            </button>
            <button
              disabled={!this.state.valueEdgeFeatureId.trim()}
              onClick={() =>
                vscode.postMessage({
                  type: "IMPORT_VALUEEDGE_FEATURE",
                  featureId: this.state.valueEdgeFeatureId.trim()
                })
              }
            >
              Import
            </button>
            <button
              disabled={plan?.specificationStatus !== "approved"}
              onClick={() => vscode.postMessage({ type: "PUBLISH_VALUEEDGE_STORIES" })}
            >
              Publish approved stories
            </button>
          </div>
        </Panel>
      </section>
    );
  }

  private intelligence(intel?: IntelligenceSummary): JSX.Element {
    const okf = intel?.okf;
    return (
      <section>
        <div className="page-title">
          <div>
            <p className="eyebrow">INTELLIGENCE LAYER</p>
            <h1>Visible, queryable engineering intelligence</h1>
            <p>
              Canonical OKF is the knowledge contract. Graph, CPG and flow views are live
              projections of persisted intelligence—not demo counters.
            </p>
          </div>
          <button
            className="primary"
            onClick={() =>
              this.isIndexing()
                ? vscode.postMessage({ type: "CANCEL_INGESTION" })
                : vscode.postMessage({ type: "INDEX_REPO", force: true })
            }
          >
            {this.indexButtonLabel("Refresh intelligence")}
          </button>
        </div>
        <div className="metric-grid">
          <Metric
            label="OKF units"
            value={String(okf?.units ?? 0)}
            detail={`${okf?.active ?? 0} active · ${okf?.deleted ?? 0} lifecycle tombstones`}
          />
          <Metric
            label="Relationships"
            value={String(okf?.relationships ?? 0)}
            detail={`${okf?.graphEdges ?? 0} graph edges`}
          />
          <Metric
            label="Evidence"
            value={String(okf?.evidence ?? 0)}
            detail={`${okf?.observations ?? 0} observations`}
          />
          <Metric
            label="CPG bindings"
            value={String(okf?.cpgBindings ?? 0)}
            detail={okf?.validated ? "linked to validated OKF" : "awaiting promoted OKF"}
          />
        </div>
        <div className="subnav">
          {intelligenceViews.map((view) => (
            <button
              key={view}
              className={this.state.intelligenceView === view ? "active" : ""}
              onClick={() => this.openIntelligenceView(view)}
            >
              {view}
            </button>
          ))}
        </div>
        {this.state.intelligenceView === "Overview"
          ? this.intelligenceOverview(intel)
          : this.state.intelligenceView === "Explorer"
            ? this.intelligenceExplorer()
            : this.state.intelligenceView === "Graph"
              ? this.intelligenceGraph(false)
              : this.state.intelligenceView === "CPG"
                ? this.intelligenceCpg()
                : this.state.intelligenceView === "Flows"
                  ? this.intelligenceGraph(true)
                  : this.intelligenceQuery()}
      </section>
    );
  }

  private intelligenceOverview(intel?: IntelligenceSummary): JSX.Element {
    const okf = intel?.okf;
    const languages = intel?.languageCapabilities ?? [];
    return (
      <div className="view-stack">
        <div className="two-column">
          <Panel
            title="OKF validation and projections"
            subtitle={okf?.profile ?? "No promoted snapshot"}
          >
            {okf ? (
              <ul className="fact-list">
                <li>
                  <b>Profile</b>
                  <span>{okf.version}</span>
                </li>
                <li>
                  <b>Extraction run</b>
                  <code>{okf.extractionRunId}</code>
                </li>
                <li>
                  <b>Validation</b>
                  <Status value={okf.validated ? "passed" : "failed"} />
                </li>
                <li>
                  <b>Graph</b>
                  <span>
                    {okf.graphNodes} nodes · {okf.graphEdges} edges
                  </span>
                </li>
                <li>
                  <b>CPG bindings</b>
                  <span>{okf.cpgBindings}</span>
                </li>
                <li>
                  <b>Portable OKF</b>
                  <span>{okf.portableBundle?.validated ? "validated" : "not generated"}</span>
                </li>
              </ul>
            ) : (
              <Empty text="Run repository indexing." />
            )}
          </Panel>
          <Panel
            title="Evidence provenance"
            subtitle="Source evidence from the promoted OKF snapshot."
          >
            {okf?.evidenceSamples?.length ? (
              <div className="evidence-stack">
                {okf.evidenceSamples.slice(0, 14).map((item) => (
                  <div key={item.id}>
                    <button className="link-button" onClick={() => this.openSource(item.path)}>
                      {item.path}
                    </button>
                    <span>{item.method}</span>
                    <small>{new Date(item.observedAt).toLocaleString()}</small>
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No evidence loaded." />
            )}
          </Panel>
        </div>
        <Panel
          title="Language capability registry"
          subtitle="Every recognized text language receives deterministic discovery, structure, CPG, OKF and evidence; compiler/language-service providers deepen semantics when available."
        >
          <div className="language-grid">
            {languages.map((language) => (
              <LanguageCard key={language.id} language={language} />
            ))}
          </div>
        </Panel>
        <Panel
          title="Projects and technology fingerprints"
          subtitle="Manifest- and source-evidence-backed module boundaries."
        >
          {intel?.projectFingerprints?.length ? (
            <ul className="fact-list">
              {intel.projectFingerprints.map((project) => (
                <li key={project.projectPath}>
                  <b>{project.name}</b>
                  <span>
                    {[
                      ...project.languages,
                      ...project.frameworks,
                      ...project.persistence,
                      ...project.databases,
                      ...project.messaging,
                      ...project.contracts
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Structure-only"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty text="Run repository indexing to derive project fingerprints." />
          )}
        </Panel>
      </div>
    );
  }

  private intelligenceExplorer(): JSX.Element {
    const result = this.state.explorer;
    const kinds = Object.keys(result?.kindCounts ?? {}).sort();
    return (
      <Panel
        title="Knowledge Explorer"
        subtitle="Browse the canonical OKF units that drive query, graph, intent retrieval, context compression and SDLC evidence."
      >
        <div className="inline-form">
          <input
            className="grow"
            value={this.state.explorerQuery}
            onChange={(event: React.FormEvent<HTMLInputElement>) =>
              this.field("explorerQuery", event.currentTarget.value)
            }
            placeholder="Symbol, API, service, database, table, query, flag, test…"
          />
          <select
            value={this.state.explorerKind}
            onChange={(event: React.FormEvent<HTMLSelectElement>) =>
              this.setState({ explorerKind: event.currentTarget.value, explorer: undefined })
            }
          >
            <option value="all">All kinds</option>
            {kinds.map((kind) => (
              <option key={kind} value={kind}>
                {kind} ({result?.kindCounts[kind] ?? 0})
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => this.loadExplorer(true)}>
            Search
          </button>
        </div>
        {result && (
          <p className="result-summary">
            Showing {result.items.length} of {result.totalMatching} matching OKF unit(s) ·{" "}
            {result.totalActive} active in snapshot
          </p>
        )}
        <div className="explorer-list">
          {result?.items.map((item) => (
            <ExplorerRow
              key={item.id}
              item={item}
              onOpen={(path, line) => this.openSource(path, line)}
              onGraph={(value) => this.showExplorerItemInGraph(value)}
            />
          )) ?? <Empty text="Open Explorer to load the promoted OKF snapshot." />}
        </div>
        {result?.nextCursor && (
          <div className="inline-form explorer-pagination">
            <button onClick={() => this.loadExplorer()}>
              Load next {result.pageSize} · {result.totalMatching - result.items.length} remaining
            </button>
          </div>
        )}
      </Panel>
    );
  }

  private intelligenceGraph(flowOnly: boolean): JSX.Element {
    const result = this.state.graph;
    const selected = result?.nodes.find((node) => node.id === this.state.selectedGraphNodeId);
    const mode: IntelligenceGraphMode = flowOnly ? "flows" : this.state.graphMode;
    const relationshipEdges = (result?.edges ?? []).filter(
      (edge) =>
        this.state.graphRelationshipKind === "all" || edge.kind === this.state.graphRelationshipKind
    );
    const collapsed = new Set(this.state.collapsedGraphNodeIds);
    const hidden = new Set<string>();
    const pending = [...collapsed];
    while (pending.length) {
      const sourceId = pending.shift()!;
      for (const edge of relationshipEdges) {
        if (edge.sourceId !== sourceId || hidden.has(edge.targetId)) continue;
        if ((result?.seedIds ?? []).includes(edge.targetId)) continue;
        hidden.add(edge.targetId);
        pending.push(edge.targetId);
      }
    }
    const visibleEdges = relationshipEdges.filter(
      (edge) => !hidden.has(edge.sourceId) && !hidden.has(edge.targetId)
    );
    const connectedIds = new Set<string>([...(result?.seedIds ?? [])]);
    for (const edge of visibleEdges) {
      connectedIds.add(edge.sourceId);
      connectedIds.add(edge.targetId);
    }
    const visibleNodes = (result?.nodes ?? []).filter(
      (node) =>
        !hidden.has(node.id) &&
        (this.state.graphRelationshipKind === "all" || connectedIds.has(node.id))
    );
    return (
      <div className="view-stack">
        <Panel
          title={flowOnly ? "Engineering Flow Explorer" : "Knowledge Graph"}
          subtitle={
            flowOnly
              ? "Call/data-flow relationships projected from OKF."
              : "Interactive view of the authoritative OKF relationship graph."
          }
        >
          <div className="inline-form">
            {!flowOnly && (
              <select
                value={this.state.graphMode}
                onChange={(event: React.FormEvent<HTMLSelectElement>) =>
                  this.setState({ graphMode: event.currentTarget.value as IntelligenceGraphMode })
                }
              >
                {graphModes.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            )}
            <select
              value={this.state.graphRelationshipKind}
              onChange={(event: React.FormEvent<HTMLSelectElement>) =>
                this.setState({ graphRelationshipKind: event.currentTarget.value })
              }
            >
              <option value="all">All relationships</option>
              {(result?.relationshipKinds ?? []).map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
            <input
              className="grow"
              value={this.state.graphQuery}
              onChange={(event: React.FormEvent<HTMLInputElement>) =>
                this.field("graphQuery", event.currentTarget.value)
              }
              placeholder={
                flowOnly
                  ? "Checkout, login, payment, data entity…"
                  : "Focus by symbol, file, API or service…"
              }
            />
            <button className="primary" onClick={() => this.loadGraph(mode, this.state.graphQuery)}>
              Load {flowOnly ? "flows" : "graph"}
            </button>
          </div>
          {result?.warnings.map((value) => (
            <div className="callout warning" key={value}>
              {value}
            </div>
          ))}
          <div className="graph-layout">
            <GraphCanvas
              nodes={visibleNodes as VisualGraphNode[]}
              edges={visibleEdges}
              selectedId={this.state.selectedGraphNodeId}
              onSelect={(node) => this.setState({ selectedGraphNodeId: node.id })}
              emptyText="Load a graph from the promoted OKF snapshot."
            />
            <GraphInspector
              node={selected}
              relationshipKinds={result?.relationshipKinds ?? []}
              onOpen={(path, line) => this.openSource(path, line)}
              onFocus={(node) => this.loadGraph(mode, node.label, [node.id])}
              onExpand={(node) =>
                this.loadGraph(mode, this.state.graphQuery || node.label, [
                  ...new Set([...(result?.seedIds ?? []), node.id])
                ])
              }
              collapsed={selected ? collapsed.has(selected.id) : false}
              onCollapse={(node) =>
                this.setState((previous) => ({
                  collapsedGraphNodeIds: previous.collapsedGraphNodeIds.includes(node.id)
                    ? previous.collapsedGraphNodeIds.filter((id) => id !== node.id)
                    : [...previous.collapsedGraphNodeIds, node.id]
                }))
              }
            />
          </div>
          {result?.truncated && (
            <small>
              Visualization is intentionally bounded for readability. The persisted OKF store
              remains complete; focus or expand a node/query to traverse a different neighborhood.
            </small>
          )}
        </Panel>
      </div>
    );
  }

  private intelligenceCpg(): JSX.Element {
    const result = this.state.cpg;
    const selected = result?.nodes.find((node) => node.id === this.state.selectedCpgNodeId);
    return (
      <Panel
        title="Code Property Graph Explorer"
        subtitle="Inspect persisted AST/EOG/CFG/DFG/CDG/call neighborhoods and their OKF bindings."
      >
        <div className="inline-form">
          <select
            className="grow"
            value={this.state.cpgPath}
            onChange={(event: React.FormEvent<HTMLSelectElement>) =>
              this.setState({ cpgPath: event.currentTarget.value })
            }
          >
            <option value="">Choose source file</option>
            {(result?.files ?? []).map((file) => (
              <option key={file.sourcePath} value={file.sourcePath}>
                {file.sourcePath} · {file.nodeCount} nodes
              </option>
            ))}
          </select>
          <select
            value={this.state.cpgEdgeKind}
            onChange={(event: React.FormEvent<HTMLSelectElement>) =>
              this.setState({ cpgEdgeKind: event.currentTarget.value })
            }
          >
            <option value="all">All edges</option>
            {(result?.edgeKinds ?? []).map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
          <button className="primary" onClick={() => this.loadCpg()}>
            Load CPG
          </button>
        </div>
        {result?.sourcePath && (
          <div className="capability-strip">
            {Object.entries(result.capabilities ?? {}).map(([name, enabled]) => (
              <span className={enabled ? "enabled" : ""} key={name}>
                {name}: {enabled ? "yes" : "no"}
              </span>
            ))}
          </div>
        )}
        <div className="graph-layout">
          <GraphCanvas
            nodes={(result?.nodes ?? []).map((node) => ({
              id: node.id,
              label: node.label,
              kind: `${node.kind}:${node.syntaxKind}`,
              path: node.path,
              line: node.line
            }))}
            edges={result?.edges ?? []}
            selectedId={this.state.selectedCpgNodeId}
            onSelect={(node) => this.setState({ selectedCpgNodeId: node.id })}
            emptyText="Index the repository, then choose a persisted CPG shard."
          />
          <div className="graph-inspector">
            {selected ? (
              <div className="inspector-content">
                <p className="eyebrow">CPG NODE</p>
                <h3>{selected.label}</h3>
                <Status value={selected.kind} />
                <p>{selected.syntaxKind}</p>
                <code>
                  {selected.path}:{selected.line}
                </code>
                {selected.okfId && <small>OKF: {selected.okfId}</small>}
                <button onClick={() => this.openSource(selected.path, selected.line)}>
                  Open source
                </button>
                <button
                  onClick={() =>
                    vscode.postMessage({
                      type: "LOAD_CPG_VIEW",
                      sourcePath: result?.sourcePath,
                      edgeKind: this.state.cpgEdgeKind,
                      focusNodeId: selected.id
                    })
                  }
                >
                  Focus neighborhood
                </button>
              </div>
            ) : (
              <Empty text="Select a CPG node." />
            )}
          </div>
        </div>
        {result?.truncated && (
          <small>
            The visualization shows a connected neighborhood; shard counts above represent the
            complete persisted CPG for the file.
          </small>
        )}
      </Panel>
    );
  }

  private intelligenceQuery(): JSX.Element {
    const result = this.state.queryResult;
    const suggestions = this.state.application.intelligence?.querySuggestions ?? [];
    return (
      <Panel
        title="Ask repository intelligence"
        subtitle="Ask about this repository and get ranked evidence, related code, and the reasoning path behind the answer."
      >
        <div className="query-suggestions">
          <small>Suggested questions from this repository ({suggestions.length})</small>
          <div className="query-examples">
            {suggestions.map((value) => (
              <button key={value} onClick={() => this.setState({ query: value })}>
                {value}
              </button>
            ))}
          </div>
          {!suggestions.length && <Empty text="Index the repository to generate suggestions." />}
        </div>
        <div className="inline-form">
          <input
            className="grow"
            value={this.state.query}
            onChange={(event: React.FormEvent<HTMLInputElement>) =>
              this.field("query", event.currentTarget.value)
            }
            placeholder="Ask about callers, dependencies, tests, impact, APIs, databases, tables, flows, risks or flags…"
          />
          <button
            className="primary"
            disabled={!this.state.query.trim()}
            onClick={() =>
              vscode.postMessage({ type: "QUERY_INTELLIGENCE", query: this.state.query.trim() })
            }
          >
            Query
          </button>
        </div>
        {result && (
          <div className="query-answer">
            <b>{result.answer}</b>
            <small>
              {result.intent} · {Math.round(result.confidence * 100)}% confidence ·{" "}
              {result.traversedRelationships} traversed relationship(s)
            </small>
            <div className="actions">
              <button disabled={!result.items.length} onClick={() => this.showQueryInGraph()}>
                Show traversal in Graph
              </button>
              {result.intent === "flow" && (
                <button disabled={!result.items.length} onClick={() => this.showQueryInFlows()}>
                  Show in Flows
                </button>
              )}
            </div>
            <details>
              <summary>How Keystone planned this query</summary>
              <p>{result.plan.strategy}</p>
              <p>
                <b>Terms:</b> {result.plan.terms.join(" · ") || "none"}
              </p>
              <p>
                <b>Seeds:</b> {result.plan.seedLabels.slice(0, 8).join(" · ") || "none"}
              </p>
              <p>
                <b>Relationships:</b> {result.plan.relationshipKinds.join(" · ") || "none"} · max
                depth {result.plan.maxDepth}
              </p>
              {result.traversals.length > 0 && (
                <ol>
                  {result.traversals.slice(0, 20).map((step, index) => (
                    <li key={`${step.sourceId}-${step.targetId}-${index}`}>
                      <code>{step.sourceLabel}</code> —[{step.relationship}]→{" "}
                      <code>{step.targetLabel}</code>
                    </li>
                  ))}
                </ol>
              )}
            </details>
            {result.warnings.map((value) => (
              <p key={value}>{value}</p>
            ))}
          </div>
        )}
        <EvidenceList
          items={this.state.queryItems}
          empty="Run a query to see evidence-backed results."
          onOpen={(path, line) => this.openSource(path, line)}
        />
      </Panel>
    );
  }

  private openIntelligenceView(view: IntelligenceView): void {
    this.setState({ intelligenceView: view });
    this.loadIntelligenceSurface(view);
  }
  private loadIntelligenceSurface(view: IntelligenceView): void {
    if (view === "Explorer") this.loadExplorer(true);
    else if (view === "Graph") this.loadGraph(this.state.graphMode, this.state.graphQuery);
    else if (view === "CPG") this.loadCpg();
    else if (view === "Flows") this.loadGraph("flows", this.state.graphQuery);
  }
  private loadExplorer(reset = false): void {
    vscode.postMessage({
      type: "EXPLORE_INTELLIGENCE",
      query: this.state.explorerQuery.trim(),
      kind: this.state.explorerKind,
      cursor: reset ? undefined : this.state.explorer?.nextCursor
    });
  }
  private loadGraph(mode: IntelligenceGraphMode, query = "", seedIds: string[] = []): void {
    vscode.postMessage({ type: "LOAD_INTELLIGENCE_GRAPH", mode, query: query.trim(), seedIds });
  }
  private loadCpg(): void {
    vscode.postMessage({
      type: "LOAD_CPG_VIEW",
      sourcePath: this.state.cpgPath || undefined,
      edgeKind: this.state.cpgEdgeKind
    });
  }
  private showExplorerItemInGraph(item: IntelligenceExplorerItem): void {
    this.setState({
      intelligenceView: "Graph",
      graphMode: "repository",
      graphQuery: item.label,
      selectedGraphNodeId: item.id
    });
    this.loadGraph("repository", item.label, [item.id]);
  }
  private showQueryInGraph(): void {
    const ids =
      this.state.queryResult?.items
        .slice(0, 8)
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id)) ?? [];
    this.setState({
      intelligenceView: "Graph",
      graphMode: this.state.queryResult?.intent === "impact" ? "impact" : "repository",
      graphQuery: this.state.query
    });
    this.loadGraph(
      this.state.queryResult?.intent === "impact" ? "impact" : "repository",
      this.state.query,
      ids
    );
  }
  private showQueryInFlows(): void {
    const ids =
      this.state.queryResult?.items
        .slice(0, 8)
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id)) ?? [];
    this.setState({ intelligenceView: "Flows", graphQuery: this.state.query });
    this.loadGraph("flows", this.state.query, ids);
  }
  private openSource(path: string, line?: number): void {
    vscode.postMessage({ type: "OPEN_SOURCE_LOCATION", path, line });
  }

  private work(): JSX.Element {
    const task = this.state.task;
    const plan = this.state.plan;
    const current = this.currentStory();
    if (!task)
      return (
        <section>
          <div className="page-title">
            <div>
              <p className="eyebrow">INTENT-LED SDLC</p>
              <h1>No active work</h1>
              <p>
                Research an intent from Home. Keystone will not invent a plan before repository
                evidence exists.
              </p>
            </div>
            <div className="actions">
              <button className="primary" onClick={() => this.startNewWork()}>
                Start new work
              </button>
            </div>
          </div>
        </section>
      );
    return (
      <section>
        <div className="page-title">
          <div>
            <p className="eyebrow">WORK</p>
            <div className="active-intent-heading">
              <h1>{plan?.intent ?? (this.state.intent || "Active intent")}</h1>
              {this.state.application.intentState && (
                <span
                  className={`status intent-header-lifecycle ${this.state.application.intentState.lifecycle.toLowerCase()}`}
                >
                  ● {intentLifecycleLabel(this.state.application.intentState.lifecycle)}
                </span>
              )}
            </div>
            <p>{task.reason}</p>
          </div>
          <div className="actions">
            <button
              onClick={() =>
                vscode.postMessage({
                  type: "RUN_VALIDATION",
                  scope: "impacted",
                  storyId: current?.id
                })
              }
            >
              Run validation
            </button>
            <button className="primary" disabled={!plan} onClick={() => this.openHandoff()}>
              Task Handoff
            </button>
          </div>
        </div>
        <div className="metric-grid">
          <Metric
            label="Route"
            value={task.route ?? "pending"}
            detail={task.intentType ?? "intent"}
          />
          <Metric
            label="Context reduction"
            value={`${task.tokenReduction ?? 0}%`}
            detail={`${task.contextTokens?.prompt ?? 0} prompt tokens`}
          />
          <Metric
            label="QA coverage"
            value={`${task.relatedTests.length} tests`}
            detail={`${task.missingTests.length} gaps`}
          />
          <Metric
            label="Risk"
            value={`${task.securityRisk} / ${task.performanceRisk}`}
            detail="security / performance"
          />
        </div>
        {this.intentWorkspace()}
        {!plan && this.prePlanResearch(task)}
        {plan && this.researchAndSpecification(plan)}
        {plan && this.sdlcExecution(plan, current)}
        {this.taskEvidence(task)}
        {this.contextAndDelegation(task, current)}
        {task.prMarkdown && (
          <Panel
            title="Read-only PR Review"
            subtitle="Reviewer-ready evidence only. Keystone never creates, updates, approves or merges the remote MR/PR."
          >
            <div className="actions">
              <button
                onClick={() =>
                  vscode.postMessage({ type: "COPY_PR_MARKDOWN", markdown: task.prMarkdown })
                }
              >
                Copy PR review
              </button>
            </div>
            <pre>{task.prMarkdown}</pre>
          </Panel>
        )}
        <div id="handoff">
          <Panel
            title="Task Handoff"
            subtitle="Encrypted portable continuity attached to this active task. No credentials, token sharing, cloud session, or Git mutation."
          >
            <label>
              Passphrase
              <input
                type="password"
                value={this.state.passphrase}
                onChange={(event: React.FormEvent<HTMLInputElement>) =>
                  this.field("passphrase", event.currentTarget.value)
                }
                placeholder="At least 12 characters"
              />
            </label>
            <button
              className="primary"
              disabled={this.state.passphrase.length < 12 || !plan}
              onClick={() =>
                vscode.postMessage({
                  type: "CREATE_TASK_HANDOFF",
                  passphrase: this.state.passphrase
                })
              }
            >
              Create from active task
            </button>
            <label>
              Encrypted package
              <textarea
                value={this.state.handoffText}
                onChange={(event: React.FormEvent<HTMLTextAreaElement>) =>
                  this.field("handoffText", event.currentTarget.value)
                }
                placeholder="Paste a received package"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={this.state.manualSyncConfirmed}
                onChange={(event: React.FormEvent<HTMLInputElement>) =>
                  this.field("manualSyncConfirmed", event.currentTarget.checked)
                }
              />
              <span>
                I manually synchronized the repository and verified the expected branch/revision.
              </span>
            </label>
            <button
              disabled={
                !this.state.manualSyncConfirmed ||
                this.state.passphrase.length < 12 ||
                !this.state.handoffText.trim()
              }
              onClick={() =>
                vscode.postMessage({
                  type: "RESTORE_TASK_HANDOFF",
                  packageText: this.state.handoffText.trim(),
                  passphrase: this.state.passphrase,
                  manualSyncConfirmed: true
                })
              }
            >
              Verify and restore
            </button>
          </Panel>
        </div>
      </section>
    );
  }

  private decisionCandidate(decision: IntentDecision): JSX.Element {
    const rejecting = this.state.rejectingDecisionId === decision.id;
    return (
      <div className="decision-item" key={decision.id}>
        <div className="decision-copy">
          <span className="decision-kicker">Recommended decision</span>
          <b>{decision.title}</b>
          <span>{decision.recommendation}</span>
          {decision.reason && (
            <small>
              <b>Reason</b> · {decision.reason}
            </small>
          )}
        </div>
        <div className="decision-actions">
          <div className="actions">
            <button
              className="primary"
              onClick={() => this.resolveDecision(decision.id, "accepted")}
            >
              Accept
            </button>
            <button onClick={() => this.beginDecisionRejection(decision.id)}>Reject</button>
            <button
              className="discussion-button"
              onClick={() => this.openDecisionDiscussion(decision)}
            >
              Discuss
            </button>
          </div>
          {rejecting && (
            <div className="decision-rejection-form">
              <input
                autoFocus
                value={this.state.rejectionReason}
                placeholder="Optional reason"
                aria-label="Optional rejection reason"
                onChange={(event: React.FormEvent<HTMLInputElement>) =>
                  this.setState({ rejectionReason: event.currentTarget.value })
                }
              />
              <button
                className="danger"
                onClick={() => this.resolveDecision(decision.id, "rejected")}
              >
                Confirm reject
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  private decisionDiscussion(
    intent: NonNullable<ApplicationState["intentState"]>
  ): JSX.Element | null {
    const discussion = this.state.decisionDiscussion;
    if (!discussion) return null;
    const decision = intent.decisions.find((item) => item.id === discussion.decisionId);
    if (!decision) return null;
    const contextPackageId = intent.latestCopilotInteraction?.contextPackageId;
    return (
      <aside className="decision-discussion" aria-label="Decision discussion">
        <div className="discussion-heading">
          <div>
            <span className="decision-kicker">Copilot discussion</span>
            <h3>{decision.title}</h3>
          </div>
          <button
            className="icon-button"
            aria-label="Close discussion"
            onClick={() => this.closeDecisionDiscussion()}
          >
            ×
          </button>
        </div>
        <div className="discussion-context">
          <span>
            <b>Intent</b> · {intent.goal}
          </span>
          <span>
            <b>Objective</b> · {intent.currentObjective}
          </span>
          {contextPackageId && (
            <span>
              <b>ContextPackage</b> · {contextPackageId}
            </span>
          )}
          {(decision.evidence ?? []).length > 0 && (
            <span>
              <b>Evidence</b> · {(decision.evidence ?? []).map((item) => item.label).join(" · ")}
            </span>
          )}
        </div>
        <div className="discussion-thread" aria-live="polite">
          {discussion.messages.length === 0 && (
            <p className="discussion-empty">
              Ask Copilot to weigh the recommendation against the current Intent.
            </p>
          )}
          {discussion.messages.map((message, index) => (
            <div className={`discussion-message ${message.role}`} key={`${message.role}-${index}`}>
              <span>{message.role === "user" ? "You" : "Copilot"}</span>
              <p>{message.text}</p>
            </div>
          ))}
          {discussion.pending && (
            <div className="discussion-pending">Copilot is considering the supplied evidence…</div>
          )}
        </div>
        <div className="discussion-composer">
          <textarea
            rows={3}
            value={discussion.input}
            disabled={discussion.pending}
            placeholder="Ask a short follow-up…"
            aria-label="Decision discussion message"
            onChange={(event: React.FormEvent<HTMLTextAreaElement>) =>
              this.setState((previous) => ({
                decisionDiscussion: previous.decisionDiscussion
                  ? { ...previous.decisionDiscussion, input: event.currentTarget.value }
                  : previous.decisionDiscussion
              }))
            }
          />
          <button
            className="primary"
            disabled={discussion.pending || !discussion.input.trim()}
            onClick={() => this.sendDecisionDiscussion()}
          >
            {discussion.pending ? "Thinking…" : "Send"}
          </button>
        </div>
        <div className="discussion-resolution">
          <span>When resolved</span>
          <div className="actions">
            <button
              className="primary"
              onClick={() => this.resolveDecision(decision.id, "accepted")}
            >
              Accept recommendation
            </button>
            <button onClick={() => this.beginDecisionRejection(decision.id)}>
              Reject recommendation
            </button>
            <button onClick={() => this.resolveDecision(decision.id, "saved")}>
              Save as decision
            </button>
            <button
              className="advanced-action"
              onClick={() =>
                document
                  .querySelector<HTMLTextAreaElement>(".discussion-composer textarea")
                  ?.focus()
              }
            >
              Keep discussing
            </button>
          </div>
        </div>
      </aside>
    );
  }

  private openDecisionDiscussion(decision: IntentDecision): void {
    this.setState({
      decisionDiscussion: { decisionId: decision.id, messages: [], input: "", pending: false },
      rejectingDecisionId: undefined,
      rejectionReason: ""
    });
  }

  private closeDecisionDiscussion(): void {
    this.setState({ decisionDiscussion: undefined });
  }

  private sendDecisionDiscussion(): void {
    const discussion = this.state.decisionDiscussion;
    const message = discussion?.input.trim();
    if (!discussion || !message || discussion.pending) return;
    const transcript = [
      ...discussion.messages,
      { role: "user" as const, text: message }
    ]
      .map((item) => `${item.role === "user" ? "User" : "Copilot"}: ${item.text}`)
      .join("\n\n");
    this.setState({
      decisionDiscussion: {
        ...discussion,
        input: "",
        pending: true,
        messages: [...discussion.messages, { role: "user", text: message }]
      }
    });
    vscode.postMessage({
      type: "DISCUSS_INTENT_DECISION",
      decisionId: discussion.decisionId,
      message: transcript
    });
  }

  private beginDecisionRejection(decisionId: string): void {
    this.setState({ rejectingDecisionId: decisionId, rejectionReason: "" });
  }

  private resolveDecision(decisionId: string, resolution: "accepted" | "rejected" | "saved"): void {
    if (resolution === "rejected") {
      vscode.postMessage({
        type: "REJECT_INTENT_DECISION",
        decisionId,
        reason: this.state.rejectionReason.trim() || undefined
      });
    } else {
      vscode.postMessage({ type: "ACCEPT_INTENT_DECISION", decisionId });
    }
    this.setState({
      decisionDiscussion: undefined,
      rejectingDecisionId: undefined,
      rejectionReason: "",
      notice:
        resolution === "rejected"
          ? "Decision rejected and kept in Intent history."
          : resolution === "saved"
            ? "Decision saved to Intent State."
            : "Decision accepted and added to future relevant Copilot context."
    });
  }

  private intentWorkspace(): JSX.Element {
    const intent = this.state.application.intentState;
    if (!intent) return <></>;
    const operation = this.state.application.operations?.find(
      (item) => item.id === "copilot-delegation"
    );
    const running = operation?.status === "running";
    const proposed = intent.decisions.filter((decision) => decision.status === "PROPOSED");
    const resolved = intent.decisions.filter((decision) => decision.status !== "PROPOSED");
    const activeBlockers = intent.blockers.filter((blocker) => !blocker.resolvedAt);
    const scopeChange = intent.scopeChangeProposals.find((proposal) => proposal.status === "PROPOSED");
    const primary = this.primaryIntentAction(intent);
    return (
      <Panel
        title="Intent state"
        subtitle="Durable engineering state stays separate from the Copilot conversation."
      >
        <div className="intent-header-row">
          <span className={`status ${intent.lifecycle.toLowerCase()}`}>
            {intentLifecycleLabel(intent.lifecycle)}
          </span>
          <span className="intent-objective">Current objective: {intent.currentObjective}</span>
          <select
            className="intent-lifecycle-control"
            value=""
            aria-label="Correct Intent lifecycle"
            onChange={(event: React.FormEvent<HTMLSelectElement>) => {
              const next = event.currentTarget.value as IntentLifecycle;
              if (next) vscode.postMessage({ type: "SET_INTENT_LIFECYCLE", lifecycle: next });
            }}
          >
            <option value="" disabled>
              Correct lifecycle…
            </option>
            {intentLifecycleTransitions[intent.lifecycle]
              .filter((next) => next !== "BLOCKED")
              .map((next) => (
                <option value={next} key={next}>
                  Move to {intentLifecycleLabel(next)}
                </option>
              ))}
          </select>
          {intent.latestCopilotInteraction?.contextPackageId && (
            <small>ContextPackage {intent.latestCopilotInteraction.contextPackageId}</small>
          )}
        </div>
        <div className="intent-summary-grid">
          <div>
            <span>Understanding</span>
            <strong>{intent.understanding.at(-1) ?? "Not captured yet"}</strong>
          </div>
          <div>
            <span>Completed</span>
            <strong>{intent.completedWork.length} durable item(s)</strong>
          </div>
          <div>
            <span>Questions</span>
            <strong>{intent.openQuestions.length}</strong>
          </div>
          <div>
            <span>Blockers</span>
            <strong>{activeBlockers.length}</strong>
          </div>
        </div>
        <div className="intent-primary-row">
          <div>
            <strong>{running ? "Copilot working" : primary.label}</strong>
            <small>
              {running ? (operation?.message ?? "Streaming a response…") : primary.description}
            </small>
          </div>
          <button
            className={running ? "danger" : "primary"}
            onClick={() =>
              running ? vscode.postMessage({ type: "CANCEL_COPILOT" }) : primary.run()
            }
            disabled={!running && !primary.enabled}
          >
            {running ? "Stop" : primary.label}
          </button>
        </div>
        {proposed.length > 0 && (
          <div className="decision-workspace">
            <div className="decision-list">
              <strong>Decision candidates</strong>
              <small className="decision-helper">
                Copilot recommendations stay temporary until you resolve them.
              </small>
              {proposed.map((decision) => this.decisionCandidate(decision))}
            </div>
            {this.state.decisionDiscussion && this.decisionDiscussion(intent)}
          </div>
        )}
        {resolved.length > 0 && (
          <details className="decision-history">
            <summary>Decision history · {resolved.length}</summary>
            {resolved.slice(0, 12).map((decision) => (
              <div className="decision-history-item" key={decision.id}>
                <span className={`status ${decision.status.toLowerCase()}`}>{decision.status}</span>
                <div>
                  <b>{decision.title}</b>
                  <small>{decision.recommendation}</small>
                  {decision.resolutionReason && <small>Reason: {decision.resolutionReason}</small>}
                </div>
              </div>
            ))}
          </details>
        )}
        {activeBlockers.length > 0 && (
          <div className="callout warning">
            <strong>Blocked</strong>
            {activeBlockers.map((blocker) => (
              <div className="blocker-row" key={blocker.id}>
                <span>{blocker.summary}</span>
                <button
                  onClick={() =>
                    vscode.postMessage({ type: "RESOLVE_INTENT_BLOCKER", blockerId: blocker.id })
                  }
                >
                  Resolve
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="add-blocker-row">
          <input
            value={this.state.intentBlocker}
            onChange={(event: React.FormEvent<HTMLInputElement>) =>
              this.setState({ intentBlocker: event.currentTarget.value })
            }
            placeholder="Describe a real blocker…"
          />
          <button
            disabled={!this.state.intentBlocker.trim()}
            onClick={() => {
              vscode.postMessage({
                type: "ADD_INTENT_BLOCKER",
                summary: this.state.intentBlocker.trim()
              });
              this.setState({ intentBlocker: "" });
            }}
          >
            Mark blocked
          </button>
        </div>
        {scopeChange && (
          <div className="callout warning">
            <strong>Scope change recommended</strong>
            <span>{scopeChange.summary}</span>
            <small>Affected: {scopeChange.affectedAreas.join(", ")}</small>
            {scopeChange.signals?.length ? (
              <small>Signals: {scopeChange.signals.join(" · ")}</small>
            ) : null}
            <div className="actions">
              <button
                className="primary"
                onClick={() =>
                  vscode.postMessage({
                    type: "EXPAND_INTENT_SCOPE",
                    proposalId: scopeChange.id,
                    reason: scopeChange.reason
                  })
                }
              >
                Expand Scope
              </button>
              <button
                onClick={() =>
                  vscode.postMessage({
                    type: "KEEP_INTENT_SCOPE",
                    proposalId: scopeChange.id,
                    reason: scopeChange.reason
                  })
                }
              >
                Keep Current Scope
              </button>
              <button
                onClick={() =>
                  vscode.postMessage({
                    type: "CREATE_INTENT_FOLLOW_UP",
                    proposalId: scopeChange.id,
                    reason: scopeChange.reason
                  })
                }
              >
                Create Follow-up
              </button>
              <button
                onClick={() => {
                  const decision = intent.decisions.find(
                    (item) => item.id === scopeChange.decisionId
                  );
                  if (decision) this.openDecisionDiscussion(decision);
                }}
              >
                Discuss
              </button>
            </div>
          </div>
        )}
        <div className="ask-intent-row">
          <input
            value={this.state.intentQuestion}
            onChange={(event: React.FormEvent<HTMLInputElement>) =>
              this.setState({ intentQuestion: event.currentTarget.value })
            }
            placeholder="Ask about this Intent…"
          />
          <button
            disabled={!this.state.intentQuestion.trim() || running}
            onClick={() => {
              vscode.postMessage({
                type: "ASK_ABOUT_INTENT",
                question: this.state.intentQuestion.trim()
              });
              this.setState({ intentQuestion: "" });
            }}
          >
            Ask
          </button>
        </div>
      </Panel>
    );
  }

  private primaryIntentAction(
    intent: NonNullable<ApplicationState["intentState"]>
  ): IntentPrimaryAction & { run: () => void } {
    const action = selectIntentPrimaryAction(intent);
    return {
      ...action,
      enabled: action.enabled && Boolean(this.state.task),
      run: () => {
        if (this.state.task) this.delegate(this.currentStory());
      }
    };
  }

  private prePlanResearch(task: TaskResult): JSX.Element {
    const approved = task.researchStatus === "approved";
    const research = task.researchDocument;
    return (
      <Panel
        title="Repository R&D · planning gate"
        subtitle="Research is a reviewable engineering artifact. Specification and story planning stay locked until you approve the repository evidence."
      >
        <div className="approval">
          <span>
            R&D status: <b>{task.researchStatus}</b> · {research.evidenceMatrix.length} curated
            evidence item(s) · {research.unknowns.length} open question(s)
          </span>
          {!approved ? (
            <button
              className="primary"
              onClick={() =>
                vscode.postMessage({ type: "APPROVE_INTENT_RESEARCH", intentId: task.intentId })
              }
            >
              Approve R&D and unlock planning
            </button>
          ) : (
            <button
              className="primary"
              onClick={() =>
                vscode.postMessage({ type: "CREATE_SDLC_PLAN", intent: research.problemStatement })
              }
            >
              Create specification and stories
            </button>
          )}
        </div>
        <ResearchDocumentView research={research} onOpen={(path) => this.openSource(path)} />
      </Panel>
    );
  }

  private researchAndSpecification(plan: SdlcPlan): JSX.Element {
    const specificationStory = plan.stories.find((story) => story.type === "specification");
    const canApprove =
      specificationStory?.status === "ready" || specificationStory?.status === "in-progress";
    return (
      <Panel
        title="Research → Specification → Backlog"
        subtitle="Implementation starts only after repository R&D and the generated specification have both been reviewed."
      >
        <div className="doc-grid">
          <ResearchDocumentView
            research={plan.researchDocument}
            onOpen={(path) => this.openSource(path)}
            compact
          />
          <SpecificationDocumentView specification={plan.specificationDocument} />
        </div>
        <h3>Repository-specific user and quality stories</h3>
        <div className="backlog-grid">
          {plan.backlogStories.map((story) => (
            <BacklogCard key={story.id} story={story} />
          ))}
        </div>
        {plan.specificationStatus !== "approved" && (
          <div className="approval">
            <span>
              Specification status: <b>{plan.specificationStatus}</b>. Review requirements,
              architecture decisions, validation plan and open questions before proceeding.{" "}
              {!canApprove ? "Complete the Research story first." : ""}
            </span>
            <button
              className="primary"
              disabled={!canApprove}
              onClick={() => vscode.postMessage({ type: "APPROVE_SPECIFICATION" })}
            >
              Approve specification
            </button>
          </div>
        )}
      </Panel>
    );
  }

  private sdlcExecution(plan: SdlcPlan, current: Story | undefined): JSX.Element {
    return (
      <Panel
        title="SDLC execution"
        subtitle="Sixteen evidence-gated stages unlock through dependencies, explicit approval, delegation, validation and findings."
      >
        <div className="sdlc-layout">
          <div className="story-list">
            {plan.stories.map((story) => (
              <button
                key={story.id}
                className={`story-row ${current?.id === story.id ? "current" : ""}`}
                onClick={() => this.selectStory(story)}
              >
                <span className={`status-dot ${story.status}`} />
                <span>
                  <b>{story.title}</b>
                  <small>{story.type}</small>
                </span>
                <Status value={story.status} />
              </button>
            ))}
          </div>
          {current ? (
            <div className="story-detail">
              <div className="story-heading">
                <div>
                  <p className="eyebrow">SELECTED STORY</p>
                  <h2>{current.title}</h2>
                  <p>{current.objective}</p>
                </div>
                <Status value={current.status} />
              </div>
              <h3>Acceptance criteria</h3>
              <div className="criteria">
                {current.acceptanceCriteria.map((criterion) => (
                  <label key={criterion}>
                    <input
                      type="checkbox"
                      checked={Boolean(
                        this.state.selectedCriteria[criterion] ||
                        current.satisfiedCriteria.includes(criterion)
                      )}
                      disabled={current.satisfiedCriteria.includes(criterion)}
                      onChange={(event: React.FormEvent<HTMLInputElement>) =>
                        this.toggleCriterion(criterion, event.currentTarget.checked)
                      }
                    />
                    <span>{criterion}</span>
                  </label>
                ))}
              </div>
              {current.findings?.length ? (
                <div className="finding-section">
                  <h3>Findings</h3>
                  <div className="finding-list">
                    {current.findings.map((finding) => (
                      <article key={finding.id} className={`finding ${finding.severity}`}>
                        <div>
                          <b>
                            {finding.kind}: {finding.summary}
                          </b>
                          <Status value={`${finding.severity}-${finding.status}`} />
                        </div>
                        {finding.evidence.length > 0 && (
                          <small>{finding.evidence.join(" · ")}</small>
                        )}
                        {finding.status === "open" && (
                          <div className="actions">
                            <button
                              onClick={() =>
                                vscode.postMessage({
                                  type: "RESOLVE_SDLC_FINDING",
                                  storyId: current.id,
                                  findingId: finding.id,
                                  status: "resolved"
                                })
                              }
                            >
                              Mark resolved
                            </button>
                            <button
                              onClick={() =>
                                vscode.postMessage({
                                  type: "RESOLVE_SDLC_FINDING",
                                  storyId: current.id,
                                  findingId: finding.id,
                                  status: "accepted"
                                })
                              }
                            >
                              Accept risk
                            </button>
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              {current.validationRuns?.length ? (
                <details>
                  <summary>Validation history ({current.validationRuns.length})</summary>
                  {current.validationRuns.map((run) => (
                    <div className="validation-run" key={run.id}>
                      <Status value={run.status} />
                      <code>{run.commands.join(" · ")}</code>
                      <small>{run.evidence.join(" · ")}</small>
                    </div>
                  ))}
                </details>
              ) : null}
              <h3>Completion evidence</h3>
              <textarea
                value={this.state.evidenceText}
                onChange={(event: React.FormEvent<HTMLTextAreaElement>) =>
                  this.field("evidenceText", event.currentTarget.value)
                }
                placeholder="One verifiable item per line: command output, file/range, review decision, benchmark, or evidence ID."
              />
              <div className="actions">
                {current.status === "ready" && (
                  <button
                    className="primary"
                    onClick={() =>
                      vscode.postMessage({
                        type: "SDLC_TRANSITION",
                        storyId: current.id,
                        status: "in-progress"
                      })
                    }
                  >
                    Start story
                  </button>
                )}
                {(current.status === "in-progress" ||
                  (current.status === "delegated" &&
                    current.delegation?.status === "delegated" &&
                    !current.delegation.completedAt)) && (
                  <button className="advanced-action" onClick={() => this.delegate(current)}>
                    {current.status === "delegated"
                      ? "Retry delegation (advanced)"
                      : "Delegate story (advanced)"}
                  </button>
                )}
                {["in-progress", "delegated", "awaiting-validation", "review-required"].includes(
                  current.status
                ) && (
                  <button
                    onClick={() =>
                      vscode.postMessage({
                        type: "RUN_VALIDATION",
                        scope: "impacted",
                        storyId: current.id
                      })
                    }
                  >
                    Run actual validation
                  </button>
                )}
                {["awaiting-validation", "review-required", "in-progress"].includes(
                  current.status
                ) && (
                  <button className="primary" onClick={() => this.completeStory(current)}>
                    Complete with evidence
                  </button>
                )}
              </div>
              {current.evidence.length > 0 && (
                <details>
                  <summary>{current.evidence.length} evidence item(s)</summary>
                  <ul>
                    {current.evidence.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ) : (
            <Empty text="Select an SDLC story." />
          )}
        </div>
      </Panel>
    );
  }

  private taskEvidence(task: TaskResult): JSX.Element {
    const analysis = task.analysisEvidence;
    return (
      <Panel
        title="Engineering evidence"
        subtitle="QA, security, performance, modernization and read-only Git evidence remain inspectable instead of becoming hidden status badges."
      >
        <div className="evidence-tabs-grid">
          <EvidenceGroup
            title="QA"
            status={`${task.relatedTests.length} tests · ${task.missingTests.length} gaps`}
            items={[
              ...(analysis?.qa.gaps ?? []).map((item) => ({
                label: item.type,
                path: item.path,
                detail: item.reason
              })),
              ...(analysis?.qa.recommendations ?? []).map((item) => ({
                label: "Recommended next step",
                detail: item
              }))
            ]}
            onOpen={(path) => this.openSource(path)}
          />
          <EvidenceGroup
            title="Security"
            status={analysis?.security.riskLevel ?? task.securityRisk}
            items={[
              ...(analysis?.security.findings ?? []).map((item) => ({
                label: `${item.severity}: ${item.title}`,
                path: item.path,
                line: item.line,
                detail: item.explanation
              })),
              ...(analysis?.security.intelligenceSignals ?? []).map((item) => ({
                label: `Repository signal: ${item.label}`,
                path: item.path,
                line: item.line,
                detail: item.summary
              })),
              ...(analysis?.security.recommendations ?? []).map((item) => ({
                label: "Recommended next step",
                detail: item
              }))
            ]}
            onOpen={(path, line) => this.openSource(path, line)}
          />
          <EvidenceGroup
            title="Performance"
            status={analysis?.performance.riskLevel ?? task.performanceRisk}
            items={[
              ...(analysis?.performance.findings ?? []).map((item) => ({
                label: `${item.severity}: ${item.title}`,
                path: item.path,
                line: item.line,
                detail: item.explanation
              })),
              ...(analysis?.performance.intelligenceSignals ?? []).map((item) => ({
                label: `Repository signal: ${item.label}`,
                path: item.path,
                line: item.line,
                detail: item.summary
              })),
              ...(analysis?.performance.recommendations ?? []).map((item) => ({
                label: "Recommended next step",
                detail: item
              }))
            ]}
            onOpen={(path, line) => this.openSource(path, line)}
          />
          <EvidenceGroup
            title="Modernization"
            status={`${analysis?.modernization.gaps.length ?? 0} gap(s)`}
            items={[
              ...(analysis?.modernization.gaps ?? []).map((item) => ({
                label: `${item.priority}: ${item.title}`,
                detail: item.evidence.join(" · ")
              })),
              ...(analysis?.modernization.recommendations ?? []).map((item) => ({
                label: "Recommended next step",
                detail: item
              }))
            ]}
          />
        </div>
        {analysis?.gitReview && (
          <details>
            <summary>Read-only Git review evidence</summary>
            <ul className="fact-list">
              <li>
                <b>Branch</b>
                <span>{analysis.gitReview.branch ?? "unknown"}</span>
              </li>
              <li>
                <b>Changed files</b>
                <span>{analysis.gitReview.changedFiles.length}</span>
              </li>
              <li>
                <b>Diff SHA-256</b>
                <code>{analysis.gitReview.diffHash}</code>
              </li>
              <li>
                <b>Diff bytes</b>
                <span>{analysis.gitReview.diffBytes}</span>
              </li>
            </ul>
          </details>
        )}
        {analysis?.canonicalEvidence && Object.keys(analysis.canonicalEvidence).length > 0 && (
          <details>
            <summary>Analysis evidence coverage</summary>
            <ul className="fact-list">
              {Object.entries(analysis.canonicalEvidence).map(([worker, envelope]) => (
                <li key={worker}>
                  <b>{worker}</b>
                  <span>
                    {envelope.unitIds.length} unit(s) · {envelope.relationshipIds.length}{" "}
                    relationship(s) · {envelope.evidenceIds.length} evidence link(s)
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {task.testGeneration && (
          <details>
            <summary>Generated QA scenarios ({task.testGeneration.summary.totalScenarios})</summary>
            <div className="backlog-grid">
              {task.testGeneration.scenarios.map((item) => (
                <article className="backlog quality-story" key={item.id}>
                  <div>
                    <span>{item.category}</span>
                    <Status value={item.priority} />
                  </div>
                  <h3>{item.name}</h3>
                  <p>{item.description}</p>
                </article>
              ))}
            </div>
          </details>
        )}
      </Panel>
    );
  }

  private contextAndDelegation(taskResult: TaskResult, current: Story | undefined): JSX.Element {
    const task = {
      ...taskResult,
      contextSummary: {
        ...taskResult.contextSummary!,
        retainedCandidates: taskResult.contextSummary?.retainedCandidates ?? []
      },
      contextPackets: taskResult.contextPackets!,
      omittedContext: taskResult.omittedContext!
    } as TaskResult & {
      contextSummary: NonNullable<TaskResult["contextSummary"]> & {
        retainedCandidates: NonNullable<
          NonNullable<TaskResult["contextSummary"]>["retainedCandidates"]
        >;
      };
      contextPackets: NonNullable<TaskResult["contextPackets"]>;
      omittedContext: NonNullable<TaskResult["omittedContext"]>;
    };
    const delegationResult = this.state.application.delegationResult;
    const structured = delegationResult?.structured;
    const details = structured?.details;
    return (
      <div className="two-column">
        <Panel
          title="Context"
          subtitle="Inspect the focused context prepared for this intent before handing work to Copilot."
        >
          {this.contextExperience(taskResult)}
        </Panel>
        <Panel
          title="Copilot delegation"
          subtitle="After repository intelligence and approved R&D, Copilot is the implementation worker. Keystone sends the selected intelligence packet instead of asking Copilot to rediscover the repository."
        >
          <div className="callout copilot-boundary">
            <strong>Bounded intelligence handoff</strong>
            <span>
              {task.contextManifest?.selectedFiles ?? task.contextSections?.length ?? 0} selected
              file(s) · {task.contextManifest?.traceableEvidence ?? 0} evidence link(s) ·{" "}
              {task.contextManifest?.omittedFiles ?? task.omittedContext?.length ?? 0} omitted by
              relevance or budget
            </span>
            <small>
              Copilot receives the intent, OKF evidence, graph relationships, symbols, contracts,
              excerpts and validation context below. It is instructed not to perform a
              repository-wide search.
            </small>
          </div>
          <label>
            Agent
            <select
              value={this.state.agent}
              onChange={(event: React.FormEvent<HTMLSelectElement>) =>
                this.field("agent", event.currentTarget.value)
              }
            >
              <option value="GitHub Copilot">GitHub Copilot</option>
              {(task.copilotCustomizations?.agents ?? []).map((agent) => (
                <option key={agent.id} value={agent.name}>
                  {agent.name} · {agent.path}
                </option>
              ))}
            </select>
          </label>
          <label>
            Skills
            <input
              value={this.state.skills}
              onChange={(event: React.FormEvent<HTMLInputElement>) =>
                this.field("skills", event.currentTarget.value)
              }
              placeholder={
                task.repoSkills?.map((skill) => skill.name).join(", ") || "Repository skills"
              }
            />
          </label>
          {Boolean(task.copilotCustomizations?.skills.length) && (
            <div className="actions">
              <button onClick={() => this.useRepositorySkills(task)}>Use discovered skills</button>
              {task.copilotCustomizations!.skills.slice(0, 6).map((skill) => (
                <button key={skill.id} onClick={() => this.addRepositorySkill(skill.name)}>
                  + {skill.name}
                </button>
              ))}
            </div>
          )}
          <label>
            Instructions
            <textarea
              value={this.state.instructions}
              onChange={(event: React.FormEvent<HTMLTextAreaElement>) =>
                this.field("instructions", event.currentTarget.value)
              }
            />
          </label>
          {Boolean(task.copilotCustomizations?.instructions.length) && (
            <button onClick={() => this.useRepositoryInstructions(task)}>
              Use repository instructions
            </button>
          )}
          <details>
            <summary>Intelligence passed to Copilot</summary>
            <pre>
              {task.boundedIntelligence ??
                "This task was created before the bounded intelligence digest was available. Regenerate the intent context to include it."}
            </pre>
          </details>
          <details>
            <summary>Delegation prompt</summary>
            <pre>{task.copilotPrompt}</pre>
          </details>
          {current && (
            <button
              className="advanced-action"
              disabled={current.status !== "in-progress"}
              onClick={() => this.delegate(current)}
            >
              Delegate selected story (advanced)
            </button>
          )}
          {this.state.application.delegationResult && (
            <details open={Boolean(this.state.application.delegationResult.captured)}>
              <summary>
                Latest Copilot result ·{" "}
                {this.state.application.delegationResult.captured ? "captured" : "external"}
              </summary>
              <p>
                {this.state.application.delegationResult.model?.name ??
                  this.state.application.delegationResult.mode}
              </p>
              {this.state.application.delegationResult.contextPackageId && (
                <small>
                  ContextPackage received:{" "}
                  {this.state.application.delegationResult.contextPackageId}
                </small>
              )}
              {this.state.application.delegationResult.contextUsage && (
                <small>
                  Prepared context:{" "}
                  {this.state.application.delegationResult.contextUsage.estimatedTransmittedTokens}{" "}
                  estimated tokens ·{" "}
                  {this.state.application.delegationResult.contextUsage.transmittedCandidateCount}{" "}
                  transmitted ·{" "}
                  {this.state.application.delegationResult.contextUsage.omittedContextCount}{" "}
                  retrievable/omitted
                </small>
              )}
              {this.state.application.delegationResult.artifactPath && (
                <code>{this.state.application.delegationResult.artifactPath}</code>
              )}
              {structured && (
                <div className="structured-result">
                  <span
                    className={`status ${this.state.application.delegationResult.structuredStatus ?? "complete"}`}
                  >
                    Structured result{" "}
                    {this.state.application.delegationResult.structuredStatus ?? "complete"}
                  </span>
                  {structured.summary && <p>{structured.summary}</p>}
                  <small>
                    {structured.findings?.length ?? 0} finding(s) ·{" "}
                    {structured.decisionsProposed?.length ?? 0} decision candidate(s) ·{" "}
                    {structured.evidenceReferences?.length ?? 0} evidence reference(s)
                  </small>
                  {delegationResult.structuredSource && (
                    <small>
                      Captured through{" "}
                      {delegationResult.structuredSource === "language-model-tool"
                        ? "Copilot's structured response tool"
                        : "safe JSON recovery"}
                      .
                    </small>
                  )}
                  {(structured.recommendation ||
                    structured.risks?.length ||
                    structured.blockers?.length ||
                    structured.proposedActions?.length ||
                    details) && (
                    <div className="structured-fields">
                      {structured.recommendation && (
                        <div>
                          <b>Recommendation</b>
                          <p>{structured.recommendation}</p>
                        </div>
                      )}
                      {structured.risks?.length ? (
                        <div>
                          <b>Risks</b>
                          <ul>
                            {structured.risks.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {structured.blockers?.length ? (
                        <div>
                          <b>Blockers</b>
                          <ul>
                            {structured.blockers.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {structured.proposedActions?.length ? (
                        <div>
                          <b>Proposed actions</b>
                          <ul>
                            {structured.proposedActions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {structured.affectedAreas?.length ? (
                        <div>
                          <b>Affected areas</b>
                          <p>{structured.affectedAreas.join(" · ")}</p>
                        </div>
                      ) : null}
                      {structured.questions?.length ? (
                        <div>
                          <b>Questions</b>
                          <ul>
                            {structured.questions.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {structured.findings?.length ? (
                        <div>
                          <b>Findings</b>
                          <ul>
                            {structured.findings.map((finding, index) => (
                              <li key={`${finding.summary}-${index}`}>
                                {finding.severity ? `${finding.severity}: ` : ""}
                                {finding.summary}
                                {finding.evidence?.length
                                  ? ` · ${finding.evidence.length} evidence link(s)`
                                  : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                      {details && (
                        <div>
                          <b>Copilot outcome details</b>
                          {details.understanding && <p>{details.understanding}</p>}
                          {details.approach && (
                            <p>
                              <b>Approach:</b> {details.approach}
                            </p>
                          )}
                          {details.nextAction && (
                            <p>
                              <b>Next action:</b> {details.nextAction}
                            </p>
                          )}
                          {details.likelyScope?.length ? (
                            <p>
                              <b>Likely scope:</b> {details.likelyScope.join(" · ")}
                            </p>
                          ) : null}
                          {details.changedAreas?.length ? (
                            <p>
                              <b>Changed areas:</b> {details.changedAreas.join(" · ")}
                            </p>
                          ) : null}
                          {details.unresolvedIssues?.length ? (
                            <p>
                              <b>Unresolved:</b> {details.unresolvedIssues.join(" · ")}
                            </p>
                          ) : null}
                          {details.constraintsDetected?.length ? (
                            <p>
                              <b>Constraints:</b> {details.constraintsDetected.join(" · ")}
                            </p>
                          ) : null}
                          {details.dependencies?.length ? (
                            <p>
                              <b>Dependencies:</b> {details.dependencies.join(" · ")}
                            </p>
                          ) : null}
                        </div>
                      )}
                    </div>
                  )}
                  {structured.evidenceReferences?.length ? (
                    <div className="evidence-trace">
                      <b>Evidence trace</b>
                      {structured.evidenceReferences.map((reference) => (
                        <span key={`${reference.label}-${reference.path ?? ""}`}>
                          {reference.verifiedAgainstContext ? "Source fact" : "Copilot assertion"}:{" "}
                          {reference.label}
                          {reference.path ? ` · ${reference.path}` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <small className="callout subtle">
                    Structured content is a Copilot recommendation until you accept a decision;
                    matched ContextPackage evidence remains separately identified as source fact.
                  </small>
                </div>
              )}
              {this.state.application.delegationResult.structuredWarning && (
                <div className="callout warning">
                  {this.state.application.delegationResult.structuredWarning}
                </div>
              )}
              {this.state.application.delegationResult.text && (
                <pre>{this.state.application.delegationResult.text}</pre>
              )}
            </details>
          )}
          {this.state.application.correctionPacket ? (
            <details className="correction-packet" open>
              <summary>
                Correction packet · {this.state.application.correctionPacket.reason} · OKF snapshot{" "}
                {this.state.application.correctionPacket.snapshotDigest.slice(0, 12)}…
              </summary>
              <p>
                {this.state.application.correctionPacket.validation.failures.length} validation
                failure(s) · {this.state.application.correctionPacket.canonical.unitIds.length} OKF
                unit(s) · {this.state.application.correctionPacket.selectedPaths.length} selected
                path(s)
              </p>
              <small>
                {this.state.application.correctionPacket.changedPaths?.length ?? 0} changed file(s)
                · {this.state.application.correctionPacket.affectedPaths?.length ?? 0} OKF-affected
                path(s)
                {this.state.application.correctionPacket.diffHash
                  ? ` · diff ${this.state.application.correctionPacket.diffHash.slice(0, 12)}…`
                  : ""}
              </small>
              <div className="actions">
                {current?.status === "review-required" && (
                  <button
                    className="primary"
                    onClick={() =>
                      this.delegateCorrection(current, this.state.application.correctionPacket!)
                    }
                  >
                    Approve correction with Copilot
                  </button>
                )}
                <button
                  className="primary"
                  onClick={() =>
                    vscode.postMessage({
                      type: "COPY_COPILOT_PROMPT",
                      prompt: this.state.application.correctionPacket!.prompt
                    })
                  }
                >
                  Copy correction packet
                </button>
                <button onClick={() => vscode.postMessage({ type: "REQUEST_CORRECTION_PACKET" })}>
                  Regenerate from latest validation
                </button>
                <button
                  onClick={() => vscode.postMessage({ type: "REINDEX_AFFECTED_AND_VALIDATE" })}
                >
                  Refresh affected paths &amp; validate
                </button>
              </div>
              <details>
                <summary>Canonical evidence and failure guidance</summary>
                <ul className="fact-list">
                  {this.state.application.correctionPacket.validation.failures.map((failure) => (
                    <li key={failure}>
                      <b>Failure</b>
                      <span>{failure}</span>
                    </li>
                  ))}
                  {this.state.application.correctionPacket.canonical.paths.map((pathValue) => (
                    <li key={pathValue}>
                      <b>OKF path</b>
                      <span>{pathValue}</span>
                    </li>
                  ))}
                </ul>
              </details>
              <details>
                <summary>Correction prompt</summary>
                <pre>{this.state.application.correctionPacket.prompt}</pre>
              </details>
            </details>
          ) : (
            <button onClick={() => vscode.postMessage({ type: "REQUEST_CORRECTION_PACKET" })}>
              Generate correction packet from latest validation
            </button>
          )}
        </Panel>
      </div>
    );
  }

  private contextExperience(task?: TaskResult): JSX.Element {
    const operation = this.state.application.operations?.find(
      (item) => item.kind === "analysis" && item.status === "running"
    );
    if (operation || this.state.application.status === "analyzing") {
      return (
        <div className="context-preparing" aria-live="polite">
          <div className="context-preparing-heading">
            <span className="context-status-dot preparing" />
            <div>
              <strong>Preparing context</strong>
              <span>{operation?.message ?? "Selecting relevant repository evidence."}</span>
            </div>
            <span className="context-progress-value">{Math.round(operation?.progress ?? 5)}%</span>
          </div>
          <div className="progress" aria-label="Context preparation progress">
            <i style={{ width: `${Math.max(5, Math.min(100, operation?.progress ?? 5))}%` }} />
          </div>
          <small>Research continues in the background. You can keep working in the panel.</small>
        </div>
      );
    }
    const summary = task?.contextSummary;
    if (!summary) {
      return (
        <div className="context-empty-state">
          <span className="context-status-dot" />
          <div>
            <strong>Context not prepared</strong>
            <span>Research an intent to see what Keystone will tell Copilot.</span>
          </div>
        </div>
      );
    }
    const inspector = summary.inspector ?? {
      estimatedPreparedTokens: summary.estimatedTransmittedTokens,
      estimatedAvoidedTokens: Math.max(
        0,
        (task.contextTokens?.raw ?? 0) - summary.estimatedTransmittedTokens
      ),
      mustPreserve: summary.candidates.filter((item) =>
        ["intent", "decisions"].includes(item.category)
      ),
      included: summary.candidates.filter(
        (item) => !["intent", "decisions"].includes(item.category)
      ),
      availableOnDemand: summary.retainedCandidates ?? [],
      excluded: []
    };
    return (
      <div className="context-experience">
        <div className="context-ready-summary">
          <div className="context-ready-heading">
            <span className="context-status-dot ready" />
            <div>
              <strong>Context ready</strong>
              <span>Focused for the current intent · estimates, not exact token accounting</span>
            </div>
          </div>
          <div className="context-estimate-grid">
            <div>
              <span>Prepared</span>
              <strong>{formatContextTokens(inspector.estimatedPreparedTokens)}</strong>
            </div>
            <div>
              <span>Avoided</span>
              <strong>{formatContextTokens(inspector.estimatedAvoidedTokens)}</strong>
            </div>
          </div>
          <div className="context-counts" aria-label="Context coverage">
            <span>{inspector.mustPreserve.length} must preserve</span>
            <span>{inspector.included.length} included</span>
            <span>{inspector.availableOnDemand.length} available on demand</span>
            <span>{inspector.excluded.length} excluded</span>
          </div>
          <small className="context-package-id">
            ContextPackage {summary.id} · this is the exact package available to Copilot
          </small>
          <button
            className="primary context-inspect-button"
            onClick={() =>
              this.setState((previous) => ({
                contextInspectorOpen: !previous.contextInspectorOpen
              }))
            }
            aria-expanded={this.state.contextInspectorOpen}
          >
            {this.state.contextInspectorOpen ? "Close Context Inspector" : "Inspect Context"}
          </button>
        </div>
        {this.state.contextInspectorOpen && (
          <div className="context-inspector">
            <div className="context-inspector-intro">
              <div>
                <strong>What Copilot is being told</strong>
                <span>
                  Keystone keeps the active objective and decisions visible, adds relevant
                  repository evidence, and leaves supporting material retrievable.
                </span>
              </div>
              <small>
                {formatContextTokens(inspector.estimatedPreparedTokens)} prepared ·{" "}
                {formatContextTokens(inspector.estimatedAvoidedTokens)} avoided
              </small>
            </div>
            {this.contextGroup(
              "MUST PRESERVE",
              "The objective, constraints and decisions that should remain visible.",
              inspector.mustPreserve
            )}
            {this.contextGroup(
              "INCLUDED",
              "Relevant repository facts and existing implementation patterns in the prepared context.",
              inspector.included
            )}
            {this.contextGroup(
              "AVAILABLE ON DEMAND",
              "Supporting context retained locally and expandable when the work needs more detail.",
              inspector.availableOnDemand,
              true
            )}
            {this.contextGroup(
              "EXCLUDED",
              "Known material intentionally left out because it is unrelated to this operation or duplicates included facts.",
              inspector.excluded
            )}
            <details className="context-advanced">
              <summary>Advanced details</summary>
              <p>
                Context references are tied to the repository revision used during preparation.
                Source files remain authoritative; an expansion is marked stale if that source has
                changed.
              </p>
              <small>
                Prepared for the current Intent · {summary.allCandidateCount} candidate(s)
                considered · revision {summary.sourceRevision.slice(0, 12)}…
              </small>
            </details>
          </div>
        )}
        {this.state.expandedContext && this.expandedContextView()}
      </div>
    );
  }

  private contextGroup(
    title: string,
    description: string,
    items: readonly ContextInspectorItem[],
    expandable = false
  ): JSX.Element {
    return (
      <section className={`context-group ${items.length ? "" : "empty-group"}`}>
        <div className="context-group-heading">
          <div>
            <h3>{title}</h3>
            <p>{description}</p>
          </div>
          <span className="context-group-count">{items.length}</span>
        </div>
        {items.length ? (
          <div className="context-group-items">
            {items.map((item) => (
              <article className="context-item" key={`${title}-${item.id}`}>
                <div className="context-item-main">
                  <strong>{item.label}</strong>
                  {item.reason && <span>{item.reason}</span>}
                </div>
                {item.path && (
                  <button
                    className="link-button context-source"
                    onClick={() => this.openSource(item.path!)}
                  >
                    {item.path}
                  </button>
                )}
                {item.evidence
                  .filter((evidence) => evidence.path)
                  .slice(0, 3)
                  .map((evidence, index) => (
                    <button
                      className="link-button context-evidence-link"
                      key={`${item.id}-evidence-${index}`}
                      onClick={() =>
                        this.openSource(evidence.path!, evidence.line ?? evidence.startLine)
                      }
                    >
                      Evidence · {evidence.path}
                      {(evidence.line ?? evidence.startLine)
                        ? `:${evidence.line ?? evidence.startLine}`
                        : ""}
                    </button>
                  ))}
                <div className="context-item-meta">
                  {item.expandable && <em className="expandable-badge">Expandable</em>}
                  {item.compressed && <span>Prepared as a concise fact</span>}
                  {expandable && item.expandable && (
                    <button
                      className="context-expand-button"
                      disabled={this.state.expandingContextReference === item.contextReference}
                      onClick={() => this.expandContext(item)}
                    >
                      {this.state.expandingContextReference === item.contextReference
                        ? "Preparing…"
                        : "Expand"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="context-group-empty">None for this intent.</div>
        )}
      </section>
    );
  }

  private expandContext(item: ContextInspectorItem): void {
    this.setState({ expandingContextReference: item.contextReference, contextInspectorOpen: true });
    vscode.postMessage({
      type: "EXPAND_CONTEXT",
      contextReference: item.contextReference,
      focus: item.label,
      level: "L2"
    });
  }

  private expandedContextView(): JSX.Element {
    const expansion = this.state.expandedContext!;
    return (
      <details className="context-expansion" open>
        <summary>Expanded context · {expansion.candidates.length} item(s)</summary>
        {expansion.stale && (
          <div className="callout warning context-stale-callout">
            <strong>This expansion is stale</strong>
            <span>
              The source changed after context was prepared. Inspect the current source before
              relying on it.
            </span>
            {expansion.staleSources.map((source) => (
              <button
                className="link-button"
                key={source.path}
                onClick={() => this.openSource(source.path)}
              >
                Inspect current source · {source.path}
              </button>
            ))}
          </div>
        )}
        {expansion.candidates.map((candidate) => {
          const path = candidate.provenance?.authoritativePath;
          return (
            <div className="expansion-provenance" key={candidate.id}>
              <span>
                {candidate.stale ? "Stale · " : ""}
                {String(candidate.payload.label ?? candidate.payload.path ?? candidate.id)}
              </span>
              {path && (
                <button className="link-button" onClick={() => this.openSource(path)}>
                  Inspect source · {path}
                </button>
              )}
            </div>
          );
        })}
        <pre>{expansion.content}</pre>
      </details>
    );
  }

  private useRepositorySkills(task: TaskResult): void {
    const names = (task.copilotCustomizations?.skills ?? task.repoSkills ?? []).map(
      (skill) => skill.name
    );
    this.setState({
      skills: [...new Set(names)].join(", "),
      notice: `Selected ${names.length} repository skill(s) for the next delegation.`
    });
  }
  private loadContextPacket(packetId: string, segmentKinds?: ContextPacketSegmentKind[]): void {
    vscode.postMessage({
      type: "LOAD_CONTEXT_PACKET",
      packetId,
      segmentKinds
    });
  }
  private addRepositorySkill(name: string): void {
    const current = this.state.skills
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    this.setState({ skills: [...new Set([...current, name])].join(", ") });
  }
  private useRepositoryInstructions(task: TaskResult): void {
    const inventory = task.copilotCustomizations?.instructions ?? [];
    const lines = inventory.flatMap((item) => [
      `Repository instruction: ${item.path} — ${item.description}`,
      ...item.guidance.map((value) => `- ${value}`)
    ]);
    const base =
      "Follow the approved specification and repository instructions. Use only the supplied evidence. Do not perform Git write operations.";
    this.setState({
      instructions: [base, ...lines].join("\n"),
      notice: `Loaded ${inventory.length} repository instruction source(s) for review before delegation.`
    });
  }
  private delegate(story?: Story): void {
    const task = this.state.task;
    if (!task) return;
    const discovered = task.repoSkills?.map((skill) => skill.name) ?? [];
    const selectedSkills = this.state.skills
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    vscode.postMessage({
      type: "APPROVE_DELEGATION",
      mode: "Copilot Chat",
      prompt: task.copilotPrompt,
      storyId: story?.id,
      agent: this.state.agent.trim() || "GitHub Copilot",
      skills: selectedSkills.length ? selectedSkills : discovered,
      instructions: this.state.instructions
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      contextPackId: task.contextSummary?.id
    });
  }
  private delegateCorrection(story: Story, packet: CorrectionPacket): void {
    const task = this.state.task;
    if (!task) return;
    const selectedSkills = this.state.skills
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    vscode.postMessage({
      type: "APPROVE_DELEGATION",
      mode: "Copilot Chat",
      prompt: packet.prompt,
      storyId: story.id,
      correctionPacketId: packet.id,
      agent: this.state.agent.trim() || "GitHub Copilot",
      skills: selectedSkills.length
        ? selectedSkills
        : (task.repoSkills?.map((skill) => skill.name) ?? []),
      instructions: this.state.instructions
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean),
      contextPackId: packet.contextPackageId ?? task.contextSummary?.id
    });
  }
  private openHandoff(): void {
    this.navigate("Work");
    setTimeout(() => document.getElementById("handoff")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  private activity(): JSX.Element {
    const activity = this.state.application.intelligenceActivity ?? [];
    const operations = this.state.application.operations ?? [];
    return (
      <section>
        <div className="page-title">
          <div>
            <p className="eyebrow">ACTIVITY</p>
            <h1>Visible, non-blocking operations</h1>
            <p>
              Indexing, analysis, intelligence exploration, SDLC transitions, validation, delegation
              and handoff remain observable.
            </p>
          </div>
        </div>
        {this.ingestionStatus()}
        {this.backgroundWorkerPanel()}
        <div className="two-column">
          <Panel
            title="Operations"
            subtitle="Long-running work reports progress without blocking the UI."
          >
            {operations.length ? (
              <div className="timeline">
                {operations.map((operation) => (
                  <div key={operation.id}>
                    <span className={`status-dot ${operation.status}`} />
                    <div>
                      <b>{operation.kind}</b>
                      <p>{operation.message}</p>
                      <div className="progress">
                        <i style={{ width: `${operation.progress}%` }} />
                      </div>
                    </div>
                    <Status value={operation.status} />
                  </div>
                ))}
              </div>
            ) : (
              <Empty text="No active operations." />
            )}
          </Panel>
          <Panel title="Intelligence activity" subtitle="Persisted repository events.">
            {activity.length ? (
              <div className="timeline">
                {activity
                  .slice()
                  .reverse()
                  .slice(0, 60)
                  .map((event, index) => (
                    <div key={event.id ?? `${event.timestamp}-${index}`}>
                      <span className="status-dot completed" />
                      <div>
                        <b>{event.type}</b>
                        <p>{event.message}</p>
                        <small>{new Date(event.timestamp).toLocaleString()}</small>
                      </div>
                      {event.progress !== undefined && <span>{event.progress}%</span>}
                    </div>
                  ))}
              </div>
            ) : (
              <Empty text="No activity yet." />
            )}
          </Panel>
        </div>
      </section>
    );
  }
}

function ResearchDocumentView({
  research,
  onOpen,
  compact = false
}: {
  research: TaskResult["researchDocument"];
  onOpen?: (path: string) => void;
  compact?: boolean;
}): JSX.Element {
  const evidence = research.evidenceMatrix.slice(0, compact ? 12 : 24);
  return (
    <article className="engineering-document">
      <div className="document-header">
        <div>
          <p className="eyebrow">REPOSITORY R&D</p>
          <h3>{research.title}</h3>
          <p>{research.problemStatement}</p>
        </div>
        <Status value={research.unknowns.length ? "review-required" : "evidence-backed"} />
      </div>
      <div className="document-sections">
        <DocumentList title="Architecture impact" items={research.affectedArchitecture} />
        <DocumentList title="Behavior and data flows" items={research.affectedFlows} />
        <DocumentList title="Existing / missing test landscape" items={research.affectedTests} />
        <DocumentList title="Risks" items={research.risks} />
        <DocumentList title="Constraints" items={research.constraints} />
        <DocumentList title="Recommended approach" items={research.recommendedApproach ?? []} />
        <DocumentList title="Testing strategy" items={research.testingStrategy ?? []} />
        <DocumentList title="Open questions" items={research.unknowns} />
      </div>
      <details open={!compact}>
        <summary>Curated repository evidence ({research.evidenceMatrix.length})</summary>
        <div className="evidence-stack">
          {evidence.map((item) => (
            <div key={item.id}>
              <span className="kind">{item.kind}</span>
              <b>{item.label}</b>
              {item.path &&
                (onOpen ? (
                  <button className="link-button" onClick={() => onOpen(item.path!)}>
                    {item.path}
                  </button>
                ) : (
                  <code>{item.path}</code>
                ))}
              <small>{item.summary}</small>
              {item.confidence !== undefined && <span>{Math.round(item.confidence * 100)}%</span>}
            </div>
          ))}
        </div>
        {research.evidenceMatrix.length > evidence.length && (
          <small>
            {research.evidenceMatrix.length - evidence.length} additional evidence item(s) remain
            available in Intelligence Explorer.
          </small>
        )}
      </details>
      <details>
        <summary>Raw R&D Markdown</summary>
        <pre className="document-view">{research.markdown}</pre>
      </details>
    </article>
  );
}
function SpecificationDocumentView({
  specification
}: {
  specification: SdlcPlan["specificationDocument"];
}): JSX.Element {
  if (!specification)
    return (
      <article className="engineering-document">
        <Empty text="Specification has not been generated yet." />
      </article>
    );
  return (
    <article className="engineering-document">
      <div className="document-header">
        <div>
          <p className="eyebrow">IMPLEMENTATION SPECIFICATION</p>
          <h3>{specification.title}</h3>
          <p>{specification.summary}</p>
        </div>
      </div>
      <div className="document-sections">
        <DocumentList
          title="Functional requirements"
          items={specification.functionalRequirements}
        />
        <DocumentList
          title="Non-functional requirements"
          items={specification.nonFunctionalRequirements}
        />
        <DocumentList title="Architecture decisions" items={specification.architectureDecisions} />
        <DocumentList title="Affected interfaces" items={specification.affectedInterfaces} />
        <DocumentList title="Data / migration impact" items={specification.dataChanges} />
        <DocumentList title="Validation plan" items={specification.validationPlan} />
        <DocumentList title="Acceptance criteria" items={specification.acceptanceCriteria} />
        <DocumentList title="Open questions" items={specification.unknowns} />
      </div>
      <details>
        <summary>Raw specification Markdown</summary>
        <pre className="document-view">{specification.markdown}</pre>
      </details>
    </article>
  );
}
function DocumentList({ title, items }: { title: string; items: readonly string[] }): JSX.Element {
  return (
    <section className="document-section">
      <h4>{title}</h4>
      {items.length ? (
        <ul>
          {items.slice(0, 12).map((item, index) => (
            <li key={`${title}-${index}-${item}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <small>No material item identified.</small>
      )}
    </section>
  );
}

function navFromHash(): Nav {
  const value = location.hash.replace("#", "");
  return (["Home", "Intelligence", "Work", "Activity"] as Nav[]).includes(value as Nav)
    ? (value as Nav)
    : "Home";
}
function Panel(props: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <h2>{props.title}</h2>
          {props.subtitle && <p>{props.subtitle}</p>}
        </div>
      </div>
      {props.children}
    </section>
  );
}
function Metric(props: { label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </div>
  );
}
function Status({ value }: { value: string }): JSX.Element {
  return (
    <span className={`status ${value.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>{value}</span>
  );
}
function Empty({ text }: { text: string }): JSX.Element {
  return <div className="empty">{text}</div>;
}
function formatContextTokens(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "~0";
  if (value >= 1_000_000) return `~${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `~${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `~${Math.round(value)}`;
}
function WorkerInsights({
  worker,
  result
}: {
  worker: BackgroundWorkerId;
  result?: unknown;
}): JSX.Element {
  const record = asRecord(result);
  const insights: Array<{ label: string; detail: string }> = [];
  const add = (label: string, detail: unknown): void => {
    if (typeof detail === "string" && detail.trim())
      insights.push({ label, detail: detail.trim() });
  };
  for (const finding of asArray(record?.findings).slice(0, 3)) {
    const item = asRecord(finding);
    if (!item) continue;
    const location = [item.path, item.line].filter((value) => value !== undefined).join(":");
    add(
      `${String(item.severity ?? "Finding")}: ${String(item.title ?? item.category ?? "Repository finding")}`,
      [location, item.explanation ?? item.reason ?? item.evidence].filter(Boolean).join(" — ")
    );
  }
  if (worker === "qa") {
    for (const gap of asArray(record?.gaps).slice(0, 2)) {
      const item = asRecord(gap);
      if (item)
        add(
          `Test gap: ${String(item.type ?? "coverage gap")}`,
          `${item.filePath ?? "repository"} — ${item.reason ?? "Coverage is incomplete."}`
        );
    }
  }
  for (const recommendation of asArray(record?.recommendations).slice(0, 3)) {
    const item = asRecord(recommendation);
    add(
      "Recommended next step",
      item
        ? [item.title, item.description, item.suggestedAction].filter(Boolean).join(" — ")
        : recommendation
    );
  }
  const assessment = asRecord(record?.assessment);
  for (const recommendation of asArray(assessment?.recommendations).slice(0, 2))
    add("Recommended next step", recommendation);
  for (const gap of asArray(record?.gaps).slice(0, worker === "qa" ? 0 : 2)) {
    const item = asRecord(gap);
    if (item)
      add(
        `Modernization gap: ${String(item.title ?? item.area ?? "Review")}`,
        asArray(item.evidence).join(" · ")
      );
  }
  return insights.length ? (
    <div className="worker-insights">
      <small>Key evidence and next actions</small>
      {insights.slice(0, 5).map((item, index) => (
        <div key={`${item.label}-${index}`}>
          <b>{item.label}</b>
          <span>{item.detail}</span>
        </div>
      ))}
    </div>
  ) : (
    <small className="worker-meta">No actionable finding was reported for this analysis.</small>
  );
}
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function EvidenceList({
  items,
  empty,
  onOpen
}: {
  items: EvidenceItem[];
  empty: string;
  onOpen?: (path: string, line?: number) => void;
}): JSX.Element {
  return items.length ? (
    <div className="evidence-stack">
      {items.map((item, index) => (
        <div key={item.id ?? item.okfId ?? `${item.kind}-${index}`}>
          <span className="kind">{item.kind}</span>
          <b>{item.label}</b>
          {item.path &&
            (onOpen ? (
              <button className="link-button" onClick={() => onOpen(item.path!, item.line)}>
                {item.path}
              </button>
            ) : (
              <code>{item.path}</code>
            ))}
          {item.summary && <small>{item.summary}</small>}
          {item.reason && <small>{item.reason}</small>}
          {item.relationshipPath?.length ? (
            <small>{item.relationshipPath.slice(-3).join(" → ")}</small>
          ) : null}
          {item.confidence !== undefined && <span>{Math.round(item.confidence * 100)}%</span>}
        </div>
      ))}
    </div>
  ) : (
    <Empty text={empty} />
  );
}
function LanguageCard({ language }: { language: LanguageCapability }): JSX.Element {
  const active = (language.files ?? 0) > 0;
  const semanticFiles = language.semanticFiles ?? 0;
  const deterministicFiles = language.deterministicFiles ?? 0;
  const capabilities = Object.entries(language.capabilities ?? {})
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .slice(0, 4)
    .join(" · ");
  return (
    <article className={active ? "language active-language" : "language"}>
      <div>
        <b>{language.label}</b>
        <Status value={language.baseline ?? language.level} />
      </div>
      <p>
        {language.semanticProvider === "none"
          ? "Deterministic structural frontend"
          : `${language.semanticProvider} enrichment`}
      </p>
      <small>
        {language.files ?? 0} file(s) ·{" "}
        {(language.extensions ?? []).slice(0, 5).join(" ") || "universal text"}
      </small>
      <small>
        {semanticFiles > 0 ? `${semanticFiles} semantic` : "structural"}
        {deterministicFiles > 0 ? ` · ${deterministicFiles} deterministic fallback` : ""}
        {capabilities ? ` · ${capabilities}` : ""}
      </small>
      {language.warnings?.length ? (
        <span className="language-warning">{language.warnings[0]}</span>
      ) : null}
    </article>
  );
}
function BacklogCard({ story }: { story: BacklogStory }): JSX.Element {
  return (
    <article className={`backlog ${story.kind}`}>
      <div>
        <span>{story.kind}</span>
        <Status value={story.status} />
      </div>
      <h3>{story.title}</h3>
      <p>{story.description}</p>
      <ul>
        {story.acceptanceCriteria.slice(0, 5).map((value) => (
          <li key={value}>{value}</li>
        ))}
      </ul>
      <details>
        <summary>Scope and evidence</summary>
        <p>
          <b>Files:</b> {story.scope?.files?.join(", ") || "resolved during implementation"}
        </p>
        <p>
          <b>Interfaces:</b> {story.scope?.interfaces?.join(", ") || "none identified"}
        </p>
        <p>
          <b>Evidence:</b> {story.evidence.join(" · ")}
        </p>
      </details>
    </article>
  );
}
function ExplorerRow({
  item,
  onOpen,
  onGraph
}: {
  item: IntelligenceExplorerItem;
  onOpen: (path: string, line?: number) => void;
  onGraph: (item: IntelligenceExplorerItem) => void;
}): JSX.Element {
  return (
    <article className="explorer-row">
      <div>
        <span className="kind">{item.kind}</span>
        <b>{item.label}</b>
        <Status value={`${Math.round(item.confidence * 100)}%`} />
      </div>
      {item.description && <p>{item.description}</p>}
      {item.path && (
        <button className="link-button" onClick={() => onOpen(item.path!, item.line)}>
          {item.path}
          {item.line ? `:${item.line}` : ""}
        </button>
      )}
      <small>
        {item.incoming} incoming · {item.outgoing} outgoing · {item.evidenceIds.length} evidence
        link(s)
      </small>
      <button onClick={() => onGraph(item)}>Show neighborhood</button>
    </article>
  );
}
function GraphInspector({
  node,
  relationshipKinds,
  onOpen,
  onFocus,
  onExpand,
  collapsed,
  onCollapse
}: {
  node: IntelligenceGraphNode | undefined;
  relationshipKinds: readonly string[];
  onOpen: (path: string, line?: number) => void;
  onFocus: (node: IntelligenceGraphNode) => void;
  onExpand: (node: IntelligenceGraphNode) => void;
  collapsed: boolean;
  onCollapse: (node: IntelligenceGraphNode) => void;
}): JSX.Element {
  return (
    <div className="graph-inspector">
      {node ? (
        <div className="inspector-content">
          <p className="eyebrow">SELECTED NODE</p>
          <h3>{node.label}</h3>
          <Status value={node.kind} />
          <p>
            {Math.round(node.confidence * 100)}% confidence · {node.evidenceIds.length} evidence
            link(s)
          </p>
          {node.path && (
            <button className="link-button" onClick={() => onOpen(node.path!, node.line)}>
              {node.path}
              {node.line ? `:${node.line}` : ""}
            </button>
          )}
          <div className="actions">
            <button onClick={() => onFocus(node)}>Focus neighborhood</button>
            <button onClick={() => onExpand(node)}>Expand neighborhood</button>
            <button onClick={() => onCollapse(node)}>
              {collapsed ? "Expand branch" : "Collapse branch"}
            </button>
          </div>
          <details>
            <summary>Visible relationship kinds</summary>
            <p>{relationshipKinds.join(" · ") || "none"}</p>
          </details>
        </div>
      ) : (
        <Empty text="Select a graph node." />
      )}
    </div>
  );
}
function EvidenceGroup({
  title,
  status,
  items,
  onOpen
}: {
  title: string;
  status: string;
  items: Array<{ label: string; path?: string; line?: number; detail?: string }>;
  onOpen?: (path: string, line?: number) => void;
}): JSX.Element {
  return (
    <section className="evidence-group">
      <div>
        <h3>{title}</h3>
        <Status value={status} />
      </div>
      {items.length ? (
        items.slice(0, 30).map((item, index) => (
          <article key={`${item.label}-${index}`}>
            <b>{item.label}</b>
            {item.path &&
              (onOpen ? (
                <button className="link-button" onClick={() => onOpen(item.path!, item.line)}>
                  {item.path}
                  {item.line ? `:${item.line}` : ""}
                </button>
              ) : (
                <code>{item.path}</code>
              ))}
            {item.detail && <small>{item.detail}</small>}
          </article>
        ))
      ) : (
        <Empty text={`No ${title.toLowerCase()} finding for the selected task context.`} />
      )}
    </section>
  );
}
