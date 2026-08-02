import type { KeystoneOkfSnapshot } from "./types";
import { validateOkfSnapshot } from "./validation";
const lines = (records: readonly unknown[]): string =>
  records.map((v) => JSON.stringify(v)).join("\n") + (records.length ? "\n" : "");
export interface SerializedOkfSnapshot {
  readonly "manifest.json": string;
  readonly "profile.json": string;
  readonly "knowledge/units.jsonl": string;
  readonly "knowledge/relationships.jsonl": string;
  readonly "knowledge/observations.jsonl": string;
  readonly "knowledge/evidence.jsonl": string;
  readonly "validation.json": string;
}
export function serializeOkfSnapshot(snapshot: KeystoneOkfSnapshot): SerializedOkfSnapshot {
  const result = validateOkfSnapshot(snapshot);
  if (!result.valid)
    throw new Error(
      `Invalid Keystone OKF snapshot: ${result.issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`
    );
  return {
    "manifest.json": `${JSON.stringify(snapshot.manifest, null, 2)}\n`,
    "profile.json": `${JSON.stringify({ id: snapshot.manifest.profile, version: snapshot.manifest.profileVersion, digest: snapshot.manifest.profileDigest }, null, 2)}\n`,
    "knowledge/units.jsonl": lines(snapshot.units),
    "knowledge/relationships.jsonl": lines(snapshot.relationships),
    "knowledge/observations.jsonl": lines(snapshot.observations),
    "knowledge/evidence.jsonl": lines(snapshot.evidence),
    "validation.json": `${JSON.stringify(result, null, 2)}\n`
  };
}
