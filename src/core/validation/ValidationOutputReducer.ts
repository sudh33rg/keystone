import { z } from "zod";

export type OutputReducerRule = {
  readonly id: string;
  readonly priority: number;
  readonly appliesTo: readonly string[];
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly maxContextChars: number;
};

export const OutputReducerRuleSchema = z.object({
  id: z.string().min(1).max(200),
  priority: z.number().int().nonnegative(),
  appliesTo: z.array(z.string().max(200)).max(50),
  pattern: z.string().min(1).max(2000),
  replacement: z.string().min(1).max(2000),
  maxContextChars: z.number().int().nonnegative().max(100_000).default(20_000),
});

export type OutputReducerInput = {
  readonly tool: string;
  readonly output: string;
  readonly errorOutput?: string;
};

export type OutputReducerResult = {
  readonly reducedOutput: string;
  readonly reducedErrorOutput: string;
  readonly ruleIds: string[];
  readonly truncated: boolean;
};

const DEFAULT_MAX_CONTEXT_CHARS = 20_000;

const RULES: readonly OutputReducerRule[] = [
  {
    id: "context-summary",
    priority: 10,
    appliesTo: ["*"],
    pattern: /Context \d+ of \d+: .*/g,
    replacement: "[context summary omitted]",
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
  },
  {
    id: "tool-summary",
    priority: 20,
    appliesTo: ["*"],
    pattern: /@.*-github\/.*-\d+\.\d+\.\d+.*/g,
    replacement: "[tool summary omitted]",
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
  },
  {
    id: "redundant-tool-identity",
    priority: 30,
    appliesTo: ["*"],
    pattern: /in \/Users\/sudheer\/workspace\/keystone/gi,
    replacement: "in this project",
    maxContextChars: DEFAULT_MAX_CONTEXT_CHARS,
  },
];

export class ValidationOutputReducer {
  private readonly rules: readonly OutputReducerRule[];

  constructor(rules: readonly OutputReducerRule[] = RULES) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
  }

  reduce(input: OutputReducerInput): OutputReducerResult {
    const sourceTexts = [input.output, input.errorOutput ?? ""];
    const reduced = sourceTexts.map((text) => this.applyRules(input.tool, text));
    const allRuleIds = Array.from(new Set(reduced.flatMap((result) => result.ruleIds)));
    const truncated = reduced.some((result) => result.truncated);

    return {
      reducedOutput: reduced[0]?.text ? reduced[0].text : input.output,
      reducedErrorOutput: reduced[1]?.text ? reduced[1].text : (input.errorOutput ?? ""),
      ruleIds: allRuleIds,
      truncated,
    };
  }

  reduceText(tool: string, output: string, errorOutput = ""): string {
    return this.reduce({ tool, output, errorOutput }).reducedOutput;
  }

  private applyRules(
    tool: string,
    text: string,
  ): { text: string; ruleIds: string[]; truncated: boolean } {
    let current = text;
    const applied: string[] = [];
    let truncated = current.length > DEFAULT_MAX_CONTEXT_CHARS;

    if (!current) {
      return { text: current, ruleIds: applied, truncated };
    }

    for (const rule of this.rules) {
      if (!rule.appliesTo.includes("*") && !rule.appliesTo.some((candidate) => tool.includes(candidate))) continue;
      const next = current.replace(rule.pattern, rule.replacement);
      if (next !== current) {
        applied.push(rule.id);
        current = next;
      }
    }

    if (current.length > DEFAULT_MAX_CONTEXT_CHARS) {
      current = `${current.slice(0, DEFAULT_MAX_CONTEXT_CHARS)}\n... [truncated]\n`;
      truncated = true;
    }

    return { text: current, ruleIds: applied, truncated };
  }
}
