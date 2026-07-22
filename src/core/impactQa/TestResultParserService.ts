import type { NormalizedTestResult } from "../../shared/contracts/impactQa";

export class TestResultParserService {
  parse(framework: string, stdout: string, stderr: string, exitCode?: number): NormalizedTestResult {
    const output = `${stdout}\n${stderr}`; if (/vitest/i.test(framework)) return parseVitest(output, exitCode);
    return { framework, suites: {}, tests: {}, failures: exitCode && stderr.trim() ? [{ message: stderr.trim().slice(0, 5000), stackFrames: stderr.split(/\r?\n/).filter((line) => /\bat\s/.test(line)).slice(0, 20) }] : [], parseStatus: "unparsed" };
  }
}
function parseVitest(output: string, exitCode?: number): NormalizedTestResult { const suites = counts(output.match(/Test Files\s+([^\n]+)/i)?.[1]); const tests = counts(output.match(/(?:^|\n)\s*Tests\s+([^\n]+)/i)?.[1]); const duration = output.match(/Duration\s+([\d.]+)\s*(ms|s)/i); const failures = [...output.matchAll(/FAIL\s+([^\n]+)(?:\n+([^\n]+))?/g)].map((match) => ({ name: match[1]?.trim(), message: match[2]?.trim() || "Test failed", stackFrames: [] })); return { framework: "vitest", suites, tests, failures, durationMs: duration ? Math.round(Number(duration[1]) * (duration[2]?.toLowerCase() === "s" ? 1000 : 1)) : undefined, parseStatus: Object.keys(tests).length || Object.keys(suites).length ? "parsed" : exitCode === 0 ? "partially-parsed" : "unparsed" }; }
function counts(value?: string): NormalizedTestResult["tests"] { if (!value) return {}; const passed = numberBefore(value, "passed"); const failed = numberBefore(value, "failed"); const skipped = numberBefore(value, "skipped"); const total = Number(value.match(/\((\d+)\)/)?.[1] ?? ((passed ?? 0) + (failed ?? 0) + (skipped ?? 0))) || undefined; return { ...(total !== undefined ? { total } : {}), ...(passed !== undefined ? { passed } : {}), ...(failed !== undefined ? { failed } : {}), ...(skipped !== undefined ? { skipped } : {}) }; }
function numberBefore(value: string, word: string): number | undefined { const match = value.match(new RegExp(`(\\d+)\\s+${word}`, "i")); return match ? Number(match[1]) : undefined; }
