// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";

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

describe("ActiveWork empty state", () => {
  it("renders the truthful empty state when no workflow exists", async () => {
    render(<ActiveWork bridge={fakeBridge()} navigate={() => {}} />);
    expect(await screen.findByRole("heading", { name: "No active workflow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Start workflow/i })).toBeNull();
  });
});
