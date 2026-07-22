import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "../persistence/AtomicFileWriter";
import type { QaTestIntelligenceAggregate } from "../../shared/contracts/phase8TestIntelligence";

interface Phase8State {
  schemaVersion: 1;
  revision: number;
  workflows: Record<string, QaTestIntelligenceAggregate>;
  updatedAt: string;
}

/**
 * Persistence for Phase 8 test-intelligence records. Mirrors the Phase 7
 * ImpactQaPersistence design (atomic writes, schema-versioned, recovery of
 * interrupted validations on restart).
 */
export class QaTestIntelligencePersistence {
  private state: Phase8State = {
    schemaVersion: 1,
    revision: 0,
    workflows: {},
    updatedAt: new Date(0).toISOString(),
  };
  private readonly path: string;

  constructor(root: string, private readonly writer = new AtomicFileWriter()) {
    this.path = join(root, "impact-qa", "phase-8-test-intelligence.json");
  }

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as Phase8State;
      if (parsed.schemaVersion === 1 && parsed.workflows && typeof parsed.workflows === "object") {
        this.state = parsed;
      } else {
        throw new Error("Unsupported Phase 8 persistence schema.");
      }
      const recovered = recoverInterrupted(this.state);
      if (recovered !== this.state) {
        await this.writer.writeJson(this.path, recovered);
        this.state = recovered;
      }
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) {
        await rename(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => undefined);
      }
      await this.writer.writeJson(this.path, this.state);
    }
  }

  get(workflowId: string): QaTestIntelligenceAggregate | undefined {
    const value = this.state.workflows[workflowId];
    return value ? structuredClone(value) : undefined;
  }

  async save(value: QaTestIntelligenceAggregate): Promise<void> {
    const next: Phase8State = {
      schemaVersion: 1,
      revision: this.state.revision + 1,
      workflows: { ...this.state.workflows, [value.workflowId]: structuredClone(value) },
      updatedAt: value.updatedAt,
    };
    await this.writer.writeJson(this.path, next);
    this.state = next;
  }
}

function recoverInterrupted(state: Phase8State): Phase8State {
  let changed = false;
  const workflows = Object.fromEntries(
    Object.entries(state.workflows).map(([id, value]) => {
      const interrupted = value.validations.filter(
        (validation) =>
          validation.finalStatus === "not-started" ||
          validation.levels.some((level) => level.status === "running"),
      );
      if (!interrupted.length) return [id, value];
      changed = true;
      const validations = value.validations.map((validation) => ({
        ...validation,
        finalStatus: validation.finalStatus === "not-started"
          ? ("incomplete" as const)
          : validation.finalStatus,
        levels: validation.levels.map((level) =>
          level.status === "running" ? { ...level, status: "incomplete" as const } : level,
        ),
      }));
      return [id, { ...value, validations }];
    }),
  );
  return changed ? { ...state, revision: state.revision + 1, workflows } : state;
}
