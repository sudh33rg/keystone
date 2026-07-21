/**
 * RawContextBaselineService
 *
 * Produces the *raw context candidate set* — everything that would reasonably be
 * sent to the agent BEFORE Keystone compression. This is explicitly NOT the
 * entire repository; it is the bounded, relevance-discoverable candidate set
 * derived from workflow intent, specification, acceptance criteria, the current
 * stage/work item, selected and changed files/symbols, dependencies, dependents,
 * bounded call/data flows, tests, prior-stage outputs, validation findings, and
 * user-pinned context.
 *
 * The measured token count of this candidate set becomes the `rawBaseline`, the
 * denominator for the real reduction percentage. It is persisted so reduction
 * can be recomputed and audited later.
 */

import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceQueryService } from "../intelligence/IntelligenceQueryService";
import type { IntelligenceSnapshotReader } from "../persistence/IntelligenceStore";
import type { TokenCounter } from "./TokenCounterRegistry";
import type { DevelopmentSpecification, DevelopmentTask } from "../../shared/contracts/delegation";
import {
  ContextItemSchema,
  RawContextBaselineSchema,
  type ContextItem,
  type ContextSourceType,
  type RawContextBaseline,
} from "../../shared/contracts/contextPackage";
import { normalizeContent, sha256, fnv1a } from "./compressionUtils";

export interface RawBaselineInput {
  task: DevelopmentTask;
  specification: DevelopmentSpecification;
  instructionContents: Array<{ id: string; content: string }>;
  skillContents: Array<{ id: string; content: string }>;
  pinnedItemIds: string[];
  currentFile?: string;
  currentSelection?: { relativePath: string; startLine: number; endLine: number };
  signal?: AbortSignal;
}

interface RawCandidateSeed {
  sourceType: ContextSourceType;
  sourceId: string;
  title: string;
  content: string;
  reason: string;
  importance: ContextItem["importance"];
  filePath?: string;
  symbolId?: string;
  confidence?: number;
  relationship?: string;
  requiresRequired?: boolean;
}

const MAX_CANDIDATES = 1200;
const MAX_FILE_CHARS = 20_000;
const MAX_SYMBOL_CHARS = 12_000;

export class RawContextBaselineService {
  constructor(
    private readonly snapshotReader: IntelligenceSnapshotReader,
    private readonly queries: IntelligenceQueryService,
    private readonly workspace: WorkspaceAdapter,
  ) {}

  getSnapshot() {
    return this.snapshotReader.getSnapshot();
  }

  async build(
    input: RawBaselineInput,
    counter: TokenCounter,
  ): Promise<{ items: ContextItem[]; baseline: RawContextBaseline }> {
    const seeds = await this.collectSeeds(input);
    const items: ContextItem[] = [];
    const tokensBySourceType: Record<string, number> = {};
    const sources: string[] = [];
    let byteCount = 0;

    for (const seed of seeds) {
      input.signal?.throwIfAborted();
      const normalized = normalizeContent(seed.content);
      const rawHash = await sha256(normalized);
      const rawTokens = counter.count(normalized);
      tokensBySourceType[seed.sourceType] = (tokensBySourceType[seed.sourceType] ?? 0) + rawTokens;
      byteCount += Buffer.byteLength(normalized, "utf8");
      sources.push(`${seed.sourceType}:${seed.sourceId}`);
      items.push(
        ContextItemSchema.parse({
          id: `cand:${fnv1a(seed.sourceType + seed.sourceId + rawHash).slice(0, 12)}`,
          title: seed.title,
          sourceType: seed.sourceType,
          sourceReference: {
            filePath: seed.filePath,
            symbolId: seed.symbolId,
            entityId: seed.sourceId,
          },
          contentMode: "full",
          importance: seed.importance,
          relevanceScore: 0,
          confidence: seed.confidence ?? 1,
          tokenCount: rawTokens,
          rawTokenCount: rawTokens,
          savedTokens: 0,
          reasons: [seed.reason],
          dependencies: [],
          satisfiesRequiredFacts: [],
          content: normalized,
          rawContentHash: rawHash,
          compressedContentHash: rawHash,
          pinned: input.pinnedItemIds.includes(seed.sourceId),
          freshness: "current",
        }),
      );
    }

    const baseline = RawContextBaselineSchema.parse({
      candidateCount: items.length,
      sourceCount: new Set(sources).size,
      tokenCount: counter.countSections(items.map((i) => i.content)),
      byteCount,
      tokensBySourceType,
      tokenizer: counter.info(),
      sources,
    });
    return { items: items.slice(0, MAX_CANDIDATES), baseline };
  }

  private async collectSeeds(input: RawBaselineInput): Promise<RawCandidateSeed[]> {
    const seeds: RawCandidateSeed[] = [];
    const { task, specification } = input;

    // 1. Workflow intent / objective.
    seeds.push({
      sourceType: "workflow-intent",
      sourceId: `intent:${task.id}`,
      title: "Task objective",
      content: task.objective,
      reason:
        "The approved task objective frames the delegation and is required for safe completion.",
      importance: "required",
      requiresRequired: true,
    });

    // 2. Specification requirements linked to the task.
    for (const requirement of specification.requirements.filter((r) =>
      task.requirementIds.includes(r.id),
    )) {
      seeds.push({
        sourceType: "specification",
        sourceId: `requirement:${requirement.id}`,
        title: `Requirement ${requirement.id}`,
        content: requirement.description,
        reason: "The task is traceable to this approved requirement.",
        importance: "required",
        requiresRequired: true,
      });
    }

    // 3. Acceptance criteria.
    for (const criterion of specification.acceptanceCriteria.filter((c) =>
      task.acceptanceCriterionIds.includes(c.id),
    )) {
      seeds.push({
        sourceType: "acceptance-criterion",
        sourceId: `criterion:${criterion.id}`,
        title: `Acceptance criterion ${criterion.id}`,
        content: `${criterion.description}\nValidation method: ${criterion.validationMethod}\nExpected evidence: ${criterion.expectedEvidence}`,
        reason: "The task must satisfy and validate this acceptance criterion.",
        importance: "required",
        requiresRequired: true,
      });
    }

    // 4. Constraints.
    specification.constraints.forEach((constraint, index) => {
      seeds.push({
        sourceType: "specification",
        sourceId: `constraint:${index}`,
        title: `Constraint ${index + 1}`,
        content: constraint,
        reason: "Approved engineering constraint.",
        importance: "required",
      });
    });

    // 5. Validation steps.
    for (const step of task.validationSteps) {
      seeds.push({
        sourceType: "validation-evidence",
        sourceId: `validation:${fnv1a(step.command ?? step.manualCheck ?? "manual")}`,
        title: "Required validation",
        content: step.command ?? step.manualCheck ?? "Manual validation",
        reason: "The task cannot be considered ready without this validation step.",
        importance: "required",
      });
    }

    // 6. Selected / expected files.
    const pinnedFiles = new Set(input.currentFile ? [input.currentFile] : []);
    const candidateFiles = new Set<string>([...task.expectedFiles, ...pinnedFiles]);
    const snapshot = this.getSnapshot();
    if (!snapshot)
      throw new Error(
        "A complete intelligence generation is required to build delegation context.",
      );

    for (const relativePath of [...candidateFiles].slice(0, 200)) {
      input.signal?.throwIfAborted();
      const file = snapshot.files.find((f) => f.relativePath === relativePath);
      if (!file) {
        seeds.push({
          sourceType: "repository-file",
          sourceId: `missing-file:${relativePath}`,
          title: relativePath,
          content: "The expected file is not present in the active intelligence generation.",
          reason: "Missing expected file is an explicit context limitation.",
          importance: "supporting",
          filePath: relativePath,
        });
        continue;
      }
      if (
        !file.classification.included ||
        file.classification.sensitive ||
        file.classification.binary ||
        file.classification.generated
      ) {
        seeds.push({
          sourceType: "repository-file",
          sourceId: `excluded-file:${file.id}`,
          title: relativePath,
          content: file.classification.reason,
          reason: "The intelligence safety policy prevents source inclusion of this file.",
          importance: "supporting",
          filePath: relativePath,
        });
        continue;
      }
      const content = await this.readFile(file, snapshot, input.signal);
      seeds.push({
        sourceType: "repository-file",
        sourceId: `file:${file.id}`,
        title: relativePath,
        content: content.slice(0, MAX_FILE_CHARS),
        reason: task.expectedFiles.includes(relativePath)
          ? "Expected file for the approved task."
          : "User-pinned file proximity.",
        importance: task.expectedFiles.includes(relativePath) ? "required" : "supporting",
        filePath: relativePath,
        confidence: 1,
      });
      if (
        input.currentSelection?.relativePath === relativePath &&
        input.currentSelection.endLine >= input.currentSelection.startLine
      ) {
        const lines = content.split("\n");
        const selected = lines
          .slice(
            Math.max(0, input.currentSelection.startLine),
            Math.min(input.currentSelection.endLine + 1, input.currentSelection.startLine + 400),
          )
          .join("\n");
        if (selected.trim()) {
          seeds.push({
            sourceType: "repository-file",
            sourceId: `selection:${file.id}:${input.currentSelection.startLine}`,
            title: `${relativePath}:${input.currentSelection.startLine + 1}`,
            content: selected,
            reason: "The user's active editor selection is a high-priority context signal.",
            importance: "supporting",
            filePath: relativePath,
          });
        }
      }
    }

    // 7. Selected / expected symbols and bounded graph relationships.
    const entityIds = [...new Set(task.expectedEntityIds)].slice(0, 200);
    for (const entityId of entityIds) {
      input.signal?.throwIfAborted();
      const symbol = snapshot.symbols.find((s) => s.id === entityId);
      if (!symbol) continue;
      const file = snapshot.files.find((f) => f.id === symbol.fileId);
      const safe =
        file &&
        file.classification.included &&
        !file.classification.sensitive &&
        !file.classification.binary &&
        !file.classification.generated;
      const source = safe
        ? await this.readSymbol(symbol, file, snapshot, input.signal)
        : (symbol.signature ?? symbol.qualifiedName);
      seeds.push({
        sourceType: "symbol",
        sourceId: `entity:${symbol.id}`,
        title: symbol.qualifiedName,
        content: source.slice(0, MAX_SYMBOL_CHARS),
        reason: "Primary entity named by the approved task.",
        importance: "required",
        filePath: file?.relativePath,
        symbolId: symbol.id,
        confidence: symbol.confidence,
      });
      await this.collectGraphSeeds(symbol.id, input, seeds);
    }

    // 8. Selected instructions and skills (counted in the prompt but considered in the baseline).
    for (const instruction of input.instructionContents) {
      seeds.push({
        sourceType: "instruction",
        sourceId: `instruction:${instruction.id}`,
        title: `Instruction ${instruction.id}`,
        content: instruction.content,
        reason: "Selected execution-profile instruction.",
        importance: "required",
      });
    }
    for (const skill of input.skillContents) {
      seeds.push({
        sourceType: "skill",
        sourceId: `skill:${skill.id}`,
        title: `Skill ${skill.id}`,
        content: skill.content,
        reason: "Selected execution-profile skill.",
        importance: "supporting",
      });
    }

    return seeds;
  }

  private async collectGraphSeeds(
    symbolId: string,
    input: RawBaselineInput,
    seeds: RawCandidateSeed[],
  ): Promise<void> {
    const limits = {
      results: 20,
      nodes: 30,
      edges: 60,
      paths: 5,
      depth: 2,
      evidence: 30,
      timeBudgetMs: 1000,
    };
    const ops: Array<{
      op: "NEIGHBORHOOD" | "TESTS_FOR" | "IMPACT";
      kind: ContextSourceType;
      relationship: string;
      importance: ContextItem["importance"];
    }> = [
      {
        op: "NEIGHBORHOOD",
        kind: "symbol",
        relationship: "direct graph relationship",
        importance: "optional",
      },
      { op: "TESTS_FOR", kind: "test", relationship: "test mapping", importance: "supporting" },
      {
        op: "IMPACT",
        kind: "dependency",
        relationship: "impact candidate",
        importance: "optional",
      },
    ];
    for (const { op, kind, relationship, importance } of ops) {
      input.signal?.throwIfAborted();
      try {
        const result = await this.queries.unified(
          { query: { operation: op, seeds: [{ id: symbolId, kind: "id" }], limits } },
          input.signal,
        );
        const selected = op === "NEIGHBORHOOD" ? result.data.nodes : result.data.items;
        for (const value of selected
          .filter((c) => c.id !== symbolId)
          .slice(0, op === "TESTS_FOR" ? 10 : 8)) {
          seeds.push({
            sourceType: kind,
            sourceId: `${op}:${symbolId}:${value.id}`,
            title: value.qualifiedName ?? value.name,
            content: `${value.type}: ${value.qualifiedName ?? value.name}`,
            reason: `Evidence-backed ${relationship}.`,
            importance,
            filePath: value.relativePath,
            symbolId: value.id,
            confidence: value.confidence,
          });
        }
      } catch {
        /* bounded query — ignore partial failures for the baseline */
      }
    }
  }

  private async readFile(
    file: { workspaceRootId: string; relativePath: string },
    snapshot: NonNullable<ReturnType<typeof this.getSnapshot>>,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    const root = snapshot.repository.workspaceRoots.find((r) => r.id === file.workspaceRootId);
    const workspaceRoot =
      this.workspace.getRoots().find((r) => r.name === root?.name) ?? this.workspace.getRoots()[0];
    if (!workspaceRoot) return "";
    const content = await this.workspace.readTextFile(
      this.workspace.fileReference(workspaceRoot, file.relativePath).uri,
    );
    signal?.throwIfAborted();
    return content.slice(0, MAX_FILE_CHARS);
  }

  private async readSymbol(
    symbol: { range: { startLine: number; endLine: number }; signature?: string },
    file: { workspaceRootId: string; relativePath: string },
    snapshot: NonNullable<ReturnType<typeof this.getSnapshot>>,
    signal?: AbortSignal,
  ): Promise<string> {
    const content = await this.readFile(file, snapshot, signal);
    const lines = content.split("\n");
    const start = Math.max(0, symbol.range.startLine - 3);
    const end = Math.min(lines.length, symbol.range.endLine + 4);
    const selected = lines.slice(start, end).join("\n");
    return selected.length > MAX_SYMBOL_CHARS
      ? (symbol.signature ?? selected.slice(0, MAX_SYMBOL_CHARS))
      : selected;
  }
}
