import { beforeEach, describe, it, expect, vi } from "vitest";
import type { WorkspaceStateStore } from "../../../src/core/persistence/WorkspaceStateStore";
import { TaskGraphService } from "../../../src/core/tasks/TaskGraphService";
import { KeystoneError } from "../../../src/shared/errors/KeystoneError";
import type { AcceptanceCriterion } from "../../../src/shared/contracts/domain";

function criterion(id: string, description: string): AcceptanceCriterion {
  return {
    id,
    description,
    required: true,
    sourceRequirementIds: [],
    validationMethod: "manual",
    expectedEvidenceType: "manual-observation",
    coveringTaskIds: [],
    result: "unverified",
    evidenceReferences: []
  };
}

describe("TaskGraphService", () => {
  let service: TaskGraphService;

  beforeEach(() => {
    const store = {
      get: vi.fn(),
      update: vi.fn(),
      reset: vi.fn()
    } as unknown as WorkspaceStateStore;

    service = new TaskGraphService(store);
  });

  it("should generate a task graph from acceptance criteria", () => {
    const criteria = [criterion("criterion-1", "User can log in")];

    const graph = service.generateFromSpecification("spec-1", 1, criteria);

    expect(graph.taskIds.length).toBe(1);
    expect(graph.specificationId).toBe("spec-1");
    expect(graph.specificationRevision).toBe(1);
  });

  it("should perform topological sort", () => {
    const criteria = [
      criterion("c1", "A"),
      criterion("c2", "B")
    ];

    const graph = service.generateFromSpecification("spec-1", 1, criteria);

    expect(graph.topologicalOrder.length).toBe(2);
  });

  it("should transition task status", () => {
    const criteria = [criterion("c1", "Test")];
    const graph = service.generateFromSpecification("spec-1", 1, criteria);
    const taskId = graph.taskIds[0]!;

    const updated = service.transitionTask(taskId, "pending", "ready");
    expect(updated.status).toBe("ready");
  });

  it("should reject invalid transitions", () => {
    const criteria = [criterion("c1", "Test")];
    const graph = service.generateFromSpecification("spec-1", 1, criteria);
    const taskId = graph.taskIds[0]!;

    expect(() => service.transitionTask(taskId, "pending", "passed"))
      .toThrow(KeystoneError);
  });
});
