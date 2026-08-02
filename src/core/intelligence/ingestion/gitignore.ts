import fs from "node:fs/promises";
import path from "node:path";

interface GitignoreRule {
  negated: boolean;
  directoryOnly: boolean;
  expression: RegExp;
}

/** A small, deterministic matcher for root .gitignore rules. */
export class GitignoreMatcher {
  private constructor(private readonly rules: readonly GitignoreRule[]) {}

  static fromText(text: string): GitignoreMatcher {
    const rules = text
      .split(/\r?\n/)
      .map(parseRule)
      .filter((rule): rule is GitignoreRule => rule !== undefined);
    return new GitignoreMatcher(rules);
  }

  isIgnored(relativePath: string, isDirectory: boolean): boolean {
    const normalized = relativePath.replaceAll(path.sep, "/").replace(/^\/+|\/+$/g, "");
    let ignored = false;
    for (const rule of this.rules) {
      if (rule.directoryOnly && !isDirectory) continue;
      if (rule.expression.test(normalized)) ignored = !rule.negated;
    }
    return ignored;
  }
}

export async function loadGitignore(workspaceRoot: string): Promise<GitignoreMatcher> {
  const contents = await fs
    .readFile(path.join(workspaceRoot, ".gitignore"), "utf8")
    .catch((error) => {
      if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? ""))
        return "";
      throw error;
    });
  return GitignoreMatcher.fromText(contents);
}

function parseRule(input: string): GitignoreRule | undefined {
  let line = input.replace(/\r$/, "").replace(/(?<!\\)\s+$/, "");
  if (!line.trim() || line.trimStart().startsWith("#")) return undefined;

  let negated = false;
  if (line.startsWith("!") && !line.startsWith("\\!")) {
    negated = true;
    line = line.slice(1);
  }
  if (line.startsWith("\\#") || line.startsWith("\\!")) line = line.slice(1);

  const directoryOnly = line.endsWith("/") && !line.endsWith("\\/");
  if (directoryOnly) line = line.slice(0, -1);
  const anchored = line.startsWith("/");
  if (anchored) line = line.replace(/^\/+/, "");
  if (!line) return undefined;

  return {
    negated,
    directoryOnly,
    expression: globExpression(line, anchored)
  };
}

function globExpression(pattern: string, anchored: boolean): RegExp {
  const hasSlash = pattern.includes("/");
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\" && index + 1 < pattern.length) {
      expression += escapeRegExp(pattern[index + 1]);
      index += 1;
    } else if (character === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        if (pattern[index + 1] === "/") {
          expression += "(?:.*/)?";
          index += 1;
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
    } else if (character === "?") {
      expression += "[^/]";
    } else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end === -1) expression += "\\[";
      else {
        expression += pattern.slice(index, end + 1);
        index = end;
      }
    } else {
      expression += escapeRegExp(character);
    }
  }

  if (!hasSlash && !anchored) return new RegExp(`(?:^|.*/)${expression}$`);
  return new RegExp(`^${expression}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.-]/g, "\\$&");
}
