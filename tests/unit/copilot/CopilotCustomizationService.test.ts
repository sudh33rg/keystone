import { describe, expect, it } from "vitest";
import { CopilotCustomizationService } from "../../../src/core/copilot/CopilotCustomizationService";
import { DelegationPersistenceStore } from "../../../src/core/persistence/DelegationPersistenceStore";
import type {
  WorkspaceAdapter,
  WorkspaceFileReference,
} from "../../../src/extension/adapters/WorkspaceAdapter";
import type { DevelopmentTask } from "../../../src/shared/contracts/delegation";

describe("CopilotCustomizationService", () => {
  it("discovers only supported customization formats and applies path scope deterministically", async () => {
    const files = [
      "AGENTS.md",
      ".github/copilot-instructions.md",
      ".github/instructions/src.instructions.md",
      ".github/agents/backend.agent.md",
      ".github/prompts/fix.prompt.md",
      ".github/skills/testing/SKILL.md",
      ".github/random.txt",
    ];
    const workspace = fakeWorkspace(files, true);
    const persistence = new DelegationPersistenceStore();
    await persistence.initialize();
    const service = new CopilotCustomizationService(workspace, persistence);
    const task = { id: crypto.randomUUID(), expectedFiles: ["src/index.ts"] } as DevelopmentTask;
    const items = await service.discover(task);
    expect(items.map((item) => item.kind).sort()).toEqual([
      "agent",
      "instruction",
      "instruction",
      "path-instruction",
      "prompt",
      "skill",
    ]);
    expect(items.find((item) => item.kind === "path-instruction")).toMatchObject({
      applicable: true,
      trustState: "trusted",
    });
    const prompt = items.find((item) => item.kind === "prompt")!;
    await service.select(task.id, prompt.id, false);
    expect((await service.discover(task)).find((item) => item.id === prompt.id)?.selected).toBe(
      false,
    );
  });

  it("marks discovered items unavailable in an untrusted workspace", async () => {
    const persistence = new DelegationPersistenceStore();
    await persistence.initialize();
    const items = await new CopilotCustomizationService(
      fakeWorkspace(["AGENTS.md"], false),
      persistence,
    ).discover({ id: crypto.randomUUID(), expectedFiles: [] } as unknown as DevelopmentTask);
    expect(items[0]).toMatchObject({ enabled: false, trustState: "untrusted" });
  });
});

function fakeWorkspace(paths: string[], trusted: boolean): WorkspaceAdapter {
  const root = { name: "fixture", uri: "file:///fixture" };
  const references: WorkspaceFileReference[] = paths.map((relativePath) => ({
    root,
    relativePath,
    uri: `file:///fixture/${relativePath}`,
  }));
  return {
    getRoots: () => [root],
    getWorkspaceId: () => "fixture",
    getWorkspaceRoot: () => root.uri,
    isTrusted: () => trusted,
    listFiles: () => Promise.resolve(references),
    resolveFile: () => undefined,
    fileReference: (_root, relativePath) => ({
      root,
      relativePath,
      uri: `file:///fixture/${relativePath}`,
    }),
    statFile: () =>
      Promise.resolve({ byteSize: 10, modifiedAt: new Date().toISOString(), type: "file" }),
    readFile: () => Promise.resolve(new Uint8Array()),
    readTextFile: (uri) => Promise.resolve(`# ${uri.split("/").at(-1)}\nSupported guidance`),
    getIndexingConfiguration: () => ({
      enabled: true,
      onWorkspaceOpen: true,
      onBranchChange: true,
      maxFiles: 1000,
      maxFileSizeBytes: 1000,
      workerCount: 1,
      retainedGenerations: 2,
      exclusions: [],
    }),
    getConfiguration: () => ({ get: <T>(_key: string, defaultValue: T) => defaultValue }),
  };
}
