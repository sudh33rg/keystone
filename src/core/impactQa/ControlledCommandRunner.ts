import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve, relative, sep } from "node:path";
import type { QaCommandResult, TestCommandDefinition } from "../../shared/contracts/impactQa";

export class ControlledCommandRunner {
  private readonly running = new Map<string, ChildProcessWithoutNullStreams>();
  constructor(private readonly workspaceRoot: string, private readonly maxOutputBytes = 200_000) {}
  async run(command: TestCommandDefinition, callbacks: { onOutput?: (chunk: string, source: "stdout" | "stderr") => void }): Promise<QaCommandResult> {
    this.validate(command); if (this.running.has(command.id)) throw Object.assign(new Error("This command is already running."), { code: "duplicate-execution" });
    const cwd = resolve(this.workspaceRoot, command.workingDirectory); const started = Date.now(); const startedAt = new Date().toISOString(); let raw = ""; let timedOut = false; let cancelled = false;
    return await new Promise<QaCommandResult>((complete, reject) => {
      let child: ChildProcessWithoutNullStreams;
      try { child = spawn(command.executable, command.arguments, { cwd, shell: false, env: process.env }); }
      catch (cause) { reject(Object.assign(new Error(`Command could not start: ${cause instanceof Error ? cause.message : String(cause)}`), { code: "command-start-failed" })); return; }
      this.running.set(command.id, child);
      const append = (source: "stdout" | "stderr", chunk: Buffer) => { const text = chunk.toString("utf8"); raw = (raw + text).slice(-this.maxOutputBytes); callbacks.onOutput?.(text, source); };
      child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk)); child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
      const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, command.timeoutMs);
      child.once("error", (cause) => { clearTimeout(timer); this.running.delete(command.id); reject(Object.assign(new Error(`Command could not start: ${cause.message}`), { code: "command-start-failed" })); });
      child.once("close", (exitCode, signal) => { clearTimeout(timer); this.running.delete(command.id); const completedAt = new Date().toISOString(); const externallyCancelled = signal === "SIGINT" || signal === "SIGKILL" || signal === "SIGTERM"; cancelled = !timedOut && externallyCancelled; complete({ id: crypto.randomUUID(), commandDefinitionId: command.id, status: timedOut ? "timed-out" : cancelled ? "cancelled" : exitCode === 0 ? "completed" : "failed", startedAt, completedAt, exitCode: exitCode ?? undefined, signal: signal ?? undefined, cancelled, timedOut, rawOutput: raw, durationMs: Date.now() - started }); });
    });
  }
  cancel(commandId: string): boolean { const child = this.running.get(commandId); if (!child) return false; child.kill("SIGTERM"); return true; }
  private validate(command: TestCommandDefinition): void { const cwd = resolve(this.workspaceRoot, command.workingDirectory); const rel = relative(resolve(this.workspaceRoot), cwd); if (rel === ".." || rel.startsWith(`..${sep}`) || resolve(this.workspaceRoot) === cwd && command.workingDirectory.includes("..")) throw Object.assign(new Error("Test working directory is outside the workspace."), { code: "test-command-unavailable" }); if (!command.executable.trim() || /[;&|`$\n\r]/.test(command.executable) || ["sh", "bash", "zsh", "cmd", "powershell", "pwsh"].includes(command.executable.toLowerCase()) || command.arguments.some((arg) => /[;&|`\n\r]/.test(arg))) throw Object.assign(new Error("Test command contains an unsafe shell fragment."), { code: "test-command-unavailable" }); if (command.timeoutMs < 10 || command.timeoutMs > 3_600_000) throw Object.assign(new Error("Test command timeout is invalid."), { code: "test-command-unavailable" }); }
}
