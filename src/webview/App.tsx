import { vscode } from './vscodeApi.js';
import { GraphCanvas, type VisualGraphNode } from './GraphCanvas.js';
import type {
  ApplicationState, BacklogStory, CopilotDelegationResult, EvidenceItem, IntelligenceCpgResult, IntelligenceExplorerItem,
  IntelligenceExplorerResult, IntelligenceGraphMode, IntelligenceGraphNode, IntelligenceGraphResult, IntelligenceQueryResult,
  IntelligenceSummary, IntelligenceView, LanguageCapability, Nav, SdlcPlan, Story, TaskResult,
} from './model.js';

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
  selectedStoryId?: string;
}

const emptyApplication: ApplicationState = { version: 1, status: 'idle', intelligenceActivity: [], handoffs: [], operations: [] };
const intelligenceViews: IntelligenceView[] = ['Overview','Explorer','Graph','CPG','Flows','Query'];
const graphModes: IntelligenceGraphMode[] = ['repository','architecture','dependencies','calls','tests','impact'];

export class App extends React.Component<Record<string, never>, AppState> {
  state: AppState = {
    nav: navFromHash(), application: emptyApplication, notice: 'Keystone is ready.', intent: '', passphrase: '', handoffText: '', manualSyncConfirmed: false,
    query: '', queryItems: [], intelligenceView: 'Overview', explorerQuery: '', explorerKind: 'all', graphMode: 'repository', graphQuery: '', graphRelationshipKind: 'all', cpgPath: '', cpgEdgeKind: 'all',
    agent: 'GitHub Copilot', skills: '', instructions: 'Follow the approved specification and repository instructions. Use only the supplied evidence. Do not perform Git write operations.',
    valueEdgeFeatureId: '', evidenceText: '', selectedCriteria: {},
  };
  private readonly onMessage = (event: MessageEvent): void => this.handle(event.data as { type?: string; [key: string]: unknown });
  private readonly onHash = (): void => this.setState({ nav: navFromHash() });

  componentDidMount(): void {
    window.addEventListener('message', this.onMessage);
    window.addEventListener('hashchange', this.onHash);
    vscode.postMessage({ type: 'WEBVIEW_READY' });
    vscode.postMessage({ type: 'LOAD_INTELLIGENCE' });
    vscode.postMessage({ type: 'LOAD_RESTORED_TASK_HANDOFF' });
  }
  componentWillUnmount(): void { window.removeEventListener('message', this.onMessage); window.removeEventListener('hashchange', this.onHash); }

  private handle(message: { type?: string; [key: string]: unknown }): void {
    if (!message.type) return;
    if (message.type === 'APPLICATION_STATE') {
      const application = message.state as ApplicationState;
      this.setState({ application, task: application.taskAnalysis ?? this.state.task, plan: application.sdlc ?? this.state.plan });
    } else if (message.type === 'STATE_UPDATE') {
      const patch = message.state as Partial<ApplicationState>;
      this.setState(previous => ({ application: { ...previous.application, ...patch, version: previous.application.version + 1 } }));
    } else if (message.type === 'TASK_RESULT') {
      this.setState({ task: message.result as TaskResult, notice: 'Intent R&D is ready. Review evidence and create the SDLC plan.' });
    } else if (message.type === 'SDLC_PLAN_RESULT') {
      const plan = message.plan as SdlcPlan;
      this.setState({ plan, nav: 'Work', evidenceText: '', selectedCriteria: {}, selectedStoryId: this.state.selectedStoryId && plan.stories.some(story => story.id === this.state.selectedStoryId) ? this.state.selectedStoryId : undefined });
    } else if (message.type === 'INDEX_PROGRESS') {
      this.setState({ notice: `${String(message.stage ?? 'indexing')} · ${Number(message.progress ?? 0)}% · ${String(message.message ?? '')}` });
    } else if (message.type === 'INTELLIGENCE_QUERY_RESULT') {
      const result = message.result as IntelligenceQueryResult;
      this.setState({ queryResult: result, queryItems: result.items ?? [], notice: `${result.intent} query traversed ${result.traversedRelationships} relationship(s) and returned ${result.items?.length ?? 0} evidence-backed result(s).` });
    } else if (message.type === 'INTELLIGENCE_EXPLORER_RESULT') {
      const result = message.result as IntelligenceExplorerResult;
      this.setState({ explorer: result, notice: `Explorer loaded ${result.items.length} of ${result.totalActive} active OKF knowledge unit(s).` });
    } else if (message.type === 'INTELLIGENCE_GRAPH_RESULT') {
      const result = message.result as IntelligenceGraphResult;
      const relationshipKind = this.state.graphRelationshipKind === 'all' || result.relationshipKinds.includes(this.state.graphRelationshipKind) ? this.state.graphRelationshipKind : 'all';
      this.setState({ graph: result, graphMode: result.mode, graphRelationshipKind: relationshipKind, selectedGraphNodeId: result.seedIds[0], notice: `${result.mode} graph loaded ${result.nodes.length} node(s) and ${result.edges.length} relationship(s).` });
    } else if (message.type === 'CPG_VIEW_RESULT') {
      const result = message.result as IntelligenceCpgResult;
      this.setState({ cpg: result, cpgPath: result.sourcePath ?? this.state.cpgPath, selectedCpgNodeId: result.nodes[0]?.id, notice: result.sourcePath ? `CPG loaded for ${result.sourcePath}.` : 'No persisted CPG shard is available yet.' });
    } else if (message.type === 'VALIDATION_RESULT') {
      const results = (message.results as Array<{ status: string }> | undefined) ?? [];
      this.setState({ notice: results.every(item => item.status === 'passed') ? `Validation passed for ${results.length} command(s).` : 'Validation requires review; inspect the active SDLC story.' });
    } else if (message.type === 'DELEGATION_RESULT') {
      const result = message as unknown as CopilotDelegationResult;
      this.setState(previous => ({ application: { ...previous.application, delegationResult: result }, notice: result.success ? (result.captured ? 'Copilot response was captured by Keystone and linked to the active SDLC story.' : 'Copilot delegation opened externally; Keystone is waiting for concrete returned evidence.') : String(result.error ?? 'Delegation failed.') }));
    } else if (message.type === 'TASK_HANDOFF_CREATED') {
      this.setState({ handoffText: String(message.encryptedPackage ?? ''), notice: `Encrypted Task Handoff created and copied to the clipboard. Checksum ${String(message.checksum ?? '').slice(0, 12)}…` });
    } else if (message.type === 'TASK_HANDOFF_RESTORED') {
      this.setState({ plan: (message.packageValue as { sdlcPlan?: SdlcPlan } | undefined)?.sdlcPlan ?? this.state.plan, notice: 'Task Handoff restored. Continue from the exact next action.' });
    } else if (message.type === 'BROWSER_VIEW_OPENED') {
      this.setState({ notice: 'The synchronized Browser View is open.' });
    } else if (message.type === 'VALUEEDGE_FEATURE_RESULT') {
      const feature = message.feature as { id?: string; name?: string; description?: string };
      this.setState({ intent: [feature.name, feature.description].filter(Boolean).join('\n\n'), notice: `Imported ValueEdge feature ${feature.id ?? ''}.` });
    } else if (message.type === 'VALUEEDGE_PUBLISH_RESULT') {
      this.setState({ notice: `Published ${((message.published as unknown[]) ?? []).length} approved stories to ValueEdge.` });
    } else if (message.type === 'NOTIFICATION' || message.type === 'ERROR') {
      this.setState({ notice: String(message.message ?? 'Operation failed.') });
    }
  }

  private navigate(nav: Nav): void {
    location.hash = nav; this.setState({ nav });
    if (nav === 'Intelligence') this.loadIntelligenceSurface(this.state.intelligenceView);
  }
  private field(name: keyof AppState, value: string | boolean): void { this.setState({ [name]: value } as unknown as Pick<AppState, keyof AppState>); }
  private toggleCriterion(criterion: string, checked: boolean): void { this.setState(previous => ({ selectedCriteria: { ...previous.selectedCriteria, [criterion]: checked } })); }
  private currentStory(): Story | undefined {
    const selected = this.state.selectedStoryId ? this.state.plan?.stories.find(story => story.id === this.state.selectedStoryId) : undefined;
    return selected ?? this.state.plan?.stories.find(story => ['in-progress','awaiting-delegation-approval','delegated','awaiting-validation','review-required'].includes(story.status)) ?? this.state.plan?.stories.find(story => story.status === 'ready');
  }
  private selectStory(story: Story): void { this.setState({ selectedStoryId:story.id, evidenceText:'', selectedCriteria:Object.fromEntries(story.satisfiedCriteria.map(value => [value,true])) }); }

  private completeStory(story: Story): void {
    const evidence = this.state.evidenceText.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const satisfied = story.acceptanceCriteria.filter(criterion => this.state.selectedCriteria[criterion] || story.satisfiedCriteria.includes(criterion));
    if (!evidence.length || satisfied.length !== story.acceptanceCriteria.length) { this.setState({ notice: 'Completion requires concrete evidence and every acceptance criterion to be explicitly confirmed.' }); return; }
    vscode.postMessage({ type: 'SDLC_TRANSITION', storyId: story.id, status: 'completed', evidence, satisfiedCriteria: satisfied });
  }

  render(): JSX.Element {
    const intel = this.state.application.intelligence;
    return <div className="shell">
      <header className="topbar"><div className="brand"><span className="mark">K</span><div><strong>Keystone</strong><span>Deterministic engineering intelligence</span></div></div><div className="header-actions"><span className="surface-pill">{vscode.surface === 'browser' ? 'Browser View · shared state' : 'VS Code Webview'}</span><button onClick={() => vscode.postMessage({ type: 'OPEN_BROWSER_VIEW' })}>Open in Browser</button></div></header>
      <aside className="nav">{(['Home','Intelligence','Work','Activity'] as Nav[]).map(nav => <button key={nav} className={this.state.nav === nav ? 'active' : ''} onClick={() => this.navigate(nav)}><span className="nav-dot" />{nav}</button>)}</aside>
      <main><div className="notice"><span className="pulse" />{this.state.notice}</div>{this.state.nav === 'Home' ? this.home(intel) : this.state.nav === 'Intelligence' ? this.intelligence(intel) : this.state.nav === 'Work' ? this.work() : this.activity()}</main>
    </div>;
  }

  private home(intel?: IntelligenceSummary): JSX.Element {
    const plan = this.state.plan; const completed = plan?.stories.filter(story => story.status === 'completed').length ?? 0; const total = plan?.stories.length ?? 0;
    return <section><div className="page-title"><div><p className="eyebrow">ACTIVE WORKSPACE</p><h1>{this.state.application.workspace?.name ?? 'Keystone workspace'}</h1><p>One intelligence model, one SDLC state, and the same UI in VS Code and the browser.</p></div><div className="actions"><button className="primary" onClick={() => vscode.postMessage({ type: 'INDEX_REPO', force: true })}>Index / refresh</button><button onClick={() => this.navigate('Intelligence')}>Explore intelligence</button><button onClick={() => this.navigate('Work')}>Open work</button></div></div>
      <div className="metric-grid"><Metric label="Intelligence" value={this.state.application.status} detail={intel?.okf?.validated ? 'OKF validated' : 'Awaiting validated snapshot'} /><Metric label="Repository" value={`${intel?.fileCount ?? 0} files`} detail={`${intel?.languageCapabilities?.filter(item => (item.files ?? 0) > 0).length ?? 0} detected language frontends`} /><Metric label="Context" value={this.state.task ? `${this.state.task.tokenReduction ?? 0}% smaller` : 'Not prepared'} detail={this.state.task?.contextManifest ? `${this.state.task.contextManifest.usedTokens}/${this.state.task.contextManifest.delegationTokenBudget} delegation tokens` : 'Ingestion is never budget-limited'} /><Metric label="SDLC" value={total ? `${completed}/${total}` : 'No active plan'} detail={plan?.specificationStatus ?? 'Start from an intent'} /></div>
      <div className="two-column"><Panel title="Start from intent" subtitle="Keystone researches the actual repository before planning."><textarea value={this.state.intent} onChange={(event: React.FormEvent<HTMLTextAreaElement>) => this.field('intent', event.currentTarget.value)} placeholder="Describe the feature, defect, modernization, QA, security, or performance intent…" /><div className="actions"><button className="primary" disabled={!this.state.intent.trim()} onClick={() => vscode.postMessage({ type: 'ANALYZE_INTENT', text: this.state.intent.trim() })}>Research intent</button>{this.state.task?.researchStatus==='ready'&&<button onClick={()=>vscode.postMessage({type:'APPROVE_INTENT_RESEARCH',intentId:this.state.task!.intentId})}>Approve R&D</button>}{this.state.task?.researchStatus==='approved'&&<button onClick={() => vscode.postMessage({ type: 'CREATE_SDLC_PLAN', intent: this.state.task!.researchDocument.problemStatement })}>Create plan from R&D</button>}</div></Panel>
      <Panel title="Current evidence" subtitle="The active task is grounded in persisted repository intelligence."><EvidenceList items={(this.state.task?.evidence ?? []).slice(0, 8)} empty="Analyze an intent to see source-backed evidence." onOpen={(path,line)=>this.openSource(path,line)} /></Panel></div>
      {this.state.task && !plan && this.prePlanResearch(this.state.task)}
      <Panel title="ValueEdge feature" subtitle="Import a Feature, research it locally, approve the plan, then publish draft user and quality stories."><div className="inline-form"><input value={this.state.valueEdgeFeatureId} onChange={(event: React.FormEvent<HTMLInputElement>) => this.field('valueEdgeFeatureId', event.currentTarget.value)} placeholder="Feature ID" /><button onClick={() => vscode.postMessage({ type: 'CONFIGURE_VALUEEDGE' })}>Configure</button><button disabled={!this.state.valueEdgeFeatureId.trim()} onClick={() => vscode.postMessage({ type: 'IMPORT_VALUEEDGE_FEATURE', featureId: this.state.valueEdgeFeatureId.trim() })}>Import</button><button disabled={plan?.specificationStatus !== 'approved'} onClick={() => vscode.postMessage({ type: 'PUBLISH_VALUEEDGE_STORIES' })}>Publish approved stories</button></div></Panel>
    </section>;
  }

  private intelligence(intel?: IntelligenceSummary): JSX.Element {
    const okf = intel?.okf;
    return <section>
      <div className="page-title"><div><p className="eyebrow">INTELLIGENCE LAYER</p><h1>Visible, queryable engineering intelligence</h1><p>Canonical OKF is the knowledge contract. Graph, CPG and flow views are live projections of persisted intelligence—not demo counters.</p></div><button className="primary" onClick={() => vscode.postMessage({ type: 'INDEX_REPO', force: true })}>Refresh intelligence</button></div>
      <div className="metric-grid"><Metric label="OKF units" value={String(okf?.units ?? 0)} detail={`${okf?.active ?? 0} active · ${okf?.deleted ?? 0} lifecycle tombstones`} /><Metric label="Relationships" value={String(okf?.relationships ?? 0)} detail={`${okf?.graphEdges ?? 0} graph edges`} /><Metric label="Evidence" value={String(okf?.evidence ?? 0)} detail={`${okf?.observations ?? 0} observations`} /><Metric label="CPG bindings" value={String(okf?.cpgBindings ?? 0)} detail={okf?.validated ? 'linked to validated OKF' : 'awaiting promoted OKF'} /></div>
      <div className="subnav">{intelligenceViews.map(view => <button key={view} className={this.state.intelligenceView===view?'active':''} onClick={()=>this.openIntelligenceView(view)}>{view}</button>)}</div>
      {this.state.intelligenceView === 'Overview' ? this.intelligenceOverview(intel) : this.state.intelligenceView === 'Explorer' ? this.intelligenceExplorer() : this.state.intelligenceView === 'Graph' ? this.intelligenceGraph(false) : this.state.intelligenceView === 'CPG' ? this.intelligenceCpg() : this.state.intelligenceView === 'Flows' ? this.intelligenceGraph(true) : this.intelligenceQuery()}
    </section>;
  }

  private intelligenceOverview(intel?: IntelligenceSummary): JSX.Element {
    const okf=intel?.okf; const languages=intel?.languageCapabilities??[];
    return <div className="view-stack">
      <div className="two-column"><Panel title="OKF validation and projections" subtitle={okf?.profile ?? 'No promoted snapshot'}>{okf ? <ul className="fact-list"><li><b>Profile</b><span>{okf.version}</span></li><li><b>Extraction run</b><code>{okf.extractionRunId}</code></li><li><b>Validation</b><Status value={okf.validated ? 'passed' : 'failed'} /></li><li><b>Graph</b><span>{okf.graphNodes} nodes · {okf.graphEdges} edges</span></li><li><b>CPG bindings</b><span>{okf.cpgBindings}</span></li><li><b>Portable OKF</b><span>{okf.portableBundle?.validated ? 'validated' : 'not generated'}</span></li></ul> : <Empty text="Run repository indexing." />}</Panel><Panel title="Evidence provenance" subtitle="Source evidence from the promoted OKF snapshot.">{okf?.evidenceSamples?.length ? <div className="evidence-stack">{okf.evidenceSamples.slice(0, 14).map(item => <div key={item.id}><button className="link-button" onClick={()=>this.openSource(item.path)}>{item.path}</button><span>{item.method}</span><small>{new Date(item.observedAt).toLocaleString()}</small></div>)}</div> : <Empty text="No evidence loaded." />}</Panel></div>
      <Panel title="Language capability registry" subtitle="Every recognized text language receives deterministic discovery, structure, CPG, OKF and evidence; compiler/language-service providers deepen semantics when available."><div className="language-grid">{languages.map(language => <LanguageCard key={language.id} language={language} />)}</div></Panel>
    </div>;
  }

  private intelligenceExplorer(): JSX.Element {
    const result=this.state.explorer; const kinds=Object.keys(result?.kindCounts??{}).sort();
    return <Panel title="Knowledge Explorer" subtitle="Browse the canonical OKF units that drive query, graph, intent retrieval, context compression and SDLC evidence.">
      <div className="inline-form"><input className="grow" value={this.state.explorerQuery} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('explorerQuery',event.currentTarget.value)} placeholder="Symbol, API, service, test, file, configuration…"/><select value={this.state.explorerKind} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.setState({explorerKind:event.currentTarget.value})}><option value="all">All kinds</option>{kinds.map(kind=><option key={kind} value={kind}>{kind} ({result?.kindCounts[kind]??0})</option>)}</select><button className="primary" onClick={()=>this.loadExplorer()}>Search</button></div>
      {result && <p className="result-summary">{result.items.length} visible result(s) · {result.totalActive} active OKF units</p>}
      <div className="explorer-list">{result?.items.map(item=><ExplorerRow key={item.id} item={item} onOpen={(path,line)=>this.openSource(path,line)} onGraph={value=>this.showExplorerItemInGraph(value)}/>) ?? <Empty text="Open Explorer to load the promoted OKF snapshot."/>}</div>
    </Panel>;
  }

  private intelligenceGraph(flowOnly:boolean): JSX.Element {
    const result=this.state.graph; const selected=result?.nodes.find(node=>node.id===this.state.selectedGraphNodeId);
    const mode: IntelligenceGraphMode = flowOnly ? 'flows' : this.state.graphMode;
    const visibleEdges=(result?.edges??[]).filter(edge=>this.state.graphRelationshipKind==='all'||edge.kind===this.state.graphRelationshipKind);
    const connectedIds=new Set<string>([...(result?.seedIds??[])]);for(const edge of visibleEdges){connectedIds.add(edge.sourceId);connectedIds.add(edge.targetId);}
    const visibleNodes=(result?.nodes??[]).filter(node=>this.state.graphRelationshipKind==='all'||connectedIds.has(node.id));
    return <div className="view-stack">
      <Panel title={flowOnly?'Engineering Flow Explorer':'Knowledge Graph'} subtitle={flowOnly?'Call/data-flow relationships projected from OKF.':'Interactive view of the authoritative OKF relationship graph.'}>
        <div className="inline-form">{!flowOnly && <select value={this.state.graphMode} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.setState({graphMode:event.currentTarget.value as IntelligenceGraphMode})}>{graphModes.map(value=><option key={value} value={value}>{value}</option>)}</select>}<select value={this.state.graphRelationshipKind} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.setState({graphRelationshipKind:event.currentTarget.value})}><option value="all">All relationships</option>{(result?.relationshipKinds??[]).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select><input className="grow" value={this.state.graphQuery} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('graphQuery',event.currentTarget.value)} placeholder={flowOnly?'Checkout, login, payment, data entity…':'Focus by symbol, file, API or service…'}/><button className="primary" onClick={()=>this.loadGraph(mode,this.state.graphQuery)}>Load {flowOnly?'flows':'graph'}</button></div>
        {result?.warnings.map(value=><div className="callout warning" key={value}>{value}</div>)}
        <div className="graph-layout"><GraphCanvas nodes={visibleNodes as VisualGraphNode[]} edges={visibleEdges} selectedId={this.state.selectedGraphNodeId} onSelect={node=>this.setState({selectedGraphNodeId:node.id})} emptyText="Load a graph from the promoted OKF snapshot."/><GraphInspector node={selected} relationshipKinds={result?.relationshipKinds??[]} onOpen={(path,line)=>this.openSource(path,line)} onFocus={node=>this.loadGraph(mode,node.label,[node.id])} onExpand={node=>this.loadGraph(mode,this.state.graphQuery||node.label,[...new Set([...(result?.seedIds??[]),node.id])])}/></div>
        {result?.truncated && <small>Visualization is intentionally bounded for readability. The persisted OKF store remains complete; focus or expand a node/query to traverse a different neighborhood.</small>}
      </Panel>
    </div>;
  }

  private intelligenceCpg(): JSX.Element {
    const result=this.state.cpg; const selected=result?.nodes.find(node=>node.id===this.state.selectedCpgNodeId);
    return <Panel title="Code Property Graph Explorer" subtitle="Inspect persisted AST/EOG/CFG/DFG/CDG/call neighborhoods and their OKF bindings.">
      <div className="inline-form"><select className="grow" value={this.state.cpgPath} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.setState({cpgPath:event.currentTarget.value})}><option value="">Choose source file</option>{(result?.files??[]).map(file=><option key={file.sourcePath} value={file.sourcePath}>{file.sourcePath} · {file.nodeCount} nodes</option>)}</select><select value={this.state.cpgEdgeKind} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.setState({cpgEdgeKind:event.currentTarget.value})}><option value="all">All edges</option>{(result?.edgeKinds??[]).map(kind=><option key={kind} value={kind}>{kind}</option>)}</select><button className="primary" onClick={()=>this.loadCpg()}>Load CPG</button></div>
      {result?.sourcePath && <div className="capability-strip">{Object.entries(result.capabilities??{}).map(([name,enabled])=><span className={enabled?'enabled':''} key={name}>{name}: {enabled?'yes':'no'}</span>)}</div>}
      <div className="graph-layout"><GraphCanvas nodes={(result?.nodes??[]).map(node=>({id:node.id,label:node.label,kind:`${node.kind}:${node.syntaxKind}`,path:node.path,line:node.line}))} edges={result?.edges??[]} selectedId={this.state.selectedCpgNodeId} onSelect={node=>this.setState({selectedCpgNodeId:node.id})} emptyText="Index the repository, then choose a persisted CPG shard."/><div className="graph-inspector">{selected ? <div className="inspector-content"><p className="eyebrow">CPG NODE</p><h3>{selected.label}</h3><Status value={selected.kind}/><p>{selected.syntaxKind}</p><code>{selected.path}:{selected.line}</code>{selected.okfId && <small>OKF: {selected.okfId}</small>}<button onClick={()=>this.openSource(selected.path,selected.line)}>Open source</button><button onClick={()=>vscode.postMessage({type:'LOAD_CPG_VIEW',sourcePath:result?.sourcePath,edgeKind:this.state.cpgEdgeKind,focusNodeId:selected.id})}>Focus neighborhood</button></div> : <Empty text="Select a CPG node."/>}</div></div>
      {result?.truncated && <small>The visualization shows a connected neighborhood; shard counts above represent the complete persisted CPG for the file.</small>}
    </Panel>;
  }

  private intelligenceQuery(): JSX.Element {
    const result=this.state.queryResult;
    return <Panel title="Ask repository intelligence" subtitle="Keystone classifies the engineering question, resolves OKF seed units, traverses intent-specific relationships, ranks evidence and exposes the traversal.">
      <div className="query-examples">{['What calls PaymentService?','What tests are impacted by UserService?','Show checkout flow','Where is authentication implemented?'].map(value=><button key={value} onClick={()=>this.setState({query:value})}>{value}</button>)}</div>
      <div className="inline-form"><input className="grow" value={this.state.query} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('query',event.currentTarget.value)} placeholder="Ask about callers, dependencies, tests, impact, APIs, flows, risks or configuration…"/><button className="primary" disabled={!this.state.query.trim()} onClick={()=>vscode.postMessage({type:'QUERY_INTELLIGENCE',query:this.state.query.trim()})}>Query</button></div>
      {result && <div className="query-answer"><b>{result.answer}</b><small>{result.intent} · {Math.round(result.confidence*100)}% confidence · {result.traversedRelationships} traversed relationship(s)</small><div className="actions"><button disabled={!result.items.length} onClick={()=>this.showQueryInGraph()}>Show traversal in Graph</button>{result.intent==='flow' && <button disabled={!result.items.length} onClick={()=>this.showQueryInFlows()}>Show in Flows</button>}</div><details><summary>How Keystone planned this query</summary><p>{result.plan.strategy}</p><p><b>Terms:</b> {result.plan.terms.join(' · ')||'none'}</p><p><b>Seeds:</b> {result.plan.seedLabels.slice(0,8).join(' · ')||'none'}</p><p><b>Relationships:</b> {result.plan.relationshipKinds.join(' · ')||'none'} · max depth {result.plan.maxDepth}</p>{result.traversals.length>0&&<ol>{result.traversals.slice(0,20).map((step,index)=><li key={`${step.sourceId}-${step.targetId}-${index}`}><code>{step.sourceLabel}</code> —[{step.relationship}]→ <code>{step.targetLabel}</code></li>)}</ol>}</details>{result.warnings.map(value=><p key={value}>{value}</p>)}</div>}
      <EvidenceList items={this.state.queryItems} empty="Run a query to see evidence-backed results." onOpen={(path,line)=>this.openSource(path,line)} />
    </Panel>;
  }

  private openIntelligenceView(view:IntelligenceView):void { this.setState({intelligenceView:view});this.loadIntelligenceSurface(view); }
  private loadIntelligenceSurface(view:IntelligenceView):void { if(view==='Explorer')this.loadExplorer();else if(view==='Graph')this.loadGraph(this.state.graphMode,this.state.graphQuery);else if(view==='CPG')this.loadCpg();else if(view==='Flows')this.loadGraph('flows',this.state.graphQuery); }
  private loadExplorer():void { vscode.postMessage({type:'EXPLORE_INTELLIGENCE',query:this.state.explorerQuery.trim(),kind:this.state.explorerKind}); }
  private loadGraph(mode:IntelligenceGraphMode,query='',seedIds:string[]=[]):void { vscode.postMessage({type:'LOAD_INTELLIGENCE_GRAPH',mode,query:query.trim(),seedIds}); }
  private loadCpg():void { vscode.postMessage({type:'LOAD_CPG_VIEW',sourcePath:this.state.cpgPath||undefined,edgeKind:this.state.cpgEdgeKind}); }
  private showExplorerItemInGraph(item:IntelligenceExplorerItem):void { this.setState({intelligenceView:'Graph',graphMode:'repository',graphQuery:item.label,selectedGraphNodeId:item.id});this.loadGraph('repository',item.label,[item.id]); }
  private showQueryInGraph():void { const ids=(this.state.queryResult?.items.slice(0,8).map(item=>item.id).filter((id): id is string=>Boolean(id))??[]);this.setState({intelligenceView:'Graph',graphMode:this.state.queryResult?.intent==='impact'?'impact':'repository',graphQuery:this.state.query});this.loadGraph(this.state.queryResult?.intent==='impact'?'impact':'repository',this.state.query,ids); }
  private showQueryInFlows():void { const ids=(this.state.queryResult?.items.slice(0,8).map(item=>item.id).filter((id): id is string=>Boolean(id))??[]);this.setState({intelligenceView:'Flows',graphQuery:this.state.query});this.loadGraph('flows',this.state.query,ids); }
  private openSource(path:string,line?:number):void { vscode.postMessage({type:'OPEN_SOURCE_LOCATION',path,line}); }

  private work(): JSX.Element {
    const task=this.state.task;const plan=this.state.plan;const current=this.currentStory();
    if(!task)return <section><div className="page-title"><div><p className="eyebrow">INTENT-LED SDLC</p><h1>No active work</h1><p>Research an intent from Home. Keystone will not invent a plan before repository evidence exists.</p></div></div></section>;
    return <section>
      <div className="page-title"><div><p className="eyebrow">WORK</p><h1>{plan?.intent??(this.state.intent||'Active intent')}</h1><p>{task.reason}</p></div><div className="actions"><button onClick={()=>vscode.postMessage({type:'RUN_VALIDATION',scope:'impacted',storyId:current?.id})}>Run validation</button><button className="primary" disabled={!plan} onClick={()=>this.openHandoff()}>Task Handoff</button></div></div>
      <div className="metric-grid"><Metric label="Route" value={task.route??'pending'} detail={task.intentType??'intent'} /><Metric label="Context reduction" value={`${task.tokenReduction??0}%`} detail={`${task.contextTokens?.prompt??0} prompt tokens`} /><Metric label="QA coverage" value={`${task.relatedTests.length} tests`} detail={`${task.missingTests.length} gaps`} /><Metric label="Risk" value={`${task.securityRisk} / ${task.performanceRisk}`} detail="security / performance" /></div>
      {!plan && this.prePlanResearch(task)}
      {plan && this.researchAndSpecification(plan)}
      {plan && this.sdlcExecution(plan,current)}
      {this.taskEvidence(task)}
      {this.contextAndDelegation(task,current)}
      {task.prMarkdown && <Panel title="Read-only PR Review" subtitle="Reviewer-ready evidence only. Keystone never creates, updates, approves or merges the remote MR/PR."><div className="actions"><button onClick={()=>vscode.postMessage({type:'COPY_PR_MARKDOWN',markdown:task.prMarkdown})}>Copy PR review</button></div><pre>{task.prMarkdown}</pre></Panel>}
      <div id="handoff"><Panel title="Task Handoff" subtitle="Encrypted portable continuity attached to this active task. No credentials, token sharing, cloud session, or Git mutation."><label>Passphrase<input type="password" value={this.state.passphrase} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('passphrase',event.currentTarget.value)} placeholder="At least 12 characters"/></label><button className="primary" disabled={this.state.passphrase.length<12||!plan} onClick={()=>vscode.postMessage({type:'CREATE_TASK_HANDOFF',passphrase:this.state.passphrase})}>Create from active task</button><label>Encrypted package<textarea value={this.state.handoffText} onChange={(event:React.FormEvent<HTMLTextAreaElement>)=>this.field('handoffText',event.currentTarget.value)} placeholder="Paste a received package"/></label><label className="check"><input type="checkbox" checked={this.state.manualSyncConfirmed} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('manualSyncConfirmed',event.currentTarget.checked)}/><span>I manually synchronized the repository and verified the expected branch/revision.</span></label><button disabled={!this.state.manualSyncConfirmed||this.state.passphrase.length<12||!this.state.handoffText.trim()} onClick={()=>vscode.postMessage({type:'RESTORE_TASK_HANDOFF',packageText:this.state.handoffText.trim(),passphrase:this.state.passphrase,manualSyncConfirmed:true})}>Verify and restore</button></Panel></div>
    </section>;
  }

  private prePlanResearch(task:TaskResult):JSX.Element {
    const approved=task.researchStatus==='approved';
    const research=task.researchDocument;
    return <Panel title="Repository R&D · planning gate" subtitle="Research is a reviewable engineering artifact. Specification and story planning stay locked until you approve the repository evidence.">
      <div className="approval"><span>R&D status: <b>{task.researchStatus}</b> · {research.evidenceMatrix.length} curated evidence item(s) · {research.unknowns.length} open question(s)</span>{!approved?<button className="primary" onClick={()=>vscode.postMessage({type:'APPROVE_INTENT_RESEARCH',intentId:task.intentId})}>Approve R&D and unlock planning</button>:<button className="primary" onClick={()=>vscode.postMessage({type:'CREATE_SDLC_PLAN',intent:research.problemStatement})}>Create specification and stories</button>}</div>
      <ResearchDocumentView research={research} onOpen={(path)=>this.openSource(path)} />
    </Panel>;
  }

  private researchAndSpecification(plan:SdlcPlan):JSX.Element {
    const specificationStory=plan.stories.find(story=>story.type==='specification');
    const canApprove=specificationStory?.status==='ready'||specificationStory?.status==='in-progress';
    return <Panel title="Research → Specification → Backlog" subtitle="Implementation starts only after repository R&D and the generated specification have both been reviewed.">
      <div className="doc-grid"><ResearchDocumentView research={plan.researchDocument} onOpen={(path)=>this.openSource(path)} compact/><SpecificationDocumentView specification={plan.specificationDocument}/></div>
      <h3>Repository-specific user and quality stories</h3><div className="backlog-grid">{plan.backlogStories.map(story=><BacklogCard key={story.id} story={story}/>)}</div>
      {plan.specificationStatus!=='approved' && <div className="approval"><span>Specification status: <b>{plan.specificationStatus}</b>. Review requirements, architecture decisions, validation plan and open questions before proceeding. {!canApprove?'Complete the Research story first.':''}</span><button className="primary" disabled={!canApprove} onClick={()=>vscode.postMessage({type:'APPROVE_SPECIFICATION'})}>Approve specification</button></div>}
    </Panel>;
  }

  private sdlcExecution(plan:SdlcPlan,current:Story|undefined):JSX.Element {
    return <Panel title="SDLC execution" subtitle="Sixteen evidence-gated stages unlock through dependencies, explicit approval, delegation, validation and findings."><div className="sdlc-layout"><div className="story-list">{plan.stories.map(story=><button key={story.id} className={`story-row ${current?.id===story.id?'current':''}`} onClick={()=>this.selectStory(story)}><span className={`status-dot ${story.status}`}/><span><b>{story.title}</b><small>{story.type}</small></span><Status value={story.status}/></button>)}</div>{current ? <div className="story-detail"><div className="story-heading"><div><p className="eyebrow">SELECTED STORY</p><h2>{current.title}</h2><p>{current.objective}</p></div><Status value={current.status}/></div><h3>Acceptance criteria</h3><div className="criteria">{current.acceptanceCriteria.map(criterion=><label key={criterion}><input type="checkbox" checked={Boolean(this.state.selectedCriteria[criterion]||current.satisfiedCriteria.includes(criterion))} disabled={current.satisfiedCriteria.includes(criterion)} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.toggleCriterion(criterion,event.currentTarget.checked)}/><span>{criterion}</span></label>)}</div>
        {current.findings?.length ? <div className="finding-section"><h3>Findings</h3><div className="finding-list">{current.findings.map(finding=><article key={finding.id} className={`finding ${finding.severity}`}><div><b>{finding.kind}: {finding.summary}</b><Status value={`${finding.severity}-${finding.status}`}/></div>{finding.evidence.length>0&&<small>{finding.evidence.join(' · ')}</small>}{finding.status==='open'&&<div className="actions"><button onClick={()=>vscode.postMessage({type:'RESOLVE_SDLC_FINDING',storyId:current.id,findingId:finding.id,status:'resolved'})}>Mark resolved</button><button onClick={()=>vscode.postMessage({type:'RESOLVE_SDLC_FINDING',storyId:current.id,findingId:finding.id,status:'accepted'})}>Accept risk</button></div>}</article>)}</div></div>:null}
        {current.validationRuns?.length ? <details><summary>Validation history ({current.validationRuns.length})</summary>{current.validationRuns.map(run=><div className="validation-run" key={run.id}><Status value={run.status}/><code>{run.commands.join(' · ')}</code><small>{run.evidence.join(' · ')}</small></div>)}</details>:null}
        <h3>Completion evidence</h3><textarea value={this.state.evidenceText} onChange={(event:React.FormEvent<HTMLTextAreaElement>)=>this.field('evidenceText',event.currentTarget.value)} placeholder="One verifiable item per line: command output, file/range, review decision, benchmark, or evidence ID."/><div className="actions">{current.status==='ready'&&<button className="primary" onClick={()=>vscode.postMessage({type:'SDLC_TRANSITION',storyId:current.id,status:'in-progress'})}>Start story</button>}{current.status==='in-progress'&&<button onClick={()=>this.delegate(current)}>Prepare & approve Copilot delegation</button>}{['in-progress','delegated','awaiting-validation','review-required'].includes(current.status)&&<button onClick={()=>vscode.postMessage({type:'RUN_VALIDATION',scope:'impacted',storyId:current.id})}>Run actual validation</button>}{['awaiting-validation','review-required','in-progress'].includes(current.status)&&<button className="primary" onClick={()=>this.completeStory(current)}>Complete with evidence</button>}</div>{current.evidence.length>0&&<details><summary>{current.evidence.length} evidence item(s)</summary><ul>{current.evidence.map(item=><li key={item}>{item}</li>)}</ul></details>}</div> : <Empty text="Select an SDLC story."/>}</div></Panel>;
  }

  private taskEvidence(task:TaskResult):JSX.Element {
    const analysis=task.analysisEvidence;
    return <Panel title="Engineering evidence" subtitle="QA, security, performance, modernization and read-only Git evidence remain inspectable instead of becoming hidden status badges.">
      <div className="evidence-tabs-grid"><EvidenceGroup title="QA" status={`${task.relatedTests.length} tests · ${task.missingTests.length} gaps`} items={(analysis?.qa.gaps??[]).map(item=>({label:item.type,path:item.path,detail:item.reason}))} onOpen={(path)=>this.openSource(path)}/><EvidenceGroup title="Security" status={analysis?.security.riskLevel??task.securityRisk} items={[...(analysis?.security.findings??[]).map(item=>({label:`${item.severity}: ${item.title}`,path:item.path,line:item.line,detail:item.explanation})),...(analysis?.security.intelligenceSignals??[]).map(item=>({label:`OKF ${item.kind}: ${item.label}`,path:item.path,line:item.line,detail:item.summary}))]} onOpen={(path,line)=>this.openSource(path,line)}/><EvidenceGroup title="Performance" status={analysis?.performance.riskLevel??task.performanceRisk} items={[...(analysis?.performance.findings??[]).map(item=>({label:`${item.severity}: ${item.title}`,path:item.path,line:item.line,detail:item.explanation})),...(analysis?.performance.intelligenceSignals??[]).map(item=>({label:`OKF ${item.kind}: ${item.label}`,path:item.path,line:item.line,detail:item.summary}))]} onOpen={(path,line)=>this.openSource(path,line)}/><EvidenceGroup title="Modernization" status={`${analysis?.modernization.gaps.length??0} gap(s)`} items={(analysis?.modernization.gaps??[]).map(item=>({label:`${item.priority}: ${item.title}`,detail:item.evidence.join(' · ')}))}/></div>
      {analysis?.gitReview && <details><summary>Read-only Git review evidence</summary><ul className="fact-list"><li><b>Branch</b><span>{analysis.gitReview.branch??'unknown'}</span></li><li><b>Changed files</b><span>{analysis.gitReview.changedFiles.length}</span></li><li><b>Diff SHA-256</b><code>{analysis.gitReview.diffHash}</code></li><li><b>Diff bytes</b><span>{analysis.gitReview.diffBytes}</span></li></ul></details>}
      {task.testGeneration && <details><summary>Generated QA scenarios ({task.testGeneration.summary.totalScenarios})</summary><div className="backlog-grid">{task.testGeneration.scenarios.map(item=><article className="backlog quality-story" key={item.id}><div><span>{item.category}</span><Status value={item.priority}/></div><h3>{item.name}</h3><p>{item.description}</p></article>)}</div></details>}
    </Panel>;
  }

  private contextAndDelegation(task:TaskResult,current:Story|undefined):JSX.Element {
    return <div className="two-column"><Panel title="Context Engineering" subtitle="See exactly what survived compression, why it was selected, what was omitted and how much token budget it consumed."><div className="metric-grid compact"><Metric label="Raw" value={String(task.contextTokens?.raw??0)} detail="estimated tokens"/><Metric label="Selected" value={String(task.contextTokens?.selected??0)} detail="pre-prompt context"/><Metric label="Prompt" value={String(task.contextTokens?.prompt??0)} detail="delegated tokens"/><Metric label="Reduction" value={`${task.tokenReduction??0}%`} detail={task.contextTokens?.tier??'standard'}/></div><div className="context-sections">{(task.contextSections??[]).map(section=><article key={section.path}><div><button className="link-button" onClick={()=>this.openSource(section.path)}>{section.path}</button><span>{section.estimatedTokens} tokens</span></div><p>{section.reason}</p><pre>{section.preview}</pre>{section.evidence?.length ? <EvidenceList items={section.evidence} empty="" onOpen={(path,line)=>this.openSource(path,line)}/>:null}</article>)}</div>{task.omittedContext?.length ? <details><summary>Omitted context ({task.omittedContext.length})</summary>{task.omittedContext.map(item=><p key={item.path}><code>{item.path}</code> — {item.reason} ({item.estimatedTokens} tokens)</p>)}</details>:null}</Panel>
      <Panel title="Copilot delegation" subtitle="Keystone understands and prepares; Copilot generates. Repository agents, skills and instructions remain visible and user-approved."><label>Agent<select value={this.state.agent} onChange={(event:React.FormEvent<HTMLSelectElement>)=>this.field('agent',event.currentTarget.value)}><option value="GitHub Copilot">GitHub Copilot</option>{(task.copilotCustomizations?.agents??[]).map(agent=><option key={agent.id} value={agent.name}>{agent.name} · {agent.path}</option>)}</select></label><label>Skills<input value={this.state.skills} onChange={(event:React.FormEvent<HTMLInputElement>)=>this.field('skills',event.currentTarget.value)} placeholder={task.repoSkills?.map(skill=>skill.name).join(', ')||'Repository skills'}/></label>{Boolean(task.copilotCustomizations?.skills.length)&&<div className="actions"><button onClick={()=>this.useRepositorySkills(task)}>Use discovered skills</button>{task.copilotCustomizations!.skills.slice(0,6).map(skill=><button key={skill.id} onClick={()=>this.addRepositorySkill(skill.name)}>+ {skill.name}</button>)}</div>}<label>Instructions<textarea value={this.state.instructions} onChange={(event:React.FormEvent<HTMLTextAreaElement>)=>this.field('instructions',event.currentTarget.value)}/></label>{Boolean(task.copilotCustomizations?.instructions.length)&&<button onClick={()=>this.useRepositoryInstructions(task)}>Use repository instructions</button>}<details><summary>Delegation prompt</summary><pre>{task.copilotPrompt}</pre></details>{current&&<button className="primary" disabled={current.status!=='in-progress'} onClick={()=>this.delegate(current)}>Approve and delegate selected story</button>}{this.state.application.delegationResult&&<details open={Boolean(this.state.application.delegationResult.captured)}><summary>Latest Copilot result · {this.state.application.delegationResult.captured?'captured':'external'}</summary><p>{this.state.application.delegationResult.model?.name??this.state.application.delegationResult.mode}</p>{this.state.application.delegationResult.artifactPath&&<code>{this.state.application.delegationResult.artifactPath}</code>}{this.state.application.delegationResult.text&&<pre>{this.state.application.delegationResult.text}</pre>}</details>}</Panel></div>;
  }

  private useRepositorySkills(task:TaskResult):void { const names=(task.copilotCustomizations?.skills??task.repoSkills??[]).map(skill=>skill.name);this.setState({skills:[...new Set(names)].join(', '),notice:`Selected ${names.length} repository skill(s) for the next delegation.`}); }
  private addRepositorySkill(name:string):void { const current=this.state.skills.split(',').map(value=>value.trim()).filter(Boolean);this.setState({skills:[...new Set([...current,name])].join(', ')}); }
  private useRepositoryInstructions(task:TaskResult):void { const inventory=task.copilotCustomizations?.instructions??[];const lines=inventory.flatMap(item=>[`Repository instruction: ${item.path} — ${item.description}`,...item.guidance.map(value=>`- ${value}`)]);const base='Follow the approved specification and repository instructions. Use only the supplied evidence. Do not perform Git write operations.';this.setState({instructions:[base,...lines].join('\n'),notice:`Loaded ${inventory.length} repository instruction source(s) for review before delegation.`}); }
  private delegate(story:Story):void { const task=this.state.task;if(!task)return;const discovered=task.repoSkills?.map(skill=>skill.name)??[];const selectedSkills=this.state.skills.split(',').map(value=>value.trim()).filter(Boolean);vscode.postMessage({type:'APPROVE_DELEGATION',mode:'Copilot Chat',prompt:task.copilotPrompt,storyId:story.id,agent:this.state.agent.trim()||'GitHub Copilot',skills:selectedSkills.length?selectedSkills:discovered,instructions:this.state.instructions.split(/\r?\n/).map(value=>value.trim()).filter(Boolean),contextPackId:task.taskWorkspace?.id}); }
  private openHandoff():void { this.navigate('Work');setTimeout(()=>document.getElementById('handoff')?.scrollIntoView({behavior:'smooth'}),0); }

  private activity():JSX.Element { const activity=this.state.application.intelligenceActivity??[];const operations=this.state.application.operations??[];return <section><div className="page-title"><div><p className="eyebrow">ACTIVITY</p><h1>Visible, non-blocking operations</h1><p>Indexing, analysis, intelligence exploration, SDLC transitions, validation, delegation and handoff remain observable.</p></div></div><div className="two-column"><Panel title="Operations" subtitle="Long-running work reports progress without blocking the UI.">{operations.length?<div className="timeline">{operations.map(operation=><div key={operation.id}><span className={`status-dot ${operation.status}`}/><div><b>{operation.kind}</b><p>{operation.message}</p><div className="progress"><i style={{width:`${operation.progress}%`}}/></div></div><Status value={operation.status}/></div>)}</div>:<Empty text="No active operations."/>}</Panel><Panel title="Intelligence activity" subtitle="Persisted repository events.">{activity.length?<div className="timeline">{activity.slice().reverse().slice(0,60).map((event,index)=><div key={event.id??`${event.timestamp}-${index}`}><span className="status-dot completed"/><div><b>{event.type}</b><p>{event.message}</p><small>{new Date(event.timestamp).toLocaleString()}</small></div>{event.progress!==undefined&&<span>{event.progress}%</span>}</div>)}</div>:<Empty text="No activity yet."/>}</Panel></div></section>; }
}

function ResearchDocumentView({research,onOpen,compact=false}:{research:TaskResult['researchDocument'];onOpen?:(path:string)=>void;compact?:boolean}):JSX.Element {
  const evidence=research.evidenceMatrix.slice(0,compact?12:24);
  return <article className="engineering-document"><div className="document-header"><div><p className="eyebrow">REPOSITORY R&D</p><h3>{research.title}</h3><p>{research.problemStatement}</p></div><Status value={research.unknowns.length?'review-required':'evidence-backed'}/></div><div className="document-sections"><DocumentList title="Architecture impact" items={research.affectedArchitecture}/><DocumentList title="Behavior and data flows" items={research.affectedFlows}/><DocumentList title="Existing / missing test landscape" items={research.affectedTests}/><DocumentList title="Risks" items={research.risks}/><DocumentList title="Constraints" items={research.constraints}/><DocumentList title="Recommended approach" items={research.recommendedApproach??[]}/><DocumentList title="Testing strategy" items={research.testingStrategy??[]}/><DocumentList title="Open questions" items={research.unknowns}/></div><details open={!compact}><summary>Curated repository evidence ({research.evidenceMatrix.length})</summary><div className="evidence-stack">{evidence.map(item=><div key={item.id}><span className="kind">{item.kind}</span><b>{item.label}</b>{item.path&&(onOpen?<button className="link-button" onClick={()=>onOpen(item.path!)}>{item.path}</button>:<code>{item.path}</code>)}<small>{item.summary}</small>{item.confidence!==undefined&&<span>{Math.round(item.confidence*100)}%</span>}</div>)}</div>{research.evidenceMatrix.length>evidence.length&&<small>{research.evidenceMatrix.length-evidence.length} additional evidence item(s) remain available in Intelligence Explorer.</small>}</details><details><summary>Raw R&D Markdown</summary><pre className="document-view">{research.markdown}</pre></details></article>;
}
function SpecificationDocumentView({specification}:{specification:SdlcPlan['specificationDocument']}):JSX.Element {
  if(!specification)return <article className="engineering-document"><Empty text="Specification has not been generated yet."/></article>;
  return <article className="engineering-document"><div className="document-header"><div><p className="eyebrow">IMPLEMENTATION SPECIFICATION</p><h3>{specification.title}</h3><p>{specification.summary}</p></div></div><div className="document-sections"><DocumentList title="Functional requirements" items={specification.functionalRequirements}/><DocumentList title="Non-functional requirements" items={specification.nonFunctionalRequirements}/><DocumentList title="Architecture decisions" items={specification.architectureDecisions}/><DocumentList title="Affected interfaces" items={specification.affectedInterfaces}/><DocumentList title="Data / migration impact" items={specification.dataChanges}/><DocumentList title="Validation plan" items={specification.validationPlan}/><DocumentList title="Acceptance criteria" items={specification.acceptanceCriteria}/><DocumentList title="Open questions" items={specification.unknowns}/></div><details><summary>Raw specification Markdown</summary><pre className="document-view">{specification.markdown}</pre></details></article>;
}
function DocumentList({title,items}:{title:string;items:readonly string[]}):JSX.Element { return <section className="document-section"><h4>{title}</h4>{items.length?<ul>{items.slice(0,12).map((item,index)=><li key={`${title}-${index}-${item}`}>{item}</li>)}</ul>:<small>No material item identified.</small>}</section>; }

function navFromHash():Nav { const value=location.hash.replace('#','');return(['Home','Intelligence','Work','Activity'] as Nav[]).includes(value as Nav)?value as Nav:'Home'; }
function Panel(props:{title:string;subtitle?:string;children:React.ReactNode}):JSX.Element { return <section className="panel"><div className="panel-title"><div><h2>{props.title}</h2>{props.subtitle&&<p>{props.subtitle}</p>}</div></div>{props.children}</section>; }
function Metric(props:{label:string;value:string;detail:string}):JSX.Element { return <div className="metric"><span>{props.label}</span><strong>{props.value}</strong><small>{props.detail}</small></div>; }
function Status({value}:{value:string}):JSX.Element { return <span className={`status ${value.replace(/[^a-z0-9]+/gi,'-').toLowerCase()}`}>{value}</span>; }
function Empty({text}:{text:string}):JSX.Element { return <div className="empty">{text}</div>; }
function EvidenceList({items,empty,onOpen}:{items:EvidenceItem[];empty:string;onOpen?:(path:string,line?:number)=>void}):JSX.Element { return items.length?<div className="evidence-stack">{items.map((item,index)=><div key={item.id??item.okfId??`${item.kind}-${index}`}><span className="kind">{item.kind}</span><b>{item.label}</b>{item.path&&(onOpen?<button className="link-button" onClick={()=>onOpen(item.path!,item.line)}>{item.path}</button>:<code>{item.path}</code>)}{item.summary&&<small>{item.summary}</small>}{item.reason&&<small>{item.reason}</small>}{item.relationshipPath?.length?<small>{item.relationshipPath.slice(-3).join(' → ')}</small>:null}{item.confidence!==undefined&&<span>{Math.round(item.confidence*100)}%</span>}</div>)}</div>:<Empty text={empty}/>; }
function LanguageCard({language}:{language:LanguageCapability}):JSX.Element { const active=(language.files??0)>0;return <article className={active?'language active-language':'language'}><div><b>{language.label}</b><Status value={language.baseline??language.level}/></div><p>{language.semanticProvider==='none'?'Deterministic structural frontend':language.semanticProvider}</p><small>{language.files??0} file(s) · {(language.extensions??[]).slice(0,5).join(' ')||'universal text'}</small>{language.warnings?.length?<span className="language-warning">{language.warnings[0]}</span>:null}</article>; }
function BacklogCard({story}:{story:BacklogStory}):JSX.Element { return <article className={`backlog ${story.kind}`}><div><span>{story.kind}</span><Status value={story.status}/></div><h3>{story.title}</h3><p>{story.description}</p><ul>{story.acceptanceCriteria.slice(0,5).map(value=><li key={value}>{value}</li>)}</ul><details><summary>Scope and evidence</summary><p><b>Files:</b> {story.scope?.files?.join(', ')||'resolved during implementation'}</p><p><b>Interfaces:</b> {story.scope?.interfaces?.join(', ')||'none identified'}</p><p><b>Evidence:</b> {story.evidence.join(' · ')}</p></details></article>; }
function ExplorerRow({item,onOpen,onGraph}:{item:IntelligenceExplorerItem;onOpen:(path:string,line?:number)=>void;onGraph:(item:IntelligenceExplorerItem)=>void}):JSX.Element { return <article className="explorer-row"><div><span className="kind">{item.kind}</span><b>{item.label}</b><Status value={`${Math.round(item.confidence*100)}%`}/></div>{item.description&&<p>{item.description}</p>}{item.path&&<button className="link-button" onClick={()=>onOpen(item.path!,item.line)}>{item.path}{item.line?`:${item.line}`:''}</button>}<small>{item.incoming} incoming · {item.outgoing} outgoing · {item.evidenceIds.length} evidence link(s)</small><button onClick={()=>onGraph(item)}>Show neighborhood</button></article>; }
function GraphInspector({node,relationshipKinds,onOpen,onFocus,onExpand}:{node:IntelligenceGraphNode|undefined;relationshipKinds:readonly string[];onOpen:(path:string,line?:number)=>void;onFocus:(node:IntelligenceGraphNode)=>void;onExpand:(node:IntelligenceGraphNode)=>void}):JSX.Element { return <div className="graph-inspector">{node?<div className="inspector-content"><p className="eyebrow">SELECTED NODE</p><h3>{node.label}</h3><Status value={node.kind}/><p>{Math.round(node.confidence*100)}% confidence · {node.evidenceIds.length} evidence link(s)</p>{node.path&&<button className="link-button" onClick={()=>onOpen(node.path!,node.line)}>{node.path}{node.line?`:${node.line}`:''}</button>}<div className="actions"><button onClick={()=>onFocus(node)}>Focus neighborhood</button><button onClick={()=>onExpand(node)}>Expand neighborhood</button></div><details><summary>Visible relationship kinds</summary><p>{relationshipKinds.join(' · ')||'none'}</p></details></div>:<Empty text="Select a graph node."/>}</div>; }
function EvidenceGroup({title,status,items,onOpen}:{title:string;status:string;items:Array<{label:string;path?:string;line?:number;detail?:string}>;onOpen?:(path:string,line?:number)=>void}):JSX.Element { return <section className="evidence-group"><div><h3>{title}</h3><Status value={status}/></div>{items.length?items.slice(0,30).map((item,index)=><article key={`${item.label}-${index}`}><b>{item.label}</b>{item.path&&(onOpen?<button className="link-button" onClick={()=>onOpen(item.path!,item.line)}>{item.path}{item.line?`:${item.line}`:''}</button>:<code>{item.path}</code>)}{item.detail&&<small>{item.detail}</small>}</article>):<Empty text={`No ${title.toLowerCase()} finding for the selected task context.`}/>}</section>; }
