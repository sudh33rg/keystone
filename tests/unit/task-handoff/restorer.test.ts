import { describe, expect, it, vi } from '../../support/testkit';
import { MANUAL_SYNC_CONFIRMATION } from "../../../src/core/workflow/handoff/contracts";
import { TaskStateRestorer, compareRepositoryGuidance, continuationBriefing } from "../../../src/extension/task-handoff/taskStateRestorer";
import { TaskStatePackageBuilder } from "../../../src/core/workflow/handoff/taskStatePackage";
import { readFileSync } from "node:fs";
describe("task-state restorer", () => {
  it("warns but does not block repository mismatch", () => expect(compareRepositoryGuidance({ repositoryName: "expected" }, { name: "other" })[0]).toMatch(/does not block/));
  it("contains no Git execution primitive", () => { const source = readFileSync("src/extension/task-handoff/taskStateRestorer.ts", "utf8"); expect(source).not.toMatch(/execFile|spawn\(|git\s+(checkout|pull|fetch|push|commit)/); });
  it("requires the exact manual confirmation before metadata restore", async () => { const store = { save: vi.fn(async () => undefined) }; const restorer = new TaskStateRestorer(store); const fake: any = { repositoryReference: { repositoryName: "x" } }; await expect(restorer.restore({ packageValue: fake, warnings: [], continuationBriefing: "" }, "yes")).rejects.toThrow(/Manual Repository Sync/); await restorer.restore({ packageValue: fake, warnings: [], continuationBriefing: "" }, MANUAL_SYNC_CONFIRMATION); expect(store.save).toHaveBeenCalledOnce(); });
});
