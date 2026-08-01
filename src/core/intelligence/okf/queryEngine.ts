import type { KeystoneKnowledgeRelationship, KeystoneKnowledgeUnit, KeystoneOkfSnapshot, OkfEvidence } from './types';

export type OkfQueryIntent =
  | 'definition' | 'callers' | 'callees' | 'dependencies' | 'dependents' | 'tests'
  | 'impact' | 'api' | 'flow' | 'security' | 'performance' | 'configuration'
  | 'documentation' | 'generic';

export interface OkfQueryItem {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly path?: string;
  readonly summary: string;
  readonly reason: string;
  readonly score: number;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly relationshipPath: readonly string[];
}

export interface OkfQueryResult {
  readonly query: string;
  readonly intent: OkfQueryIntent;
  readonly answer: string;
  readonly confidence: number;
  readonly items: readonly OkfQueryItem[];
  readonly traversedRelationships: number;
  readonly warnings: readonly string[];
}

const STOP = new Set(['a','an','and','are','as','at','be','by','can','change','does','for','from','how','i','if','in','is','it','me','of','on','or','show','that','the','this','to','what','when','where','which','who','with','would']);
const FILE_LIKE = new Set(['file','test','documentation','configuration']);

export function queryOkfSnapshot(snapshot: KeystoneOkfSnapshot, query: string, limit = 50): OkfQueryResult {
  const normalized = query.trim();
  if (!normalized) return { query, intent: 'generic', answer: 'Enter a repository intelligence question.', confidence: 0, items: [], traversedRelationships: 0, warnings: [] };
  const intent = classify(normalized);
  const terms = tokenize(normalized);
  const activeUnits = snapshot.units.filter(unit => unit.lifecycle === 'active');
  const activeRelationships = snapshot.relationships.filter(rel => rel.lifecycle === 'active');
  const byId = new Map(activeUnits.map(unit => [unit.id, unit]));
  const evidenceById = new Map(snapshot.evidence.map(item => [item.id, item]));
  const seedScores = new Map<string, number>();

  for (const unit of activeUnits) {
    const score = unitScore(unit, normalized, terms, intent);
    if (score > 0) seedScores.set(unit.id, score);
  }

  const seeds = [...seedScores.entries()].sort((a,b) => b[1]-a[1] || a[0].localeCompare(b[0])).slice(0, 24).map(([id]) => id);
  const candidates = new Map<string, { score:number; reasons:Set<string>; path:string[] }>();
  const add = (id:string, score:number, reason:string, relPath:string[] = []) => {
    if (!byId.has(id)) return;
    const current = candidates.get(id) ?? { score:0, reasons:new Set<string>(), path:[] };
    current.score = Math.max(current.score, score);
    current.reasons.add(reason);
    if (!current.path.length || (relPath.length && relPath.length < current.path.length)) current.path = relPath;
    candidates.set(id,current);
  };

  for (const seed of seeds) add(seed, seedScores.get(seed) ?? 0, 'direct OKF evidence match');

  let traversed = 0;
  const outgoing = new Map<string, KeystoneKnowledgeRelationship[]>();
  const incoming = new Map<string, KeystoneKnowledgeRelationship[]>();
  for (const rel of activeRelationships) {
    const out = outgoing.get(rel.sourceId) ?? []; out.push(rel); outgoing.set(rel.sourceId,out);
    const inc = incoming.get(rel.targetId) ?? []; inc.push(rel); incoming.set(rel.targetId,inc);
  }

  const follow = (from:string, rel:KeystoneKnowledgeRelationship, next:string, score:number, reason:string, pathPrefix:string[]) => {
    traversed += 1;
    add(next, score, reason, [...pathPrefix, `${label(byId.get(from))} -[${rel.kind}]-> ${label(byId.get(next))}`]);
  };

  for (const seed of seeds.slice(0, 10)) {
    const seedScore = seedScores.get(seed) ?? 1;
    const out = outgoing.get(seed) ?? [];
    const inc = incoming.get(seed) ?? [];
    const seedUnit = byId.get(seed)!;

    if (intent === 'callers') {
      for (const rel of inc.filter(rel => rel.kind === 'calls')) follow(seed, rel, rel.sourceId, seedScore + 4, 'caller via OKF calls relationship', []);
    } else if (intent === 'callees') {
      for (const rel of out.filter(rel => rel.kind === 'calls')) follow(seed, rel, rel.targetId, seedScore + 4, 'callee via OKF calls relationship', []);
    } else if (intent === 'dependencies') {
      for (const rel of out.filter(rel => ['imports','depends-on','configured-by'].includes(rel.kind))) follow(seed, rel, rel.targetId, seedScore + 3, `dependency via ${rel.kind}`, []);
    } else if (intent === 'dependents') {
      for (const rel of inc.filter(rel => ['imports','depends-on','configured-by'].includes(rel.kind))) follow(seed, rel, rel.sourceId, seedScore + 3, `dependent via ${rel.kind}`, []);
    } else if (intent === 'tests') {
      for (const rel of inc.filter(rel => rel.kind === 'tests' || rel.kind === 'covers')) follow(seed, rel, rel.sourceId, seedScore + 5, `test evidence via ${rel.kind}`, []);
      if (seedUnit.kind === 'test') for (const rel of out.filter(rel => rel.kind === 'tests' || rel.kind === 'covers')) follow(seed, rel, rel.targetId, seedScore + 3, `tested target via ${rel.kind}`, []);
    } else if (intent === 'impact') {
      traverseImpact(seed, seedScore, 3, byId, incoming, outgoing, follow);
    } else if (intent === 'flow') {
      for (const rel of [...out,...inc].filter(rel => rel.kind === 'flows-to' || rel.kind === 'calls' || rel.kind === 'defines')) {
        const next = rel.sourceId === seed ? rel.targetId : rel.sourceId;
        follow(seed, rel, next, seedScore + 2.5, `flow evidence via ${rel.kind}`, []);
      }
    } else {
      for (const rel of [...out,...inc].filter(rel => ['defines','contains','imports','depends-on','calls','tests','covers','exposes','configured-by','flows-to','may-impact'].includes(rel.kind)).slice(0, 40)) {
        const next = rel.sourceId === seed ? rel.targetId : rel.sourceId;
        follow(seed, rel, next, seedScore + 1.2, `related via ${rel.kind}`, []);
      }
    }
  }

  // Intent-specific global evidence should be discoverable even when the user asks a broad question.
  if (intent === 'security' || intent === 'performance') {
    const category = intent;
    for (const unit of activeUnits.filter(unit => unit.kind === 'risk-area' && String(unit.properties.category ?? '').toLowerCase() === category)) {
      add(unit.id, 8, `${category} risk-area evidence`);
      for (const rel of outgoing.get(unit.id) ?? []) if (rel.kind === 'may-impact') follow(unit.id, rel, rel.targetId, 7, `${category} impact evidence`, []);
    }
  }
  if (intent === 'api') for (const unit of activeUnits.filter(unit => unit.kind === 'api')) if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2) add(unit.id, 6, 'API contract evidence');
  if (intent === 'configuration') for (const unit of activeUnits.filter(unit => unit.kind === 'configuration')) if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2) add(unit.id, 6, 'configuration evidence');
  if (intent === 'documentation') for (const unit of activeUnits.filter(unit => unit.kind === 'documentation')) if (unitScore(unit, normalized, terms, intent) > 0 || terms.length <= 2) add(unit.id, 6, 'documentation evidence');

  const ranked = [...candidates.entries()]
    .map(([id,value]) => ({ unit:byId.get(id)!, ...value }))
    .filter(item => resultAllowed(intent,item.unit))
    .sort((a,b) => b.score-a.score || b.unit.confidence.score-a.unit.confidence.score || a.unit.canonicalKey.localeCompare(b.unit.canonicalKey))
    .slice(0, Math.max(1,Math.min(limit,100)));

  const items = ranked.map(item => toItem(item.unit,item.score,[...item.reasons],item.path,evidenceById));
  const confidence = items.length ? Math.min(1, items.slice(0,5).reduce((sum,item)=>sum+item.confidence,0)/Math.min(items.length,5)) : 0;
  return { query, intent, answer: summarize(intent,items), confidence, items, traversedRelationships: traversed, warnings: items.length ? [] : ['No evidence-backed OKF result matched the question. Try a symbol, file, API route, service, test, or configuration name.'] };
}

function traverseImpact(
  seed:string, base:number, maxDepth:number, byId:Map<string,KeystoneKnowledgeUnit>, incoming:Map<string,KeystoneKnowledgeRelationship[]>, outgoing:Map<string,KeystoneKnowledgeRelationship[]>,
  follow:(from:string,rel:KeystoneKnowledgeRelationship,next:string,score:number,reason:string,pathPrefix:string[])=>void,
):void {
  const queue:Array<{id:string;depth:number;path:string[]}>=[{id:seed,depth:0,path:[]}]; const seen=new Set<string>([seed]);
  while(queue.length){const current=queue.shift()!;if(current.depth>=maxDepth)continue;
    const inbound=(incoming.get(current.id)??[]).filter(rel=>['imports','depends-on','calls','tests','covers','may-impact'].includes(rel.kind));
    for(const rel of inbound){const next=rel.sourceId;if(seen.has(next)||!byId.has(next))continue;seen.add(next);const score=base+Math.max(0.5,4-current.depth);follow(current.id,rel,next,score,`reverse impact via ${rel.kind}`,current.path);queue.push({id:next,depth:current.depth+1,path:[...current.path,`${label(byId.get(next))} -> ${label(byId.get(current.id))} (${rel.kind})`]});}
    // A changed file also impacts symbols/flows it defines, which then fan out to callers.
    for(const rel of (outgoing.get(current.id)??[]).filter(rel=>rel.kind==='defines'||rel.kind==='exposes')){const next=rel.targetId;if(seen.has(next)||!byId.has(next))continue;seen.add(next);follow(current.id,rel,next,base+2,`defined surface via ${rel.kind}`,current.path);queue.push({id:next,depth:current.depth+1,path:[...current.path,`${label(byId.get(current.id))} -> ${label(byId.get(next))} (${rel.kind})`]});}
  }
}

function classify(query:string):OkfQueryIntent {
  const q=query.toLowerCase();
  if(/\b(who|what|which)\s+calls?\b|\bcallers?\b/.test(q))return'callers';
  if(/\b(what|which)\s+(does|do)\b.*\bcall\b|\bcallees?\b/.test(q))return'callees';
  if(/\btests?\b|\bcoverage\b|\bcovered by\b/.test(q))return'tests';
  if(/\bimpact|impacted|affected|break|change.*affect|dependents?\b/.test(q))return'impact';
  if(/\bdependencies|depends on|imports?\b/.test(q))return'dependencies';
  if(/\bused by|referenced by|dependent on|depend on this\b/.test(q))return'dependents';
  if(/\bapi|endpoint|route\b/.test(q))return'api';
  if(/\bflow|data flow|call flow|path through\b/.test(q))return'flow';
  if(/\bsecurity|secret|auth|authorization|vulnerab|injection|xss\b/.test(q))return'security';
  if(/\bperformance|slow|latency|hot path|n\+1|blocking|benchmark\b/.test(q))return'performance';
  if(/\bconfig|configuration|setting|environment\b/.test(q))return'configuration';
  if(/\bdoc|documentation|readme|design\b/.test(q))return'documentation';
  if(/\bwhere|defined|definition|implemented|implements?\b/.test(q))return'definition';
  return'generic';
}

function resultAllowed(intent:OkfQueryIntent,unit:KeystoneKnowledgeUnit):boolean {
  if(intent==='tests')return unit.kind==='test'||FILE_LIKE.has(unit.kind);
  if(intent==='api')return unit.kind==='api'||unit.kind==='service'||FILE_LIKE.has(unit.kind);
  if(intent==='flow')return ['call-flow','data-flow','symbol','api','service','file','test'].includes(unit.kind);
  if(intent==='security'||intent==='performance')return unit.kind==='risk-area'||FILE_LIKE.has(unit.kind)||unit.kind==='symbol'||unit.kind==='service'||unit.kind==='api';
  if(intent==='configuration')return unit.kind==='configuration'||unit.kind==='file'||unit.kind==='symbol'||unit.kind==='service';
  if(intent==='documentation')return unit.kind==='documentation'||unit.kind==='file'||unit.kind==='module'||unit.kind==='service';
  return true;
}

function unitScore(unit:KeystoneKnowledgeUnit,query:string,terms:readonly string[],intent:OkfQueryIntent):number {
  const path=unitPath(unit)??''; const hay=`${unit.kind} ${unit.name} ${unit.description??''} ${unit.canonicalKey} ${path} ${JSON.stringify(unit.properties)}`.toLowerCase(); const q=query.toLowerCase();
  let score=0;if(hay.includes(q))score+=8;if(unit.name.toLowerCase()===q||unit.canonicalKey.toLowerCase()===q||path.toLowerCase()===q)score+=12;
  for(const term of terms){if(unit.name.toLowerCase().includes(term))score+=3;if(path.toLowerCase().includes(term))score+=2.5;if(unit.canonicalKey.toLowerCase().includes(term))score+=2;if(hay.includes(term))score+=0.6;}
  if(intent==='api'&&unit.kind==='api')score+=2;if(intent==='tests'&&unit.kind==='test')score+=2;if(intent==='definition'&&['symbol','file','service','api'].includes(unit.kind))score+=1.5;if(intent==='security'&&unit.kind==='risk-area'&&unit.properties.category==='security')score+=4;if(intent==='performance'&&unit.kind==='risk-area'&&unit.properties.category==='performance')score+=4;
  return score;
}

function tokenize(value:string):string[]{return[...new Set(value.toLowerCase().match(/[a-z0-9_./:-]+/g)??[])].filter(term=>term.length>1&&!STOP.has(term));}
function unitPath(unit:KeystoneKnowledgeUnit):string|undefined{const value=unit.properties.path??unit.properties.filePath;return typeof value==='string'?value:undefined;}
function label(unit:KeystoneKnowledgeUnit|undefined):string{return unit?`${unit.kind}:${unit.name}`:'unknown';}
function toItem(unit:KeystoneKnowledgeUnit,score:number,reasons:string[],relationshipPath:string[],evidenceById:Map<string,OkfEvidence>):OkfQueryItem{
  const path=unitPath(unit);const evidenceIds=unit.provenance.evidenceIds.filter(id=>evidenceById.has(id));const evidence=evidenceIds.map(id=>evidenceById.get(id)!).filter(Boolean);const freshness=evidence.length?evidence.filter(item=>item.freshness==='current').length/evidence.length:0.7;const confidence=Math.max(0,Math.min(1,unit.confidence.score*0.8+freshness*0.2));const details=[unit.description,typeof unit.properties.summary==='string'?unit.properties.summary:undefined,path?`path=${path}`:undefined,relationshipPath.at(-1)].filter(Boolean).join(' · ');
  return{id:unit.id,label:unit.name,kind:unit.kind,path,summary:details.slice(0,500),reason:reasons.join('; '),score,confidence,evidenceIds,relationshipPath};
}
function summarize(intent:OkfQueryIntent,items:readonly OkfQueryItem[]):string{if(!items.length)return'No evidence-backed result was found in the promoted OKF snapshot.';const lead=items.slice(0,5).map(item=>item.path??`${item.kind}:${item.label}`).join(', ');const prefix:string = intent==='tests'?'Mapped test evidence':intent==='impact'?'Likely impacted repository evidence':intent==='callers'?'Caller evidence':intent==='callees'?'Callee evidence':intent==='dependencies'?'Dependency evidence':intent==='dependents'?'Dependent evidence':intent==='api'?'API evidence':intent==='flow'?'Flow evidence':intent==='security'?'Security evidence':intent==='performance'?'Performance evidence':intent==='configuration'?'Configuration evidence':intent==='documentation'?'Documentation evidence':'Repository evidence';return`${prefix}: ${lead}${items.length>5?` and ${items.length-5} more`:''}.`;}
