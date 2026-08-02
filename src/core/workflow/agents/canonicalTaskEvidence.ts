import type { CanonicalContextSelection } from "../../intelligence/okf/canonicalContext";

/**
 * Converts the bounded canonical graph into an analysis-safe digest. Agents may use this
 * digest alongside source excerpts, but the selected paths and relationships remain owned by
 * the promoted OKF selection.
 */
export function canonicalGraphDigest(canonical?: CanonicalContextSelection): string {
  if (!canonical) return "";
  return [
    "Canonical OKF units:",
    ...canonical.graph.nodes.map(
      (node) => `${node.kind} ${node.label}${node.path ? ` ${node.path}` : ""}`
    ),
    "Canonical OKF relationships:",
    ...canonical.graph.edges.map((edge) => `${edge.kind} ${edge.sourceId} ${edge.targetId}`)
  ].join("\n");
}

export function canonicalRiskAreas(
  canonical: CanonicalContextSelection | undefined,
  category: "security" | "performance" | "modernization"
): string[] {
  return (
    canonical?.graph.nodes
      .filter((node) => {
        if (node.kind === "change-impact") return category === "modernization";
        if (node.kind !== "risk-area") return false;
        return node.properties.category === category;
      })
      .map((node) => node.label) ?? []
  );
}
