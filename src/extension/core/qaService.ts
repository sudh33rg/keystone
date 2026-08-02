/**
 * QA Background Service
 *
 * Runs gap analysis automatically when a workspace is opened.
 * Supports quick scan (immediate) and deep scan (after a delay).
 *
 * @module vscode/core/qaService
 */

import type * as vscode from "vscode";
import { createGapAnalyzer, type GapAnalysisResult } from "@core/workflow/quality/qaGapAnalysis";
import { DEFAULT_QA_CONFIG } from "@core/platform/config/qualityConfig";
import { cancellationFromAbortSignal } from "@core/workflow/quality/cancellation";
import { OkfSnapshotStore } from "@core/intelligence/okf/store";
import type { OkfGraphProjection } from "@core/intelligence/okf/projections";
import {
  canonicalEvidenceEnvelope,
  selectCanonicalContext
} from "@core/intelligence/okf/canonicalContext";

/**
 * Read the promoted OKF graph projection for test-impact analysis.
 *
 * Read-only: this never builds or mutates OKF state. A missing or unreadable
 * projection yields undefined so deep analysis degrades to an honest empty
 * impacted-test list rather than fabricated suggestions.
 */
async function readOkfGraphProjection(
  workspaceRoot: string
): Promise<OkfGraphProjection | undefined> {
  try {
    return await new OkfSnapshotStore(workspaceRoot).readGraphProjection();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the QA background service */
export interface QaServiceConfig {
  /** Auto-run analysis on workspace open (default: true) */
  autoAnalysis: boolean;
  /** Delay before auto-analysis in ms (default: 2_000) */
  autoAnalysisDelayMs: number;
  /** Default scan depth (default: 'quick') */
  defaultDepth: "quick" | "deep";
  /** Timeout for quick scan in ms (default: 30_000) */
  quickScanTimeoutMs: number;
  /** Timeout for deep scan in ms (default: 120_000) */
  deepScanTimeoutMs: number;
}

export interface QaServiceEvent {
  status: "running" | "complete" | "cancelled" | "failed";
  message?: string;
  result?: GapAnalysisResult;
  progress?: number;
}

const DEFAULT_SERVICE_CONFIG: QaServiceConfig = {
  autoAnalysis: true,
  autoAnalysisDelayMs: 2_000,
  defaultDepth: "quick",
  quickScanTimeoutMs: 30_000,
  deepScanTimeoutMs: 120_000
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Background QA service that runs gap analysis on workspace open.
 *
 * Follows the same patterns as the existing file watcher + indexing service.
 */
export class QaService implements vscode.Disposable {
  private config: QaServiceConfig;
  private disposables: vscode.Disposable[] = [];
  private activeAnalysis: AbortController | null = null;
  private onResultCallbacks: Array<(result: GapAnalysisResult) => void> = [];
  private onEventCallbacks: Array<(event: QaServiceEvent) => void> = [];
  private workspaceRoot: string | null = null;
  private analysisTimer: NodeJS.Timeout | undefined;

  constructor(config: Partial<QaServiceConfig> = {}) {
    this.config = { ...DEFAULT_SERVICE_CONFIG, ...config };
  }

  /**
   * Register a callback for analysis results.
   */
  onResult(callback: (result: GapAnalysisResult) => void): void {
    this.onResultCallbacks.push(callback);
  }

  onEvent(callback: (event: QaServiceEvent) => void): vscode.Disposable {
    this.onEventCallbacks.push(callback);
    return {
      dispose: () => {
        this.onEventCallbacks = this.onEventCallbacks.filter((item) => item !== callback);
      }
    };
  }

  /**
   * Start auto-analysis on workspace open.
   *
   * Runs a quick scan after a configurable delay.
   */
  startAutoAnalysis(workspaceRoot: string): void {
    if (!this.config.autoAnalysis) return;

    this.workspaceRoot = workspaceRoot;
    this.cancel(); // Cancel any previous analysis

    this.analysisTimer = setTimeout(() => {
      this.analysisTimer = undefined;
      void this.runAnalysis(workspaceRoot, this.config.defaultDepth).catch(() => undefined);
    }, this.config.autoAnalysisDelayMs);
  }

  /**
   * Run analysis with the specified depth.
   */
  async runAnalysis(workspaceRoot: string, depth: "quick" | "deep"): Promise<GapAnalysisResult> {
    this.cancel();

    const abort = new AbortController();
    this.activeAnalysis = abort;

    try {
      const okfSnapshot = await new OkfSnapshotStore(workspaceRoot).read();
      if (!okfSnapshot)
        throw new Error(
          "The canonical OKF snapshot is not ready. Wait for intelligence promotion to finish."
        );
      const canonicalSelection = selectCanonicalContext(
        okfSnapshot,
        "test coverage quality assurance impacted tests",
        { graphMode: "tests", graphLimit: 180 }
      );
      if (!canonicalSelection.paths.length) {
        const result: GapAnalysisResult = {
          scanMode: depth,
          summary: {
            testFramework: "unknown",
            totalTests: 0,
            totalSourceFiles: 0,
            coverageRatio: 0,
            coverageRate: 0,
            flakyTests: 0,
            brokenTests: 0,
            riskScore: 0
          },
          gaps: [],
          recommendations: [],
          metrics: {
            elapsedMs: 0,
            testsDiscovered: 0,
            sourcesAnalyzed: 0,
            gapsFound: 0,
            recommendationsGenerated: 0
          },
          canonicalEvidence: canonicalEvidenceEnvelope(okfSnapshot, canonicalSelection)
        };
        this.publish({ status: "complete", result });
        return result;
      }
      const analyzer = createGapAnalyzer({
        workspaceRoot,
        config: { scopePaths: canonicalSelection.paths },
        onProgress: (message, progress) => {
          this.publish({
            status: "running",
            message,
            progress
          });
        }
      });
      const context = {
        cancellation: cancellationFromAbortSignal(abort.signal),
        signal: abort.signal
      };
      const result =
        depth === "deep"
          ? await analyzer.analyzeDeep(context, await readOkfGraphProjection(workspaceRoot))
          : await analyzer.analyzeQuick(context);
      result.canonicalEvidence = canonicalEvidenceEnvelope(okfSnapshot, canonicalSelection);

      this.publish({
        status: "complete",
        result
      });

      return result;
    } catch (err) {
      if (err instanceof Error && err.name === "CancellationError") {
        return {
          scanMode: depth,
          summary: {
            testFramework: "unknown",
            totalTests: 0,
            totalSourceFiles: 0,
            coverageRatio: 0,
            coverageRate: 0,
            flakyTests: 0,
            brokenTests: 0,
            riskScore: 0
          },
          gaps: [],
          recommendations: [],
          metrics: {
            elapsedMs: 0,
            testsDiscovered: 0,
            sourcesAnalyzed: 0,
            gapsFound: 0,
            recommendationsGenerated: 0
          }
        };
      }
      this.publish({ status: "failed", message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      if (this.activeAnalysis === abort) {
        this.activeAnalysis = null;
      }
    }
  }

  /**
   * Cancel any running analysis.
   */
  cancel(): void {
    if (this.analysisTimer) {
      clearTimeout(this.analysisTimer);
      this.analysisTimer = undefined;
    }
    if (this.activeAnalysis) {
      this.activeAnalysis.abort();
      this.activeAnalysis = null;
    }
    this.publish({
      status: "cancelled",
      message: "Analysis cancelled."
    });
  }

  /**
   * Dispose the service.
   */
  dispose(): void {
    this.cancel();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private publish(event: QaServiceEvent): void {
    for (const callback of this.onEventCallbacks) callback(event);
    if (event.status !== "complete" || !event.result) return;
    for (const callback of this.onResultCallbacks) {
      try {
        callback(event.result);
      } catch {
        // Don't let callback errors crash the service
      }
    }
  }
}
