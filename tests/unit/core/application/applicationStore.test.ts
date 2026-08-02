import { describe, expect, it } from "../../../support/testkit";
import { ApplicationStore } from "@core/application/applicationStore";
describe("ApplicationStore", () => {
  it("versions and broadcasts shared state", () => {
    const store = new ApplicationStore();
    const versions: number[] = [];
    store.subscribe((s) => versions.push(s.version));
    store.update({ status: "ready" });
    expect(versions).toEqual([1, 2]);
    expect(store.snapshot().status).toBe("ready");
  });
});
