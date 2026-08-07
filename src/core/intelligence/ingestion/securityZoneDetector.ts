import { SECURITY_KEYWORDS } from "../../platform/config/defaults";

export function detectSecuritySensitiveArea(filePath: string, text: string): string[] {
  const matches = matchKeywords(`${filePath}\n${text}`, SECURITY_KEYWORDS);
  if (/@(PreAuthorize|RolesAllowed|UseGuards|login_required)\b|\b(?:Depends|authorize|requireAuth)\s*\(/.test(text))
    matches.push("explicit authorization boundary");
  return [...new Set(matches)];
}

function matchKeywords(haystack: string, keywords: string[]): string[] {
  const normalized = haystack.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return keywords.filter((keyword) => keywordPattern(keyword).test(normalized));
}

function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "i");
}
