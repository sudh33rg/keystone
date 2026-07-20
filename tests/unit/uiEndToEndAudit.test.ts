import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("final UI architecture audit", () => {
  it("keeps exactly four primary destinations and no standalone lifecycle products", () => {
    const navigation = read("src/shared/navigation.ts");
    expect(navigation).toContain('label: "Home"');
    expect(navigation).toContain('label: "Active Work"');
    expect(navigation).toContain('label: "Intelligence"');
    expect(navigation).toContain('label: "History"');
    for (const obsolete of ["Intent & Specs", "Active Workflow", "Validation & QA", 'label: "Delivery"', 'label: "Task Handoff"'])
      expect(navigation).not.toContain(obsolete);
  });

  it("lazy-loads the three heavy secondary routes", () => {
    const app = read("src/ui/App.tsx");
    expect(app).toContain('lazy(async () =>');
    expect(app).toContain('import("./components/workbench/SDLCWorkbench")');
    expect(app).toContain('import("./components/intelligence/IntelligenceOverview")');
    expect(app).toContain('import("./components/history/HistoryWorkspace")');
    expect(app).not.toContain('import { SDLCWorkbench } from');
    expect(app).not.toContain('import { IntelligenceOverview } from');
  });

  it("retains accessible narrow, high-contrast, and reduced-motion contracts", () => {
    const css = read("src/ui/styles/global.css");
    expect(css).toContain("@media (max-width: 480px)");
    expect(css).toContain("@media (forced-colors: active)");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("min-width: 0");
    expect(css).toContain("var(--vscode-testing-iconPassed");
    expect(css).toContain("var(--vscode-notificationsWarningIcon-foreground");
  });

  it("scopes Validate to its workflow and uses the shared error shape", () => {
    const validate = read("src/ui/components/execution/ExecutionValidationWorkspace.tsx");
    const home = read("src/ui/components/home/HomeDashboard.tsx");
    const app = read("src/ui/App.tsx");
    expect(validate).toContain("item.workflowId === workflowId");
    expect(validate).toContain("No validation session for this workflow");
    expect(home).toContain("instance?.progress.failedTasks");
    expect(home).toContain("overview?.repository?.branch");
    expect(app).toContain("UiErrorState");
  });

  it("contains no obsolete contributed view", () => {
    const manifest = JSON.parse(read("package.json")) as { contributes: { viewsContainers: { activitybar: unknown[] }; views: Record<string, Array<{ id: string }>> } };
    expect(manifest.contributes.viewsContainers.activitybar).toHaveLength(1);
    expect((manifest.contributes.views.keystone ?? []).map((view) => view.id)).toEqual(["keystone.dashboard", "keystone.explorer"]);
  });
});
