// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PRIMARY_NAVIGATION, sectionForRoute } from "../../src/shared/navigation";
import { AppRouteSchema } from "../../src/shared/contracts/domain";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";
import type { DevelopmentWorkflowSnapshot } from "../../src/shared/contracts/delegation";
import { ContextualBlockerList } from "../../src/ui/components/ContextualBlocker";

function fakeBridge(): HostBridge {
  const bridge = {
    request: (type: string) => {
      if (type === "workflow/get") return Promise.resolve(undefined);
      if (type === "workflow/list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    },
    subscribe: () => () => undefined,
  };
  return bridge as unknown as HostBridge;
}

describe("Phase 10 route consolidation", () => {
  it("exposes only the four canonical primary destinations", () => {
    expect(PRIMARY_NAVIGATION.map((item) => item.label)).toEqual([
      "Home",
      "Active Work",
      "Intelligence",
      "History",
    ]);
    expect(
      PRIMARY_NAVIGATION.every((item) =>
        ["/", "/active-work", "/intelligence", "/history"].includes(item.route),
      ),
    ).toBe(true);
  });

  it("accepts canonical routes and rejects removed obsolete surfaces", () => {
    for (const route of ["/", "/active-work", "/intelligence", "/history", "/workbench/new"]) {
      expect(AppRouteSchema.safeParse(route).success).toBe(true);
    }
    // The legacy Diagnostics and Settings surfaces were removed in Phase 10
    // consolidation; primary navigation is now only Home/Active Work/Intelligence/History.
    for (const removed of ["/settings", "/support/diagnostics"]) {
      expect(AppRouteSchema.safeParse(removed).success).toBe(false);
    }
  });

  it("maps sections consistently with the route schema", () => {
    expect(sectionForRoute("/")).toBe("home");
    expect(sectionForRoute("/active-work")).toBe("active-work");
    expect(sectionForRoute("/intelligence")).toBe("intelligence");
    expect(sectionForRoute("/history")).toBe("history");
  });
});

describe("Active Work recovery/blocker/empty-state UX", () => {
  it("renders the truthful empty state when no workflow exists", async () => {
    render(<ActiveWork bridge={fakeBridge()} navigate={() => {}} />);
    expect(await screen.findByRole("heading", { name: "No active workflow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start workflow/i })).toBeNull();
  });

  it("renders contextual blockers derived from real snapshot state", () => {
    render(
      <ContextualBlockerList
        blockers={[
          {
            id: "workflow-stale",
            category: "stale-data",
            title: "Workflow data is stale",
            detail: "Stale.",
            resolution: "Refresh.",
          },
        ]}
      />,
    );
    expect(document.querySelector(".contextual-blocker")).toBeTruthy();
    expect(screen.getByText("Workflow data is stale")).toBeTruthy();
  });
});
