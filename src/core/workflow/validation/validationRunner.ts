import { exec } from "node:child_process";

import { parseValidationOutput, type ParsedValidationSummary } from "./validationParser";
import type { FailureRemediationProposal } from "../quality/failureRemediation";

export type ValidationRunResult = {
  command: string;
  status: "passed" | "failed";
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
  durationMs: number;
  summary: ParsedValidationSummary;
  remediation?: FailureRemediationProposal[];
};

export type CommandExecutor = (
  command: string,
  options: { cwd: string; timeoutMs: number }
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export async function runValidationCommand(
  command: string,
  cwd: string,
  timeoutMs: number,
  executor: CommandExecutor = nodeCommandExecutor
): Promise<ValidationRunResult> {
  const startedAt = Date.now();

  try {
    const result = await executor(command, { cwd, timeoutMs });
    const stdout = trimOutput(result.stdout);
    const stderr = trimOutput(result.stderr);
    return {
      command,
      status: result.exitCode === 0 ? "passed" : "failed",
      exitCode: result.exitCode,
      stdout,
      stderr,
      durationMs: Date.now() - startedAt,
      summary: parseValidationOutput(stdout, stderr)
    };
  } catch (error) {
    const stderr = error instanceof Error ? error.message : "Unknown validation execution error.";
    return {
      command,
      status: "failed",
      exitCode: undefined,
      stdout: "",
      stderr,
      durationMs: Date.now() - startedAt,
      summary: parseValidationOutput("", stderr)
    };
  }
}

const nodeCommandExecutor: CommandExecutor = (command, options) =>
  new Promise((resolve) => {
    exec(
      command,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        const exitCode = error
          ? typeof error === "object" && "code" in error && typeof error.code === "number"
            ? error.code
            : 1
          : 0;

        resolve({ exitCode, stdout, stderr });
      }
    );
  });

function trimOutput(value: string): string {
  return value.length > 4000 ? `${value.slice(0, 4000)}\n[truncated]` : value;
}
