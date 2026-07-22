import type {
  IntelligenceCanvasSearchItem,
  IntelligenceEngineeringIntent,
  IntelligenceEngineeringQueryResult,
  IntelligenceGraphSlice,
} from "../../../shared/contracts/intelligenceCanvas";
import { IntelligenceGraphSliceService } from "./IntelligenceGraphSliceService";

interface ParsedQuery {
  status: "parsed" | "needs-subject-selection" | "unsupported";
  intent?: IntelligenceEngineeringIntent;
  subject?: string;
  target?: string;
}

interface QueryInput {
  text: string;
  intelligenceRevision: string;
  resolvedSubjectId?: string;
  resolvedTargetId?: string;
  limits: { maxNodes: number; maxEdges: number; depth: number };
}

export class IntelligenceEngineeringQueryService {
  constructor(private readonly graph: IntelligenceGraphSliceService) {}

  parse(text: string): ParsedQuery {
    const value = text.trim();
    const patterns: Array<{ intent: IntelligenceEngineeringIntent; expression: RegExp }> = [
      { intent: "flow", expression: /^(?:show\s+(?:the\s+)?flow\s+from\s+(.+?)\s+to\s+(.+?)|how\s+does\s+(.+?)\s+reach\s+(.+?))\??$/i },
      { intent: "relationship", expression: /^(?:how\s+(?:are|is)\s+(.+?)\s+and\s+(.+?)\s+connected|explain\s+(?:the\s+)?relationship\s+between\s+(.+?)\s+and\s+(.+?))\??$/i },
      { intent: "callers", expression: /^(?:show\s+callers\s+of|who\s+calls)\s+(.+?)\??$/i },
      { intent: "callees", expression: /^(?:show\s+callees\s+of\s+(.+?)|what\s+does\s+(.+?)\s+call)\??$/i },
      { intent: "dependencies", expression: /^show\s+dependencies\s+of\s+(.+?)\??$/i },
      { intent: "dependents", expression: /^(?:show\s+dependents\s+of|what\s+depends\s+on)\s+(.+?)\??$/i },
      { intent: "tests", expression: /^(?:which\s+tests\s+cover|show\s+tests\s+for)\s+(.+?)\??$/i },
    ];
    for (const pattern of patterns) {
      const match = value.match(pattern.expression);
      if (!match) continue;
      const captures = match.slice(1).filter((item): item is string => Boolean(item));
      return { status: "parsed", intent: pattern.intent, subject: captures[0]?.trim(), target: captures[1]?.trim() };
    }
    if (/^(?:show\s+)?(?:callers|callees|dependencies|dependents|tests)(?:\s+of)?\s*\??$/i.test(value)) {
      return { status: "needs-subject-selection" };
    }
    return { status: "unsupported" };
  }

  execute(input: QueryInput): IntelligenceEngineeringQueryResult {
    const parsed = this.parse(input.text);
    const currentRevision = this.graph.currentRevision();
    if (parsed.status === "unsupported") return result("unsupported", currentRevision,
      "Supported questions cover callers, callees, dependencies, dependents, tests, flows, and relationships.");
    if (parsed.status === "needs-subject-selection" || !parsed.intent || !parsed.subject) {
      return result("needs-subject-selection", currentRevision, "Choose a repository symbol or file to continue.");
    }
    const subjects = this.resolve(parsed.subject, input.resolvedSubjectId);
    if (subjects.length !== 1) return { ...result("needs-subject-selection", currentRevision,
      subjects.length ? "Choose the intended subject." : `No indexed entity matches “${parsed.subject}”.`), intent: parsed.intent, subjectCandidates: subjects };
    const subject = subjects[0]!;
    if (parsed.intent === "flow" || parsed.intent === "relationship") {
      const targets = this.resolve(parsed.target ?? "", input.resolvedTargetId);
      if (targets.length !== 1) return { ...result("needs-target-selection", currentRevision,
        targets.length ? "Choose the intended target." : `No indexed entity matches “${parsed.target ?? ""}”.`), intent: parsed.intent, targetCandidates: targets };
      const target = targets[0]!;
      const path = this.graph.findPath(subject.id, target.id, input.limits.depth);
      if (!path) return { ...result("no-result", currentRevision,
        `No evidence-backed path was found from ${subject.qualifiedLabel} to ${target.qualifiedLabel} within depth ${input.limits.depth}.`), intent: parsed.intent, graph: undefined };
      const graph = this.graph.getGraphSlice({
        rootEntityIds: [subject.id], mode: "flow", direction: "outbound", depth: input.limits.depth,
        relationshipTypes: ["routes-to", "calls", "imports", "depends-on", "reads", "writes", "tested-by", "contains", "implements", "extends"],
        maxNodes: input.limits.maxNodes, maxEdges: input.limits.maxEdges, minimumConfidence: 0,
        intelligenceRevision: input.intelligenceRevision,
      });
      const pathIds = new Set(path.entityIds);
      const edgeIds = new Set(path.edgeIds);
      const boundedGraph: IntelligenceGraphSlice = { ...graph, nodes: graph.nodes.filter((node) => pathIds.has(node.id)), edges: graph.edges.filter((edge) => edgeIds.has(edge.id)) };
      return { ...result("completed", currentRevision, `Evidence-backed ${parsed.intent} from ${subject.qualifiedLabel} to ${target.qualifiedLabel}.`), intent: parsed.intent, graph: boundedGraph, path };
    }

    const specification = querySpecification(parsed.intent);
    const graph = this.graph.getGraphSlice({
      rootEntityIds: [subject.id], mode: specification.mode, direction: specification.direction, depth: input.limits.depth,
      relationshipTypes: specification.relationships, maxNodes: input.limits.maxNodes, maxEdges: input.limits.maxEdges,
      minimumConfidence: 0, intelligenceRevision: input.intelligenceRevision,
    });
    const empty = graph.edges.length === 0;
    const summary = parsed.intent === "tests"
      ? `${graph.edges.length} static Intelligence mapping${graph.edges.length === 1 ? "" : "s"}; this is not runtime coverage.`
      : `${graph.edges.length} evidence-backed ${parsed.intent} relationship${graph.edges.length === 1 ? "" : "s"}.`;
    return { ...result(empty ? "no-result" : "completed", currentRevision, summary), intent: parsed.intent, graph };
  }

  private resolve(text: string, selectedId?: string): IntelligenceCanvasSearchItem[] {
    const candidates = this.graph.searchEntities({ query: text, limit: 20 }).items;
    if (selectedId) return candidates.filter((candidate) => candidate.id === selectedId);
    const normalized = text.toLocaleLowerCase();
    const exact = candidates.filter((candidate) => candidate.qualifiedLabel.toLocaleLowerCase() === normalized
      || candidate.filePath.toLocaleLowerCase() === normalized
      || candidate.label.toLocaleLowerCase() === normalized);
    return exact.length ? exact : candidates;
  }
}

function querySpecification(intent: Exclude<IntelligenceEngineeringIntent, "flow" | "relationship">): {
  mode: "calls" | "dependencies" | "tests"; direction: "inbound" | "outbound"; relationships: string[];
} {
  switch (intent) {
    case "callers": return { mode: "calls", direction: "inbound", relationships: ["calls", "routes-to"] };
    case "callees": return { mode: "calls", direction: "outbound", relationships: ["calls", "routes-to"] };
    case "dependencies": return { mode: "dependencies", direction: "outbound", relationships: ["imports", "depends-on"] };
    case "dependents": return { mode: "dependencies", direction: "inbound", relationships: ["imports", "depends-on"] };
    case "tests": return { mode: "tests", direction: "outbound", relationships: ["tested-by"] };
  }
}

function result(status: IntelligenceEngineeringQueryResult["status"], intelligenceRevision: string, summary: string): IntelligenceEngineeringQueryResult {
  return { status, summary, subjectCandidates: [], targetCandidates: [], intelligenceRevision };
}
