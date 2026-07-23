import type { AppRoute, NavigationSection } from "./contracts/domain";

export const PRIMARY_NAVIGATION = [
  { id: "home", label: "Home", route: "/", icon: "home" },
  { id: "active-work", label: "Work", route: "/active-work", icon: "tasks" },
  { id: "intelligence", label: "Intelligence", route: "/intelligence", icon: "intelligence" },
  { id: "history", label: "History", route: "/history", icon: "pulse" },
] as const;

export function sectionForRoute(route: AppRoute): NavigationSection {
  if (route === "/intelligence") return "intelligence";
  if (route === "/history") return "history";
  if (route === "/active-work" || route === "/workflow/new") return "active-work";
  return "home";
}

/**
 * Map a navigation section to its canonical route.
 */
export function routeForSection(section: NavigationSection): AppRoute {
  const entry = PRIMARY_NAVIGATION.find((n) => n.id === section);
  return (entry?.route ?? "/");
}
