import { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { SecurityPerformancePersistence } from "../persistence/SecurityPerformancePersistence";
import type {
  SecurityFindingWorker,
  SecurityPerformanceWorkerRun,
} from "../../shared/contracts/securityPerformanceWorker";

export interface SecurityPerformanceWorkerOptions {
  root: string;
  changedFiles: string[];
  diffSummary?: {
    totalFiles: number;
    totalAdditions: number;
    totalDeletions: number;
  };
  log?: (message: string) => void;
  scanFile?: (file: string) => Promise<{
    file: string;
    findings: Array<{
      category: string;
      severity: "info" | "low" | "medium" | "high" | "critical";
      confidence: number;
      title: string;
      description: string;
      recommendation?: string;
      evidence?: string[];
      status?: "open" | "resolved" | "accepted-risk" | "false-positive" | "deferred";
      location?: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        ruleId?: string;
        tool?: string;
        cwe?: string;
        owasp?: string;
      };
    }>;
  }>;
}

export class SecurityPerformanceWorker {
  constructor(private readonly services: { persistence: SecurityPerformancePersistence; logger: KeystoneLogger }) {}

  async runSecurityScan(options: SecurityPerformanceWorkerOptions): Promise<{
    id: string;
    status: string;
    startedAt: string;
    filesScanned: number;
    findingsCount: number;
    findings: SecurityFindingWorker[];
    errors: string[];
    diagnostics: string[];
  }> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const runId = `security-${id}`;
    const errors: string[] = [];
    const diagnostics: string[] = ["SecurityPerformanceWorker uses provided scanFile hook or falls back to heuristic stubs."];
    const findings: SecurityFindingWorker[] = [];
    const seenFiles = new Set<string>();

    options.log?.(`Starting security scan for ${options.changedFiles.length} candidate files.`);

    for (const file of options.changedFiles) {
      if (seenFiles.has(file)) continue;

      type ScanFileResult = Awaited<ReturnType<NonNullable<SecurityPerformanceWorkerOptions["scanFile"]>>>;
      let result: ScanFileResult;
      try {
        if (options.scanFile) {
          result = await options.scanFile(file);
        } else {
          result = { file, findings: [] };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
        options.log?.(`Security scan failed for ${file}: ${message}`);
        result = { file, findings: [] };
      }

      if (result.findings.length > 0) {
        findings.push(
          ...result.findings.map((finding) =>
            ({
              id: `${runId}-${file}-${finding.title?.replace(/\s+/g, "-").slice(0, 40)}`,
              workflowId: undefined,
              file,
              ...finding,
              references: [],
              provenance: "tool" as const,
              createdAt: now,
              updatedAt: now,
              contentHash: "",
            }) as unknown as SecurityFindingWorker,
          ),
        );
      }

      seenFiles.add(file);
      if (seenFiles.size % 20 === 0) {
        options.log?.(`Security scan progress: ${seenFiles.size}/${options.changedFiles.length} files.`);
      }
    }

    const completedAt = new Date().toISOString();
    const persisted: SecurityPerformanceWorkerRun = {
      id: runId,
      workflowId: undefined,
      kind: "security" as const,
      status: errors.length > 0 && findings.length === 0 ? "failed" : "complete",
      root: options.root,
      changedFiles: options.changedFiles.slice(0, 5000),
      diffSummary: options.diffSummary,
      startedAt: now,
      finishedAt: completedAt,
      findings,
      errors,
      diagnostics,
      metadata: {},
      createdAt: now,
      updatedAt: completedAt,
      contentHash: "",
    };

    await this.services.persistence.update((state) => ({
      ...state,
      securityRuns: [...state.securityRuns, persisted],
    }));

    options.log?.(`Security scan complete: ${findings.length} finding(s).`);

    return {
      id: runId,
      status: persisted.status,
      startedAt: now,
      filesScanned: seenFiles.size,
      findingsCount: findings.length,
      findings,
      errors,
      diagnostics,
    };
  }

  async runPerformanceAnalysis(options: SecurityPerformanceWorkerOptions): Promise<{
    id: string;
    status: string;
    startedAt: string;
    filesAnalyzed: number;
    findingsCount: number;
    findings: Array<{
      id: string;
      file: string;
      severity: string;
      category: string;
      title: string;
      description: string;
      recommendation?: string;
      evidence?: string[];
      status?: string;
      location?: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        path?: string[];
        symbolId?: string;
      };
    }>;
    errors: string[];
    diagnostics: string[];
  }> {
    const id = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const runId = `performance-${id}`;

    const pathsAnalyzed = Math.max(options.changedFiles.length, 1);
    const findings = this.buildPerformanceStubs(options.changedFiles.slice(0, 200));
    const completedAt = new Date().toISOString();
    const persisted: SecurityPerformanceWorkerRun = {
      id: runId,
      workflowId: undefined,
      kind: "performance" as const,
      status: "complete" as const,
      root: options.root,
      changedFiles: options.changedFiles.slice(0, 5000),
      diffSummary: options.diffSummary,
      startedAt,
      finishedAt: completedAt,
      findings: [],
      errors: [] as string[],
      diagnostics: ["Performance analyzer uses heuristic stubs until CPG/query hooks are connected."],
      metadata: {},
      createdAt: startedAt,
      updatedAt: completedAt,
      contentHash: "",
    };

    await this.services.persistence.update((state) => ({
      ...state,
      performanceRuns: [...state.performanceRuns, persisted],
    }));

    return {
      id: runId,
      status: "complete",
      startedAt,
      filesAnalyzed: pathsAnalyzed,
      findingsCount: findings.length,
      findings,
      errors: [],
      diagnostics: persisted.diagnostics,
    };
  }

  async getSecurityAnalysis(workflowId: string): Promise<{
    runId?: string;
    status?: string;
    startedAt?: string;
    filesScanned?: number;
    findingsCount?: number;
    findings?: Array<{
      id: string;
      file: string;
      category: string;
      severity: string;
      confidence: number;
      title: string;
      description: string;
      recommendation?: string;
      evidence?: string[];
      status?: string;
      location?: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        ruleId?: string;
        tool?: string;
        cwe?: string;
        owasp?: string;
      };
    }>;
    errors: string[];
    diagnostics: string[];
  }> {
    const lastRun = this.services.persistence.snapshot.securityRuns.find((run) => run.workflowId === workflowId);
    if (!lastRun) {
      return { filesScanned: 0, findingsCount: 0, findings: [], errors: [], diagnostics: ["No security run found for this workflow."] };
    }
    return {
      runId: lastRun.id,
      status: lastRun.status,
      startedAt: lastRun.startedAt ?? "",
      filesScanned: lastRun.changedFiles.length,
      findingsCount: lastRun.findings.length,
      findings: lastRun.findings.map((finding) => ({
        id: finding.id,
        file: finding.location?.filePath ?? "",
        category: finding.category,
        severity: finding.severity,
        confidence: finding.confidence,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        evidence: finding.evidence,
        status: finding.status,
        location: finding.location,
      })),
      errors: lastRun.errors,
      diagnostics: lastRun.diagnostics,
    };
  }

  async getPerformanceAnalysis(workflowId: string): Promise<{
    runId?: string;
    status?: string;
    startedAt?: string;
    filesAnalyzed?: number;
    findingsCount?: number;
    findings?: Array<{
      id: string;
      file: string;
      severity: string;
      category: string;
      title: string;
      description: string;
      recommendation?: string;
      evidence?: string[];
      status?: string;
      location?: {
        filePath: string;
        startLine?: number;
        endLine?: number;
        path?: string[];
        symbolId?: string;
      };
    }>;
    errors: string[];
    diagnostics: string[];
  }> {
    const lastRun = this.services.persistence.snapshot.performanceRuns.find((run) => run.workflowId === workflowId);
    if (!lastRun) {
      return { filesAnalyzed: 0, findingsCount: 0, findings: [], errors: [], diagnostics: ["No performance run found for this workflow."] };
    }
    return {
      runId: lastRun.id,
      status: lastRun.status,
      startedAt: lastRun.startedAt ?? "",
      filesAnalyzed: lastRun.changedFiles.length,
      findingsCount: lastRun.findings.length,
      findings: lastRun.findings.map((finding) => ({
        id: finding.id,
        file: finding.location?.filePath ?? "",
        severity: finding.severity,
        category: finding.category,
        title: finding.title,
        description: finding.description,
        recommendation: finding.recommendation,
        evidence: finding.evidence,
        status: finding.status,
        location: finding.location,
      })),
      errors: lastRun.errors,
      diagnostics: lastRun.diagnostics,
    };
  }

  private buildPerformanceStubs(files: string[]): Array<{
    id: string;
    file: string;
    severity: string;
    category: string;
    title: string;
    description: string;
    recommendation?: string;
    evidence?: string[];
    status?: string;
    location?: {
      filePath: string;
      startLine?: number;
      endLine?: number;
      path?: string[];
      symbolId?: string;
    };
  }> {
    return files.flatMap((file) => {
      const extension = file.split(".").pop() ?? "";
      if (!/^(ts|js|py|rb|go|rs|java)$/.test(extension)) return [];
      const id = `${crypto.randomUUID()}-${file}`;

      return [
        {
          id: `${id}-loop`,
          file,
          severity: "low",
          category: "loop",
          title: `Review ${file} for nested loops or unbounded iteration`,
          description: "The performance worker does not analyze runtime behavior yet. Inspect loops manually or use queries.",
          recommendation: "Use the performance deep-dive prompt to assess loop hotspots.",
          evidence: ["heuristic stub"],
          status: "open",
          location: { filePath: file, startLine: 1, endLine: 1 },
        },
        {
          id: `${id}-query`,
          file,
          severity: "low",
          category: "db-query",
          title: `Review ${file} for N+1 queries`,
          description: "Data-access patterns may introduce repeated queries.",
          recommendation: "Use the performance deep-dive prompt for query-impact analysis.",
          evidence: ["heuristic stub"],
          status: "open",
          location: { filePath: file, startLine: 1, endLine: 1 },
        },
      ];
    });
  }
}
