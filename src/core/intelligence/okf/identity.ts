import { createHash } from 'node:crypto';

/** Produces stable, workspace-scoped IDs without leaking absolute file paths. */
export function createOkfId(
  workspaceId: string,
  recordType: 'unit' | 'relationship' | 'observation' | 'evidence',
  canonicalKey: string,
): string {
  const digest = createHash('sha256')
    .update(`${workspaceId}\u0000${recordType}\u0000${canonicalKey}`)
    .digest('hex')
    .slice(0, 32);
  return `keystone:${recordType}:${digest}`;
}

export function canonicalRelationshipKey(kind: string, sourceId: string, targetId: string): string {
  return `${kind}:${sourceId}->${targetId}`;
}
