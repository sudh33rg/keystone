import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import {
  BundleExportRequestSchema,
  BundleExportResultSchema,
  SupportBundleSchema,
  type BundleExportRequest,
  type BundleExportResult,
  type SupportBundle,
} from "../../shared/contracts/supportBundle";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import { WorkspaceStateStore } from "../persistence/WorkspaceStateStore";

/**
 * SupportBundleService exports a debugging bundle for issues.
 */
export class SupportBundleService {
  constructor(
    private readonly store: WorkspaceStateStore,
    private readonly logger: KeystoneLogger,
  ) {}

  /**
   * Export a support bundle.
   */
  async export(
    request: BundleExportRequest,
  ): Promise<BundleExportResult> {
    const bundle = await this.createBundle(request);
    const size = this.estimateSize(bundle);

    return BundleExportResultSchema.parse({ bundle, sizeBytes: size });
  }

  /**
   * Create a support bundle from the current state.
   */
  private async createBundle(
    request: BundleExportRequest,
  ): Promise<SupportBundle> {
    const now = new Date().toISOString();

    const extensionInfo = await this.getExtensionInfo();
    const vscodeInfo = await this.getVsCodeInfo();
    const osInfo = await this.getOsInfo();
    const languageSummary = await this.getLanguageSummary();
    const schemaVersions = this.getSchemaVersions();
    const capabilityAvailability = await this.getCapabilityAvailability();
    const recentErrors = this.getRecentErrors();
    const activitySummaries = this.getActivitySummaries();
    const migrationWarnings = this.getMigrationWarnings();
    const performanceTimings = await this.getPerformanceTimings();
    const redactedConfig = this.getRedactedConfig();
    const logs = this.getLogs(request.includeRawLogs);

    return SupportBundleSchema.parse({
      id: crypto.randomUUID(),
      extensionVersion: extensionInfo.version,
      vscodeVersion: vscodeInfo.version,
      operatingSystem: osInfo.name,
      repositoryLanguageSummary: languageSummary,
      schemaVersions,
      capabilityAvailability,
      recentErrors,
      activitySummaries,
      migrationWarnings,
      performanceTimings,
      redactedConfig,
      logs,
      createdAt: now,
    });
  }

  /**
   * Get extension version information.
   */
  private async getExtensionInfo(): Promise<{ version: string }> {
    const packageJsonPath = join(__dirname, "../../../package.json");
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
      return { version: packageJson.version ?? "unknown" };
    } catch {
      return { version: "unknown" };
    }
  }

  /**
   * Get VS Code version information.
   */
  private async getVsCodeInfo(): Promise<{ version: string }> {
    try {
      const vscodePath = join(process.env.VSCODE_INSTALL_PATH ?? "/Applications/Visual Studio Code.app/Contents/Resources/app", "package.json");
      const packageJson = JSON.parse(await readFile(vscodePath, "utf8"));
      return { version: packageJson.version ?? "unknown" };
    } catch {
      return { version: "unknown" };
    }
  }

  /**
   * Get OS information.
   */
  private getOsInfo(): { name: string; platform: string } {
    return {
      name: process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux",
      platform: process.platform,
    };
  }

  /**
   * Get language summary from the intelligence snapshot.
   */
  private async getLanguageSummary(): Promise<string> {
    const snapshot = this.store.snapshot;
    const languages = new Map<string, { count: number; files: number; symbols: number }>();

    for (const file of snapshot.freshnessRecords ?? []) {
      if (file.recordType === "source-file") {
        const ext = file.recordId.split(".").pop()?.toLowerCase();
        if (ext) {
          const key = `.${ext}`;
          const entry = languages.get(key) ?? { count: 0, files: 0, symbols: 0 };
          entry.count++;
          entry.files++;
          languages.set(key, entry);
        }
      }
    }

    return Array.from(languages.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([lang, stats]) => `${stats.count} files, ${stats.files} scanned, ${stats.symbols} symbols`)
      .join("; ");
  }

  /**
   * Get schema versions from various stores.
   */
  private getSchemaVersions(): Record<string, string> {
    return {
      foundationState: this.store.snapshot.schemaVersion?.toString() ?? "unknown",
    };
  }

  /**
   * Get capability availability.
   */
  private async getCapabilityAvailability(): Promise<Record<string, boolean>> {
    const capabilities = this.store.snapshot.capabilities ?? {};
    return structuredClone(capabilities);
  }

  /**
   * Get recent errors from logs.
   */
  private getRecentErrors(): Array<{ category: string; title: string; message: string }> {
    const errors: Array<{ category: string; title: string; message: string }> = [];
    const errorLines = this.logger.lines.filter((line) => line.level === "error");
    for (const line of errorLines.slice(-100)) {
      errors.push({
        category: line.operation ?? "unknown",
        title: line.code ?? "unknown-error",
        message: line.message ?? "",
      });
    }
    return errors;
  }

  /**
   * Get activity summaries.
   */
  private getActivitySummaries(): Array<{ category: string; title: string; level: string; message: string }> {
    const summaries: Array<{ category: string; title: string; level: string; message: string }> = [];
    const activeActivities = this.store.snapshot.activityRecords ?? [];
    for (const activity of activeActivities.slice(-20)) {
      summaries.push({
        category: activity.category ?? "unknown",
        title: activity.title ?? "unknown activity",
        level: activity.status === "completed" ? "info" : activity.status === "failed" ? "error" : "warning",
        message: `${activity.status} — ${activity.currentAction}`,
      });
    }
    return summaries;
  }

  /**
   * Get migration warnings.
   */
  private getMigrationWarnings(): Array<{ category: string; title: string; level: string; message: string }> {
    const warnings: Array<{ category: string; title: string; level: string; message: string }> = [];
    for (const warning of this.store.snapshot.migrationWarnings ?? []) {
      warnings.push({
        category: warning.code ?? "unknown",
        title: warning.title ?? "unknown warning",
        level: warning.severity === "error" ? "error" : warning.severity === "warning" ? "warning" : "info",
        message: warning.message ?? "",
      });
    }
    return warnings;
  }

  /**
   * Get performance timings.
   */
  private async getPerformanceTimings(): Promise<Record<string, number>> {
    const timings: Record<string, number> = {};
    const activationStart = this.store.snapshot.activationStart ?? 0;
    const activationEnd = this.store.snapshot.activationEnd ?? 0;
    if (activationStart !== 0 && activationEnd !== 0) {
      timings.activation = Math.round(activationEnd - activationStart);
    }
    return timings;
  }

  /**
   * Get redacted configuration.
   */
  private getRedactedConfig(): string {
    const config = this.store.snapshot.configuration ?? {};
    const read = (path: string) => {
      const parts = path.split(".");
      let value: unknown = config;
      for (const part of parts) {
        if (value && typeof value === "object" && part in value) {
          value = value[part];
        } else {
          return undefined;
        }
      }
      return value;
    };

    const sections: Record<string, string> = {
      "agent-profiles": JSON.stringify(
        Object.fromEntries(
          Object.entries(config.agentProfiles ?? {}).filter(([_, v]) => typeof v === "object"),
        ),
        null,
        2,
      ),
      "execution-profiles": JSON.stringify(
        Object.fromEntries(
          Object.entries(config.executionProfiles ?? {}).filter(([_, v]) => typeof v === "object"),
        ),
        null,
        2,
      ),
      "instructions": JSON.stringify(config.instructions ?? {}, null, 2),
      "skills": JSON.stringify(config.skills ?? {}, null, 2),
      "routing": JSON.stringify(config.routing ?? {}, null, 2),
      "orchestration": JSON.stringify(config.orchestration ?? {}, null, 2),
    };

    return Object.entries(sections)
      .map(([section, value]) => `${section}:\n${value}`)
      .join("\n\n");
  }

  /**
   * Get logs.
   */
  private getLogs(includeRawLogs: boolean): string {
    const lines = this.logger.lines.slice(-1000);
    return lines.map((line) => `${line.timestamp} [${line.level} ${line.operation}] ${line.message}`).join("\n");
  }

  /**
   * Estimate the size of a bundle.
   */
  private estimateSize(bundle: SupportBundle): number {
    let size = 0;
    for (const key of Object.keys(bundle)) {
      const value = bundle[key as keyof SupportBundle];
      if (typeof value === "string") size += Buffer.byteLength(value, "utf8");
      else if (typeof value === "number") size += 8;
      else if (typeof value === "boolean") size += 1;
      else if (Array.isArray(value)) {
        for (const item of value) {
          size += this.estimateSize(item);
        }
      } else if (typeof value === "object") {
        for (const item of Object.values(value)) {
          size += this.estimateSize(item);
        }
      }
    }
    return size;
  }
}
