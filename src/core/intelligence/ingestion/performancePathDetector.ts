import { PERFORMANCE_KEYWORDS } from "../../platform/config/defaults";

export function detectPerformanceSensitivePath(filePath: string, text: string): string[] {
  const haystack = `${filePath}\n${text}`.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return PERFORMANCE_KEYWORDS.filter((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i").test(haystack);
  });
}
