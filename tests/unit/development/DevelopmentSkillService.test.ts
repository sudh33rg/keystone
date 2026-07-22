import { describe, expect, it } from "vitest";
import { DevelopmentSkillService } from "../../../src/core/development/DevelopmentSkillService";

describe("DevelopmentSkillService", () => {
  it("loads one real Development-applicable persisted definition with stable prompt content", () => {
    const service = new DevelopmentSkillService();
    const first = service.builtInDevelopmentSkill();
    const second = service.builtInDevelopmentSkill();
    expect(first).toMatchObject({ id: "keystone-development", applicableStageTypes: ["development"], source: "keystone-built-in" });
    expect(first.promptFragment).toContain("list files changed");
    expect(first.contentHash).toBe(second.contentHash);
    expect(service.list([first, { ...first, id: "qa", name: "QA", applicableStageTypes: ["qa"] }])).toEqual([first]);
  });

  it("rejects missing and duplicate skill definitions", () => {
    const service = new DevelopmentSkillService(); const skill = service.builtInDevelopmentSkill();
    expect(() => service.require([], "missing")).toThrowError(/not found/i);
    expect(() => service.list([skill, { ...skill }])).toThrowError(/duplicate/i);
  });

  it("changes the content hash when persisted prompt content changes", () => {
    const service = new DevelopmentSkillService(); const skill = service.builtInDevelopmentSkill();
    expect(service.withHash({ ...skill, promptFragment: `${skill.promptFragment}\nReport API compatibility.` }).contentHash).not.toBe(skill.contentHash);
  });
});
