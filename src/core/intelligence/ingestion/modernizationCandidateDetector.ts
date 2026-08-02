import { MODERNIZATION_KEYWORDS } from "../../platform/config/defaults";

export function detectModernizationCandidates(
  filePath: string,
  text: string,
  lineCount: number
): string[] {
  const candidates: string[] = [];
  const lower = `${filePath}\n${text}`.toLowerCase();
  if (lineCount > 500) {
    candidates.push(`${filePath}: very large file (${lineCount} lines)`);
  }
  for (const keyword of MODERNIZATION_KEYWORDS) {
    if (lower.includes(keyword)) {
      candidates.push(`${filePath}: contains ${keyword} marker`);
    }
  }
  if (/controller/i.test(filePath) && /\b(db|database|query|repository)\b/i.test(text)) {
    candidates.push(`${filePath}: possible direct DB call in controller`);
  }
  return candidates;
}
