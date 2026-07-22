import { describe, expect, it } from "vitest";
import { PRIMARY_NAVIGATION, sectionForRoute } from "../../src/shared/navigation";

describe("product navigation", () => {
  it("exposes only the four workflow-oriented primary destinations", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual([
      "Home",
      "Active Work",
      "Intelligence",
      "History",
    ]);
  });

  it("routes all active sections to the correct navigation section", () => {
    expect(sectionForRoute("/active-work")).toBe("active-work");
    expect(sectionForRoute("/intelligence")).toBe("intelligence");
    expect(sectionForRoute("/history")).toBe("history");
    expect(sectionForRoute("/")).toBe("home");
  });
});
