import { describe, it, expect, vi } from "vitest";
import type { WorkspaceStateStore } from "../../../src/core/persistence/WorkspaceStateStore";
import { TaskGraphService } from "../../../src/core/tasks/TaskGraphService";
import { KeystoneError } from "../../../src/shared/errors/KeystoneError";

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
    const criteria = [{
      id: "criterion-1",
      description: "User can log in",
      coveringTaskIds: []
    }];

    const graph = service.generateFromSpecification("spec-1", 1, criteria);

    expect(graph.taskIds.length).toBe(1);
    expect(graph.specificationId).toBe("spec-1");
    expect(graph.specificationRevision).toBe(1);
  });

  it("should perform topological sort", () => {
    const criteria = [
      { id: "c1", description: "A", coveringTaskIds: [] },
      { id: "c2", description: "B", coveringTaskIds: [] }
    ];

    const graph = service.generateFromSpecification("spec-1", 1, criteria);

    expect(graph.topologicalOrder.length).toBe(2);
  });

  it("should transition task status", () => {
    const criteria = [{ id: "c1", description: "Test", coveringTaskIds: [] }];
    const graph = service.generateFromSpecification("spec-1", 1, criteria);
    const taskId = graph.taskIds[0];

    const updated = service.transitionTask(taskId, "pending", "ready");
    expect(updated.status).toBe("ready");
  });

  it("should reject invalid transitions", () => {
    const criteria = [{ id: "c1", description: "Test", coveringTaskIds: [] }];
    const graph = service.generateFromSpecification("spec-1", 1, criteria);
    const taskId = graph.taskIds[0];

    expect(() => service.transitionTask(taskId, "pending", "completed"))
      .toThrow(KeystoneError);
  });
});
