import { z } from "zod";
import { KeystoneError } from "../../shared/errors/KeystoneError";
import type { GitAdapter } from "../../extension/adapters/GitAdapter";
import type { WorkspaceAdapter } from "../../extension/adapters/WorkspaceAdapter";
import type { IntelligenceStore } from "../persistence/IntelligenceStore";
import type { CopilotIntegrationPersistenceStore } from "../persistence/CopilotIntegrationPersistenceStore";
import type { DevelopmentWorkflowService } from "../workflows/DevelopmentWorkflowService";

/**
 * Health status enum for individual health checks
 */
export const HealthStatusSchema = z.enum(["healthy", "degraded", "unhealthy", "unknown"]);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/**
 * Individual health check result
 */
export const HealthCheckResultSchema = z.object({
  name: z.string().min(1).max(100),
  status: HealthStatusSchema,
  message: z.string().max(500).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
  timestamp: z.string().datetime(),
  durationMs: z.number().nonnegative(),
});
export type HealthCheckResult = z.infer<typeof HealthCheckResultSchema>;

/**
 * Overall health status
 */
export const OverallHealthSchema = z.object({
  status: HealthStatusSchema,
  checks: z.array(HealthCheckResultSchema),
  timestamp: z.string().datetime(),
  version: z.string().optional(),
});
export type OverallHealth = z.infer<typeof OverallHealthSchema>;

/**
 * Health check function signature
 */
export type HealthCheckFn = () => Promise<HealthCheckResult>;

/**
 * Health check registration
 */
export interface HealthCheckRegistration {
  name: string;
  check: HealthCheckFn;
  critical?: boolean; // If true, failure makes overall status unhealthy
}

/**
 * HealthCheckService provides a unified health check endpoint for all Keystone subsystems.
 * It aggregates health checks from intelligence, copilot, git, workflow, and other services.
 */
export class HealthCheckService {
  private checks: Map<string, HealthCheckRegistration> = new Map();
  private lastResult: OverallHealth | null = null;
  private lastCheckTime: number = 0;
  private readonly cacheTtlMs = 30_000; // 30 seconds cache TTL

  /**
   * Register a health check (object form).
   */
  register(registration: HealthCheckRegistration): void;
  /**
   * Register a health check (explicit form).
   */
  register(name: string, check: HealthCheckFn, critical?: boolean): void;
  register(
    nameOrRegistration: string | HealthCheckRegistration,
    check?: HealthCheckFn,
    critical = false,
  ): void {
    const registration: HealthCheckRegistration =
      typeof nameOrRegistration === "string"
        ? { name: nameOrRegistration, check: check!, critical }
        : nameOrRegistration;
    if (this.checks.has(registration.name)) {
      throw new KeystoneError({
        code: "health.check.duplicate",
        category: "INTERNAL",
        message: `Health check '${registration.name}' is already registered`,
        operation: "healthCheck.register",
        recoverable: true,
        recommendedAction: "Use a unique health-check name.",
      });
    }
    this.checks.set(registration.name, {
      name: registration.name,
      check: registration.check,
      critical: registration.critical ?? false,
    });
  }

  /**
   * Unregister a health check
   */
  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  /**
   * Run all registered health checks
   */
  async checkAll(forceRefresh: boolean = false): Promise<OverallHealth> {
    const now = Date.now();

    // Return cached result if within TTL and not forced
    if (!forceRefresh && this.lastResult && now - this.lastCheckTime < this.cacheTtlMs) {
      return this.lastResult;
    }

    const results: HealthCheckResult[] = [];
    const checkEntries = Array.from(this.checks.entries());

    // Run all checks in parallel
    const checkPromises = checkEntries.map(async ([name, registration]) => {
      const startTime = Date.now();
      try {
        const result = await registration.check();
        return {
          ...result,
          name,
          durationMs: Date.now() - startTime,
        };
      } catch (error) {
        return {
          name,
          status: "unhealthy" as HealthStatus,
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        };
      }
    });

    const checkResults = await Promise.all(checkPromises);
    results.push(...checkResults);

    // Determine overall status
    let overallStatus: HealthStatus = "healthy";
    for (const result of results) {
      const registration = this.checks.get(result.name);
      const isCritical = registration?.critical ?? false;

      if (result.status === "unhealthy") {
        overallStatus = isCritical ? "unhealthy" : "degraded";
      } else if (result.status === "degraded" && overallStatus === "healthy") {
        overallStatus = "degraded";
      } else if (result.status === "unknown" && overallStatus === "healthy") {
        overallStatus = "degraded";
      }
    }

    const overallHealth: OverallHealth = {
      status: overallStatus,
      checks: results,
      timestamp: new Date().toISOString(),
      version: "0.1.0", // Could be injected from package.json
    };

    this.lastResult = overallHealth;
    this.lastCheckTime = now;

    return overallHealth;
  }

  /**
   * Run a single health check by name
   */
  async checkOne(name: string): Promise<HealthCheckResult | null> {
    const registration = this.checks.get(name);
    if (!registration) {
      return null;
    }

    const startTime = Date.now();
    try {
      const result = await registration.check();
      return {
        ...result,
        name,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        name,
        status: "unhealthy",
        message: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Get the last cached health check result
   */
  getLastResult(): OverallHealth | null {
    return this.lastResult;
  }

  /**
   * Get all registered check names
   */
  getRegisteredChecks(): string[] {
    return Array.from(this.checks.keys());
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.lastResult = null;
    this.lastCheckTime = 0;
  }

  /**
   * Create a standard health check for a service that has an isHealthy/isReady method
   */
  static createServiceCheck<
    T extends { isHealthy?: () => Promise<boolean>; isReady?: () => Promise<boolean> },
  >(serviceName: string, service: T, critical: boolean = false): HealthCheckRegistration {
    return {
      name: serviceName,
      critical,
      check: async () => {
        const timestamp = new Date().toISOString();

        // Try isHealthy first, then isReady
        let healthy: boolean;
        let message: string;

        if (typeof service.isHealthy === "function") {
          healthy = await service.isHealthy();
          message = healthy ? `${serviceName} is healthy` : `${serviceName} is unhealthy`;
        } else if (typeof service.isReady === "function") {
          healthy = await service.isReady();
          message = healthy ? `${serviceName} is ready` : `${serviceName} is not ready`;
        } else {
          return {
            name: serviceName,
            status: "unknown",
            message: `${serviceName} does not expose health/ready check`,
            timestamp,
            durationMs: 0,
          };
        }

        return {
          name: serviceName,
          status: healthy ? "healthy" : "unhealthy",
          message,
          timestamp,
          durationMs: 0, // Will be overwritten by caller
        };
      },
    };
  }

  /**
   * Create a health check for intelligence service
   */
  static createIntelligenceCheck(intelligenceRuntime: {
    getState: () => { status: string };
  }): HealthCheckRegistration {
    return {
      name: "intelligence",
      critical: true,
      check: async () => {
        const timestamp = new Date().toISOString();
        const state = intelligenceRuntime.getState();

        let status: HealthStatus;
        let message: string;

        switch (state.status) {
          case "ready":
            status = "healthy";
            message = "Intelligence runtime is ready";
            break;
          case "building":
          case "rebuilding":
            status = "degraded";
            message = `Intelligence runtime is ${state.status}`;
            break;
          case "failed":
            status = "unhealthy";
            message = "Intelligence runtime failed";
            break;
          case "idle":
            status = "degraded";
            message = "Intelligence runtime is idle (not initialized)";
            break;
          default:
            status = "unknown";
            message = `Intelligence runtime status: ${state.status}`;
        }

        return {
          name: "intelligence",
          status,
          message,
          details: { runtimeStatus: state.status },
          timestamp,
          durationMs: 0,
        };
      },
    };
  }

  /**
   * Create a health check for git service.
   */
  static createGitCheck(git: GitAdapter, rootUri?: string): HealthCheckRegistration {
    return {
      name: "git",
      critical: false,
      check: async () => {
        const timestamp = new Date().toISOString();
        try {
          if (typeof git.isGitRepository === "function" && rootUri !== undefined) {
            const ok = git.isGitRepository(rootUri);
            return {
              name: "git",
              status: ok ? "healthy" : "degraded",
              message: ok ? "Git repository detected" : "No git repository at configured root",
              details: { repositoryRoot: rootUri },
              timestamp,
              durationMs: 0,
            };
          }
          return {
            name: "git",
            status: "unknown",
            message: "Git adapter available; repository detection requires a configured root",
            timestamp,
            durationMs: 0,
          };
        } catch (error) {
          return {
            name: "git",
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Git check failed",
            timestamp,
            durationMs: 0,
          };
        }
      },
    };
  }

  /**
   * Create a health check for workspace service.
   */
  static createWorkspaceCheck(workspace: WorkspaceAdapter): HealthCheckRegistration {
    return {
      name: "workspace",
      critical: true,
      check: async () => {
        const timestamp = new Date().toISOString();
        try {
          const roots = workspace.getRoots();
          if (!roots || roots.length === 0) {
            return {
              name: "workspace",
              status: "unhealthy",
              message: "No workspace folder open",
              timestamp,
              durationMs: 0,
            };
          }
          return {
            name: "workspace",
            status: "healthy",
            message: `${roots.length} workspace folder(s) open`,
            details: { roots: roots.map((r) => r.uri) },
            timestamp,
            durationMs: 0,
          };
        } catch (error) {
          return {
            name: "workspace",
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Workspace check failed",
            timestamp,
            durationMs: 0,
          };
        }
      },
    };
  }

  /**
   * Create a health check for persistence/store.
   */
  static createPersistenceCheck(store: IntelligenceStore): HealthCheckRegistration {
    return {
      name: "persistence",
      critical: true,
      check: async () => {
        const timestamp = new Date().toISOString();
        const snapshot = store.getSnapshot();
        if (!snapshot) {
          return {
            name: "persistence",
            status: "unhealthy",
            message: "No intelligence snapshot available",
            timestamp,
            durationMs: 0,
          };
        }
        return {
          name: "persistence",
          status: "healthy",
          message: `Intelligence snapshot available (generation ${snapshot.manifest.generation})`,
          details: { generation: snapshot.manifest.generation },
          timestamp,
          durationMs: 0,
        };
      },
    };
  }

  /**
   * Create a health check for copilot integration.
   */
  static createCopilotCheck(
    copilotIntegration: CopilotIntegrationPersistenceStore,
  ): HealthCheckRegistration {
    return {
      name: "copilot",
      critical: false,
      check: async () => {
        const timestamp = new Date().toISOString();
        try {
          const state = copilotIntegration.snapshot;
          const toolsEnabled = state?.settings?.toolsEnabled ?? false;
          return {
            name: "copilot",
            status: toolsEnabled ? "healthy" : "degraded",
            message: toolsEnabled ? "Copilot tools enabled" : "Copilot tools disabled",
            details: { toolsEnabled },
            timestamp,
            durationMs: 0,
          };
        } catch (error) {
          return {
            name: "copilot",
            status: "unhealthy",
            message: error instanceof Error ? error.message : "Copilot check failed",
            timestamp,
            durationMs: 0,
          };
        }
      },
    };
  }

  /**
   * Create a health check for workflow service.
   */
  static createWorkflowCheck(workflow: DevelopmentWorkflowService): HealthCheckRegistration {
    return {
      name: "workflow",
      critical: false,
      check: async () => {
        const timestamp = new Date().toISOString();
        const workflows = workflow.list();
        const activeWorkflows = workflows.filter((w) =>
          w.tasks.some((t) => ["ready", "executing", "blocked"].includes(t.status)),
        );
        return {
          name: "workflow",
          status: "healthy",
          message: `${workflows.length} workflow(s), ${activeWorkflows.length} active`,
          details: {
            totalWorkflows: workflows.length,
            activeWorkflows: activeWorkflows.length,
          },
          timestamp,
          durationMs: 0,
        };
      },
    };
  }

}
