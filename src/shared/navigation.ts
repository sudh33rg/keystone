import { AppRouteSchema, type AppRoute, type NavigationSection } from "./contracts/domain";

export const PRIMARY_NAVIGATION = [
  { id: "home", label: "Home", route: "/", icon: "home" },
  { id: "active-work", label: "Active Work", route: "/active-work", icon: "tasks" },
  { id: "intelligence", label: "Intelligence", route: "/intelligence", icon: "intelligence" },
  { id: "history", label: "History", route: "/history", icon: "pulse" },
] as const;

export function sectionForRoute(route: AppRoute): NavigationSection {
  if (route === "/intelligence") return "intelligence";
  if (route === "/history") return "history";
  if (route === "/settings") return "settings";
  if (route === "/active-work") return "active-work";
  return "home";
}
