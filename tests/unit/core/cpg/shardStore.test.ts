import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "../../../support/testkit";
import { buildTypeScriptCpg, CpgShardStore } from "@core/intelligence/cpg";

const roots: string[] = [];
afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

describe("CpgShardStore", () => {
  it("writes compressed shards atomically, reuses unchanged content, and removes stale shards", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "keystone-cpg-shards-"));
    roots.push(root);
    const first = new CpgShardStore(root);
    await first.put(buildTypeScriptCpg({ sourcePath: "a.ts", content: "export const a = 1;" }));
    await first.put(buildTypeScriptCpg({ sourcePath: "b.ts", content: "export const b = 2;" }));
    expect(await first.finalize()).toEqual(
      expect.objectContaining({ written: 2, reused: 0, deleted: 0 })
    );

    const second = new CpgShardStore(root);
    await second.put(buildTypeScriptCpg({ sourcePath: "a.ts", content: "export const a = 1;" }));
    const result = await second.finalize();
    expect(result).toEqual(expect.objectContaining({ written: 0, reused: 1, deleted: 1 }));
    expect(Object.keys(result.manifest.files)).toEqual(["a.ts"]);
    expect((await second.get("a.ts"))?.sourcePath).toBe("a.ts");
    expect(
      fs
        .readdirSync(path.join(root, ".keystone", "intelligence", "cpg"))
        .filter((file) => file.endsWith(".tmp"))
    ).toEqual([]);
  });
});
