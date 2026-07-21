// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActiveWork } from "../../src/ui/components/workbench/ActiveWork";
import type { HostBridge } from "../../src/ui/services/HostBridge";

afterEach(cleanup);

describe("ActiveWork", () => {
  it("renders a simple active work page", () => {
    const bridge = {} as HostBridge;
    render(<ActiveWork bridge={bridge} navigate={() => {}} />);
    expect(screen.getByRole("heading", { name: "Start new work" })).toBeInTheDocument();
  });
});
