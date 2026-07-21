import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CopilotCapabilityService,
  CopilotToolAuditService,
  CopilotToolExecutionService,
  CopilotToolPolicyService,
  CopilotToolRegistry,
} from "../../../src/core/copilot/CopilotIntegrationService";
import { KeystoneChatParticipantService } from "../../../src/core/copilot/KeystoneChatAndLaunchService";
import { CopilotIntegrationPersistenceStore } from "../../../src/core/persistence/CopilotIntegrationPersistenceStore";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function store() {
  const root = await mkdtemp(join(tmpdir(), "keystone-copilot-"));
  roots.push(root);
  const value = new CopilotIntegrationPersistenceStore(root);
  await value.initialize();
  return value;
}

describe("Copilot integration", () => {
  it("detects independent capabilities and persists an honest snapshot", async () => {
    const persistence = await store();
    const service = new CopilotCapabilityService(
      () => ({
        chat: true,
        tools: true,
        participant: false,
        direct: false,
        assisted: true,
        clipboard: true,
      }),
      () => true,
      persistence,
    );
    const result = await service.refresh();
    expect(result).toMatchObject({
      chatAvailable: true,
      languageModelToolsAvailable: true,
      chatParticipantAvailable: false,
      directAgentInvocationAvailable: false,
      assistedInvocationAvailable: true,
    });
    expect(result.limitations.join(" ")).toContain("participant");
    expect(persistence.snapshot.lastCapabilities?.fingerprint).toBe(result.fingerprint);
  });
  it("registers only the approved read-only tool set", () => {
    const tools = new CopilotToolRegistry(() => true).list();
    expect(tools).toHaveLength(17);
    expect(tools.every((tool) => !tool.mutating && tool.available)).toBe(true);
    expect(tools.some((tool) => /git|shell|write|commit|push|handoff/i.test(tool.name))).toBe(
      false,
    );
  });
  it("rejects untrusted and cross-repository tool input", () => {
    const policy = new CopilotToolPolicyService();
    expect(() =>
      policy.validate(
        "keystone_search_repository",
        { repositoryId: "repo", limit: 5, timeoutMs: 500 },
        "repo",
        false,
      ),
    ).toThrow(/trusted/);
    expect(() =>
      policy.validate(
        "keystone_search_repository",
        { repositoryId: "other", limit: 5, timeoutMs: 500 },
        "repo",
        true,
      ),
    ).toThrow(/active repository/);
  });
  it("executes a bounded search and records a source-free audit entry", async () => {
    const persistence = await store();
    const intelligence = {
      search: () =>
        Promise.resolve({
          generation: 7,
          total: 2,
          items: [
            { id: "entity:1", name: "One" },
            { id: "entity:2", name: "Two" },
          ],
        }),
    };
    const snapshots = {
      getSnapshot: () => ({ repository: { id: "repo" }, manifest: { generation: 7 } }),
    };
    const audit = new CopilotToolAuditService(persistence);
    const service = new CopilotToolExecutionService(
      intelligence as never,
      snapshots as never,
      { get: () => undefined } as never,
      { get: () => undefined } as never,
      { snapshot: { sessions: [], runs: [] } } as never,
      audit,
      () => true,
    );
    const result = await service.execute("keystone_search_repository", {
      repositoryId: "repo",
      query: "super-secret-query",
      limit: 1,
      timeoutMs: 1000,
    });
    expect(result.truncated).toBe(true);
    expect(result.generation).toBe(7);
    expect(persistence.snapshot.audit).toHaveLength(1);
    expect(JSON.stringify(persistence.snapshot.audit[0])).not.toContain("super-secret-query");
  });
  it("returns templates rather than fabricating unsupported chat answers", async () => {
    const participant = new KeystoneChatParticipantService(
      { execute: () => Promise.reject(new Error("not called")) } as never,
      () => "repo",
    );
    const answer = await participant.answer("write all the code", {});
    expect(answer.supported).toBe(false);
    expect(answer.markdown).toContain("cannot answer");
  });
  it("marks opened assisted launches uncertain on reload", async () => {
    const persistence = await store();
    await persistence.update((state) => ({
      ...state,
      assistedLaunches: [
        {
          id: "a0000000-0000-4000-8000-000000000000",
          workflowId: "b0000000-0000-4000-8000-000000000000",
          taskId: "c0000000-0000-4000-8000-000000000000",
          customizationFingerprints: [],
          prompt: "bounded",
          promptFingerprint: "sha256:test",
          status: "opened",
          preparedAt: new Date().toISOString(),
        },
      ],
    }));
    const { CopilotAssistedLaunchService } =
      await import("../../../src/core/copilot/KeystoneChatAndLaunchService");
    const service = new CopilotAssistedLaunchService(
      persistence,
      {} as never,
      {} as never,
      {} as never,
    );
    await service.recover(() => undefined);
    expect(service.get("a0000000-0000-4000-8000-000000000000")?.status).toBe("uncertain");
  });
});
