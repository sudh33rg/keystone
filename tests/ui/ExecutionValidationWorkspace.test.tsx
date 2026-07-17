// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExecutionValidationWorkspace } from "../../src/ui/components/execution/ExecutionValidationWorkspace";
import type { HostBridge } from "../../src/ui/services/HostBridge";

describe("ExecutionValidationWorkspace", () => {
  it("shows the honest prerequisite when no execution session exists", async () => { const request = vi.fn(() => Promise.resolve([])); render(<ExecutionValidationWorkspace bridge={{ request } as unknown as HostBridge}/>); expect(await screen.findByText("Start execution tracking from an approved delegation session first.")).toBeTruthy(); expect(request).toHaveBeenCalledWith("execution/list", {}); });
});
