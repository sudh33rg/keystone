import type * as vscode from "vscode";
import type { LogLevel } from "../../core/configuration/ConfigurationService";
import type { KeystoneError } from "../errors/KeystoneError";
import { redact } from "./redaction";

const priority: Record<LogLevel, number> = { debug: 10, info: 20, warning: 30, error: 40 };

export class KeystoneLogger {
  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly minimumLevel: () => LogLevel
  ) {}

  debug(operation: string, message: string, details?: unknown): void {
    this.write("debug", operation, message, details);
  }

  info(operation: string, message: string, details?: unknown): void {
    this.write("info", operation, message, details);
  }

  warning(operation: string, message: string, details?: unknown): void {
    this.write("warning", operation, message, details);
  }

  error(error: KeystoneError): void {
    this.write("error", error.operation, error.message, error.serialize());
  }

  show(): void {
    this.output.show(true);
  }

  dispose(): void {
    this.output.dispose();
  }

  private write(level: LogLevel, operation: string, message: string, details?: unknown): void {
    if (priority[level] < priority[this.minimumLevel()]) return;
    const suffix = details === undefined ? "" : ` ${redact(details)}`;
    this.output.appendLine(`${new Date().toISOString()} [${level.toUpperCase()}] [${operation}] ${redact(message)}${suffix}`);
  }
}
