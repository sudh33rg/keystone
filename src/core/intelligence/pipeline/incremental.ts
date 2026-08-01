import type { RepoFile, RepoIntelligence } from '../../domain/types';

export type FileChangeKind = 'unchanged' | 'implementation' | 'structural' | 'added' | 'deleted';
export type IngestionUpdateAction = 'skip' | 'file-local' | 'graph' | 'architecture' | 'full';

export interface FileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
}

export interface IncrementalUpdatePlan {
  readonly action: IngestionUpdateAction;
  readonly changes: readonly FileChange[];
  readonly filesToAnalyze: readonly string[];
  readonly rerunGraph: boolean;
  readonly rerunArchitecture: boolean;
  readonly reason: string;
}

export function planIncrementalUpdate(
  previous: RepoIntelligence | undefined,
  current: RepoIntelligence
): IncrementalUpdatePlan {
  if (!previous?.files.length) {
    return plan('full', current.files.map(file => ({ path: file.path, kind: 'added' })), 'No previous fingerprint store is available.');
  }
  const oldFiles = new Map(previous.files.map(file => [file.path, file]));
  const newFiles = new Map(current.files.map(file => [file.path, file]));
  const changes: FileChange[] = [];
  for (const file of current.files) {
    const old = oldFiles.get(file.path);
    if (!old) changes.push({ path: file.path, kind: 'added' });
    else changes.push({ path: file.path, kind: classifyFile(old, file) });
  }
  for (const file of previous.files) if (!newFiles.has(file.path)) changes.push({ path: file.path, kind: 'deleted' });
  changes.sort((a, b) => a.path.localeCompare(b.path));
  const meaningful = changes.filter(change => change.kind !== 'unchanged');
  const structural = meaningful.filter(change => change.kind === 'structural' || change.kind === 'added' || change.kind === 'deleted');
  if (!meaningful.length) return plan('skip', changes, 'All indexed file content hashes are unchanged.');
  if (!structural.length) return plan('file-local', changes, `${meaningful.length} file(s) changed without altering extracted structure.`);
  const ratio = structural.length / Math.max(current.files.length, 1);
  if (structural.length > 30 || ratio > 0.5) return plan('full', changes, `${structural.length} structural changes require a full rebuild.`);
  if (structural.length > 10) return plan('architecture', changes, `${structural.length} structural changes require architecture refresh.`);
  return plan('graph', changes, `${structural.length} structural change(s) require graph relationship refresh.`);
}

function classifyFile(previous: RepoFile, current: RepoFile): FileChangeKind {
  if (previous.contentHash && current.contentHash && previous.contentHash === current.contentHash) return 'unchanged';
  if (previous.structuralHash && current.structuralHash && previous.structuralHash === current.structuralHash) return 'implementation';
  return 'structural';
}

function plan(action: IngestionUpdateAction, changes: readonly FileChange[], reason: string): IncrementalUpdatePlan {
  const filesToAnalyze = changes.filter(change => change.kind !== 'unchanged' && change.kind !== 'deleted').map(change => change.path);
  return {
    action,
    changes,
    filesToAnalyze,
    rerunGraph: action === 'graph' || action === 'architecture' || action === 'full',
    rerunArchitecture: action === 'architecture' || action === 'full',
    reason
  };
}
