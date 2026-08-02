import type { KeystoneOkfSnapshot } from "./types";
export interface OkfGraphNode {
  readonly id: string;
  readonly okfId: string;
  readonly kind: string;
  readonly label: string;
  readonly lifecycle: string;
  readonly properties: Readonly<Record<string, unknown>>;
}
export interface OkfGraphEdge {
  readonly id: string;
  readonly okfId: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: string;
  readonly lifecycle: string;
  readonly properties: Readonly<Record<string, unknown>>;
}
export interface OkfGraphProjection {
  readonly version: 1;
  readonly extractionRunId: string;
  readonly nodes: readonly OkfGraphNode[];
  readonly edges: readonly OkfGraphEdge[];
}
export interface OkfSearchDocument {
  readonly id: string;
  readonly okfId: string;
  readonly kind: string;
  readonly text: string;
  readonly path?: string;
  readonly evidenceIds: readonly string[];
}
export interface OkfCpgBinding {
  readonly okfId: string;
  readonly path: string;
  readonly symbol?: string;
  readonly line?: number;
}
export function projectOkfGraph(snapshot: KeystoneOkfSnapshot): OkfGraphProjection {
  return {
    version: 1,
    extractionRunId: snapshot.manifest.extractionRunId,
    nodes: snapshot.units.map((u) => ({
      id: u.id,
      okfId: u.id,
      kind: u.kind,
      label: u.name,
      lifecycle: u.lifecycle,
      properties: u.properties
    })),
    edges: snapshot.relationships.map((r) => ({
      id: r.id,
      okfId: r.id,
      sourceId: r.sourceId,
      targetId: r.targetId,
      kind: r.kind,
      lifecycle: r.lifecycle,
      properties: r.properties
    }))
  };
}
export function projectOkfSearch(snapshot: KeystoneOkfSnapshot): OkfSearchDocument[] {
  return snapshot.units
    .filter((u) => u.lifecycle === "active")
    .map((u) => ({
      id: u.id,
      okfId: u.id,
      kind: u.kind,
      text: [u.name, u.description, u.canonicalKey, JSON.stringify(u.properties)]
        .filter(Boolean)
        .join("\n"),
      path:
        typeof u.properties.path === "string"
          ? u.properties.path
          : typeof u.properties.filePath === "string"
            ? u.properties.filePath
            : undefined,
      evidenceIds: u.provenance.evidenceIds
    }));
}
export function projectCpgBindings(snapshot: KeystoneOkfSnapshot): OkfCpgBinding[] {
  return snapshot.units
    .filter(
      (u) =>
        u.lifecycle === "active" &&
        (u.kind === "file" ||
          u.kind === "test" ||
          u.kind === "documentation" ||
          u.kind === "configuration" ||
          u.kind === "symbol")
    )
    .flatMap((u) => {
      const p =
        typeof u.properties.path === "string"
          ? u.properties.path
          : typeof u.properties.filePath === "string"
            ? u.properties.filePath
            : undefined;
      if (!p) return [];
      return [
        {
          okfId: u.id,
          path: p,
          symbol: u.kind === "symbol" ? u.name : undefined,
          line: typeof u.properties.line === "number" ? u.properties.line : undefined
        }
      ];
    });
}
