import { PERFORMANCE_KEYWORDS } from "../../platform/config/defaults";

export function detectPerformanceSensitivePath(filePath: string, text: string): string[] {
  const haystack = `${filePath}\n${text}`.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  const matches = PERFORMANCE_KEYWORDS.filter((keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i").test(haystack);
  });
  if (/\b(?:for|while)\s*\([^)]*\)\s*\{[\s\S]{0,800}?\b(?:find|query|select|execute|fetch)\s*\(/i.test(text) || /\bfor\s+.+:\s*\n(?:\s+.+\n){0,8}\s*.*\b(?:session\.|\.objects\.)/i.test(text))
    matches.push("database operation inside loop");
  return [...new Set(matches)];
}
