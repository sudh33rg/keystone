import * as vscode from "vscode";

export type DevelopmentMode = "quick" | "guided" | "spec-driven";
export type AgentSelectionMode = "manual" | "recommended" | "rule-based" | "fixed-workflow";
export type LogLevel = "debug" | "info" | "warning" | "error";

export interface KeystoneConfiguration {
  indexing: {
    enabled: boolean;
    onWorkspaceOpen: boolean;
    onBranchChange: boolean;
    maxFileSizeKb: number;
    maxFiles: number;
    workerCount: number;
    retainedGenerations: number;
    exclusions: string[];
  };
  context: {
    maxEstimatedTokens: number;
    includeTests: boolean;
  };
  workflow: {
    defaultMode: DevelopmentMode;
    requireSpecApproval: boolean;
  };
  agents: {
    selectionMode: AgentSelectionMode;
  };
  validation: {
    runBuild: boolean;
    runLint: boolean;
    runTests: boolean;
  };
  persistence: {
    workspaceSpecifications: boolean;
  };
  logging: {
    level: LogLevel;
  };
}

export class ConfigurationService {
  read(): KeystoneConfiguration {
    const indexing = vscode.workspace.getConfiguration("keystone.indexing");
    const context = vscode.workspace.getConfiguration("keystone.context");
    const workflow = vscode.workspace.getConfiguration("keystone.workflow");
    const agents = vscode.workspace.getConfiguration("keystone.agents");
    const validation = vscode.workspace.getConfiguration("keystone.validation");
    const persistence = vscode.workspace.getConfiguration("keystone.persistence");
    const logging = vscode.workspace.getConfiguration("keystone.logging");

    return {
      indexing: {
        enabled: indexing.get("enabled", true),
        onWorkspaceOpen: indexing.get("onWorkspaceOpen", true),
        onBranchChange: indexing.get("onBranchChange", true),
        maxFileSizeKb: bounded(indexing.get("maxFileSizeKb", 1024), 16, 1_048_576),
        maxFiles: bounded(indexing.get("maxFiles", 25_000), 100, 1_000_000),
        workerCount: bounded(indexing.get("workerCount", 0), 0, 32),
        retainedGenerations: bounded(indexing.get("retainedGenerations", 2), 2, 20),
        exclusions: indexing
          .get<string[]>("exclusions", [])
          .filter((value) => typeof value === "string" && value.trim().length > 0),
      },
      context: {
        maxEstimatedTokens: bounded(context.get("maxEstimatedTokens", 12_000), 1_000, 1_000_000),
        includeTests: context.get("includeTests", true),
      },
      workflow: {
        defaultMode: enumValue(
          workflow.get("defaultMode", "guided"),
          ["quick", "guided", "spec-driven"],
          "guided",
        ),
        requireSpecApproval: workflow.get("requireSpecApproval", true),
      },
      agents: {
        selectionMode: enumValue(
          agents.get("selectionMode", "recommended"),
          ["manual", "recommended", "rule-based", "fixed-workflow"],
          "recommended",
        ),
      },
      validation: {
        runBuild: validation.get("runBuild", true),
        runLint: validation.get("runLint", true),
        runTests: validation.get("runTests", true),
      },
      persistence: {
        workspaceSpecifications: persistence.get("workspaceSpecifications", false),
      },
      logging: {
        level: enumValue(
          logging.get("level", "info"),
          ["debug", "info", "warning", "error"],
          "info",
        ),
      },
    };
  }

  async openSettings(query = "@ext:keystone-dev.keystone"): Promise<void> {
    await vscode.commands.executeCommand("workbench.action.openSettings", query);
  }
}

function bounded(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function enumValue<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
