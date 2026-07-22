/** Fuzzy search over intelligence symbols/files using Fuse.js. */
import Fuse from "fuse.js";
import type { IntelligenceSnapshot } from "../../../shared/contracts/intelligence";

export interface FuzzySearchOptions {
  kind: "name" | "qualified-name" | "path" | "route" | "database";
  entityTypes?: string[];
  limit?: number;
  threshold?: number;
}

export class FuseSearchService {
  constructor(private readonly snapshot: IntelligenceSnapshot) {}

  search(query: string, options: FuzzySearchOptions = { kind: "name" }): string[] {
    const q = query.trim();
    if (!q) return [];
    const limit = options.limit ?? 20;
    const threshold = options.threshold ?? 0.25;
    const entityTypes = options.entityTypes;

    const candidates = this.buildCandidates(options.kind, entityTypes);
    if (candidates.length === 0) return [];

    const fuse = new Fuse(candidates, {
      keys: options.kind === "qualified-name" ? ["qualifiedName"] : ["name"],
      threshold,
      ignoreLocation: true,
      includeScore: true,
    });

    return fuse.search(q).slice(0, limit).map((r) => r.item.id);
  }

  private buildCandidates(
    kind: FuzzySearchOptions["kind"],
    entityTypes?: string[],
  ): Array<{ id: string; name: string; qualifiedName?: string }> {
    const out: Array<{ id: string; name: string; qualifiedName?: string }> = [];

    const considerSymbol = (s: any) => {
      if (entityTypes && entityTypes.length > 0) {
        const nodeKind = symbolNodeKind(s.type);
        if (!entityTypes.includes(nodeKind)) return;
      }
      switch (kind) {
        case "qualified-name":
          if (s.qualifiedName) out.push({ id: s.id, name: s.name, qualifiedName: s.qualifiedName });
          break;
        case "route":
          if (s.type === "keystone.core.Route") {
            const qn = s.qualifiedName ?? `${s.properties?.method ?? ""} ${s.properties?.routePath ?? ""}`;
            out.push({ id: s.id, name: s.name, qualifiedName: qn });
          }
          break;
        case "database":
          if (s.type === "keystone.core.Table" || s.type === "keystone.core.Entity") {
            out.push({ id: s.id, name: s.name, qualifiedName: s.qualifiedName });
          }
          break;
        default:
          out.push({ id: s.id, name: s.name, qualifiedName: s.qualifiedName });
      }
    };

    const considerFile = (f: any) => {
      if (entityTypes && entityTypes.length > 0 && !entityTypes.includes("file")) return;
      if (kind === "path" || kind === "name") out.push({ id: f.id, name: f.relativePath });
    };

    for (const s of this.snapshot.symbols) considerSymbol(s);
    for (const f of this.snapshot.files) considerFile(f);
    return out;
  }
}

function symbolNodeKind(type: string): string {
  const map: Record<string, string> = {
    "keystone.core.Repository": "repository",
    "keystone.core.Package": "package",
    "keystone.core.Module": "module",
    "keystone.core.Directory": "directory",
    "keystone.core.File": "file",
    "keystone.core.Class": "class",
    "keystone.core.Interface": "interface",
    "keystone.core.Function": "function",
    "keystone.core.Method": "method",
    "keystone.core.Route": "route",
    "keystone.core.Event": "event",
    "keystone.core.BackgroundJob": "job",
    "keystone.core.Database": "database",
    "keystone.core.Table": "table",
    "keystone.core.Entity": "entity",
    "keystone.core.ExternalService": "external-service",
    "keystone.core.TestSuite": "test-file",
    "keystone.core.TestCase": "test-case",
    "keystone.core.Fixture": "fixture",
    "keystone.core.ConfigurationKey": "configuration",
  };
  return map[type] ?? "unknown";
}
