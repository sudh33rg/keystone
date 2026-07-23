import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("NoDeliveryUi", () => {
  it("HostBridge protocol surface has no delivery/* or remote-PR request channels", async () => {
    const source = await readFile("src/ui/services/HostBridge.ts", "utf-8");
    expect(source, "HostBridge must not register delivery/* channels").not.toMatch(
      /delivery\s*:/,
    );
    expect(source, "HostBridge must not register complete/preparePr").not.toMatch(
      /complete\/preparePr/,
    );
    expect(source, "HostBridge must not register complete/createPr").not.toMatch(
      /complete\/createPr/,
    );
    expect(source, "HostBridge must not register complete/push").not.toMatch(
      /complete\/push/,
    );
    expect(source, "HostBridge must not register pullRequest/create").not.toMatch(
      /pullRequest\/create/,
    );
  });
});
