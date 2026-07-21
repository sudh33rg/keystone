import {
  AppRouteSchema,
  WorkbenchStageSchema,
  type AppRoute,
  type NavigationSection,
  type WorkbenchStage,
} from "./contracts/domain";

export const PRIMARY_NAVIGATION = [
  { id: "home", label: "Home", route: "/", icon: "home" },
  { id: "active-work", label: "Active Work", route: "/active-work", icon: "tasks" },
  { id: "intelligence", label: "Intelligence", route: "/intelligence", icon: "intelligence" },
  { id: "history", label: "History", route: "/history", icon: "pulse" },
] as const;

export const WORKBENCH_STAGES: readonly WorkbenchStage[] = WorkbenchStageSchema.options;

export interface WorkbenchRoute {
  kind: "new" | "workflow";
  workflowId?: string;
  stage?: WorkbenchStage;
}

export function workbenchRoute(workflowId: string, stage: WorkbenchStage): AppRoute {
  return AppRouteSchema.parse(`/workbench/${workflowId}/${stage}`);
}

export function parseWorkbenchRoute(route: AppRoute): WorkbenchRoute | undefined {
  if (route === "/workbench/new") return { kind: "new" };
  const match = /^\/workbench\/([0-9a-f-]+)\/(define|plan|build|validate|review|complete)$/.exec(
    route,
  );
  if (!match) return undefined;
  return { kind: "workflow", workflowId: match[1], stage: WorkbenchStageSchema.parse(match[2]) };
}

export function sectionForRoute(route: AppRoute): NavigationSection {
  if (route.startsWith("/workbench/")) return "active-work";
  if (route === "/intelligence") return "intelligence";
  if (route === "/history") return "history";
  if (route === "/settings") return "settings";
  return "home";
}

export function compatibilityRoute(section: NavigationSection, workflowId?: string): AppRoute {
  const selected = workflowId ?? "new";
  switch (section) {
    // New canonical navigation sections
    case "home":
      return "/";
    case "active-work":
      return "/workbench/new";
    case "intelligence":
      return "/intelligence";
    case "history":
      return "/history";
    case "settings":
      return "/settings";
    // Deprecated sections - redirect to new canonical routes
    case "intent":
    case "specifications":
      return selected === "new" ? "/workbench/new" : workbenchRoute(selected, "define");
    case "tasks":
      return selected === "new" ? "/workbench/new" : workbenchRoute(selected, "plan");
    case "context":
    case "orchestration":
      return selected === "new" ? "/workbench/new" : workbenchRoute(selected, "build");
    case "validation":
      return selected === "new" ? "/workbench/new" : workbenchRoute(selected, "validate");
    case "delivery":
      return selected === "new" ? "/workbench/new" : workbenchRoute(selected, "complete");
    case "team":
      return "/";
    case "diagnostics":
      return "/support/diagnostics";
    case "workbench":
      return "/workbench/new";
    default:
      return "/";
  }
}

export const COMPATIBILITY_REDIRECTS = {
  "/intent": "/workbench/new",
  "/specifications": "/workbench/new",
  "/tasks": "/workbench/new",
  "/active-workflow": "/workbench/new",
  "/validation": "/workbench/new",
  "/delivery": "/workbench/new",
  "/handoff": "/",
  "/diagnostics": "/support/diagnostics",
} as const;
