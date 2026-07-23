import { describe, expect, it } from "vitest";

describe("ExcludedGitProtocol", () => {
  it("messages schema does not expose banned git mutation events", async () => {
    const mod = await import("../../../src/shared/contracts/messages");
    const keys = Object.keys(mod);
    const banned = ["complete/changeSetChanged", "complete/commitCreated", "complete/pushCompleted", "complete/prCreated", "complete/patchExported"];
    for (const b of banned) {
      const found = keys.some((k) => k.toLowerCase().includes(b.toLowerCase()));
      expect(found, `banned event present: ${b}`).toBe(false);
    }
  });

  it("router dispatch registry binds to repository (read-only) rather than delivery", async () => {
    const source = await import("fs").then((fs) =>
      fs.promises.readFile("src/extension/webview/WebviewMessageRouter.ts", "utf-8"),
    );
    expect(source).not.toMatch(/delivery\s*:/);
    expect(source).toMatch(/repository\s*:/);
  });
});
