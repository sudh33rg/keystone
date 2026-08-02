import { describe, expect, it } from "../../../support/testkit";
import { LanguageCapabilityRegistry } from "@core/intelligence/languages/languageRegistry";
describe("LanguageCapabilityRegistry", () => {
  it("identifies broad language coverage", () => {
    const registry = new LanguageCapabilityRegistry();
    expect(registry.identify("main.py")?.id).toBe("python");
    expect(registry.identify("main.cpp")?.id).toBe("cpp");
    expect(registry.all().length).toBeGreaterThan(30);
  });
});
