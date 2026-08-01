import { createHash } from 'node:crypto';
import type { EvidenceMetadata, RepoIntelligence } from '../../domain/types';
import type { RepositoryGraphAnalysis } from './derivedGraph';
import type { RepositoryEvolution } from './evolution';
import type { DeadCodeCandidate } from './deadCode';

export type FindingCategory = 'architecture' | 'dependency' | 'security' | 'performance' | 'modernization' | 'quality';
export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface IntelligenceFinding {
  readonly id: string;
  readonly category: FindingCategory;
  readonly severity: FindingSeverity;
  readonly confidence: number;
  readonly title: string;
  readonly description: string;
  readonly filePath?: string;
  readonly evidence: readonly string[];
  readonly evidenceMetadata: readonly EvidenceMetadata[];
  readonly provenance: string;
  readonly remediation: string;
  readonly lifecycle: 'active';
}

export function buildIntelligenceFindings(intelligence: RepoIntelligence, graph: RepositoryGraphAnalysis, evolution?: RepositoryEvolution, deadCode: readonly DeadCodeCandidate[] = []): IntelligenceFinding[] {
  const findings: IntelligenceFinding[] = [];
  for (const cycle of graph.cycles) findings.push(finding('architecture', 'medium', 0.95, 'Dependency cycle', cycle.join(' → '), cycle[0], cycle, 'Break the cycle by extracting an interface or reversing the dependency.', cycleEvidence(graph.localEdges, cycle)));
  for (const file of graph.orphanSourceFiles) findings.push(finding('quality', 'low', 0.6, 'Disconnected source file', `${file} has no resolved local dependency edges.`, file, [file], 'Confirm it is an entry point, dynamically loaded, or safe to remove.', fileEvidence(intelligence, file)));
  const paths = new Set(intelligence.files.map(file => file.path));
  for (const edge of intelligence.dependencies.filter(edge => edge.kind === 'local' && !paths.has(edge.to))) findings.push(finding('dependency', 'low', 0.8, 'Unresolved local import', `${edge.from} imports ${edge.to}, which is not an indexed file.`, edge.from, [`${edge.from} → ${edge.to}`], 'Correct the import, configure its path alias, or mark the target as generated/external.', edge.evidence ? [edge.evidence] : []));
  addSignals(findings, intelligence.securitySensitiveAreas, 'security', 'medium', 0.55, 'Security-sensitive code', 'Review authentication, authorization, secret handling, and input trust boundaries.');
  addSignals(findings, intelligence.performanceSensitivePaths, 'performance', 'low', 0.5, 'Performance-sensitive code', 'Validate complexity and measure the path with a representative benchmark.');
  addSignals(findings, intelligence.modernizationCandidates, 'modernization', 'low', 0.65, 'Modernization candidate', 'Confirm behavior and migrate incrementally with regression coverage.');
  for (const pair of evolution?.coupling.filter(item => item.commits >= 3 && item.strength >= 0.5).slice(0, 100) ?? []) findings.push(finding('architecture', 'info', Math.min(0.95, 0.5 + pair.strength / 2), 'Historical co-change coupling', `${pair.fileA} and ${pair.fileB} changed together in ${pair.commits} commits.`, pair.fileA, [`strength:${pair.strength.toFixed(3)}`, `${pair.fileA} ↔ ${pair.fileB}`], 'Review both files together when either side changes.', [pipelineEvidence('git', Math.min(0.95, 0.5 + pair.strength / 2), pair.fileA)]));
  for (const candidate of deadCode) findings.push(finding('quality', 'low', candidate.confidence, 'Possible dead code', `${candidate.name} has no incoming semantic evidence.`, candidate.filePath, [`${candidate.filePath}:${candidate.line}`, ...candidate.reasons], 'Confirm reflective or framework usage before removing this symbol.', [pipelineEvidence('heuristic', candidate.confidence, candidate.filePath, candidate.line, ['Dead-code detection depends on static semantic evidence and can miss reflection/framework usage.'])]));
  return [...new Map(findings.map(item => [item.id, item])).values()].sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.id.localeCompare(b.id));
}

function addSignals(target: IntelligenceFinding[], signals: readonly string[], category: FindingCategory, severity: FindingSeverity, confidence: number, title: string, remediation: string): void {
  const grouped = new Map<string, string[]>();
  for (const signal of signals) {
    const split = signal.indexOf(': ');
    const filePath = split > 0 ? signal.slice(0, split) : 'workspace';
    const values = grouped.get(filePath) ?? [];
    values.push(signal);
    grouped.set(filePath, values);
  }
  for (const [filePath, evidence] of grouped) target.push(finding(category, severity, confidence, title, `${filePath} has ${evidence.length} ${category} signal(s).`, filePath === 'workspace' ? undefined : filePath, evidence, remediation, [pipelineEvidence('heuristic', confidence, filePath === 'workspace' ? undefined : filePath, undefined, [`${category} signals are keyword/path based.`])]));
}

function finding(category: FindingCategory, severity: FindingSeverity, confidence: number, title: string, description: string, filePath: string | undefined, evidence: readonly string[], remediation: string, evidenceMetadata: readonly EvidenceMetadata[] = []): IntelligenceFinding {
  return { id: createHash('sha256').update([category, title, filePath ?? '', description].join('|')).digest('hex').slice(0, 24), category, severity, confidence, title, description, filePath, evidence, evidenceMetadata, provenance: 'repository-intelligence', remediation, lifecycle: 'active' };
}

function severityRank(severity: FindingSeverity): number {
  return ({ info: 0, low: 1, medium: 2, high: 3, critical: 4 })[severity];
}

function cycleEvidence(edges: RepositoryGraphAnalysis['localEdges'], cycle: readonly string[]): EvidenceMetadata[] {
  const members = new Set(cycle);
  return edges.filter(edge => members.has(edge.from) && members.has(edge.to)).flatMap(edge => edge.evidence ? [edge.evidence] : []);
}

function fileEvidence(intelligence: RepoIntelligence, filePath: string): EvidenceMetadata[] {
  const file = intelligence.files.find(item => item.path === filePath);
  return file?.evidence ? [file.evidence] : [];
}

function pipelineEvidence(source: EvidenceMetadata['source'], confidence: number, evidencePath?: string, evidenceLine?: number, warnings?: string[]): EvidenceMetadata {
  return { source, confidence, evidencePath, evidenceLine, extractorVersion: 'intelligence-findings:v1', warnings };
}
