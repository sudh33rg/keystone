// SafetyCheckService.ts
// Ensures no write operations to remote Git repositories.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SafetyCheckResult {
  safe: boolean;
  message: string;
  details?: string;
}

export class SafetyCheckService {
  async checkGitRemoteSafety(repoPath: string): Promise<SafetyCheckResult> {
    try {
      // Get the remote URL
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024,
      });

      const remoteUrl = stdout.trim();

      // Check if it's a local path (safe) or a remote URL (potentially unsafe)
      if (remoteUrl.startsWith("/") || remoteUrl.startsWith(".")) {
        return {
          safe: true,
          message: "Remote is a local path.",
          details: remoteUrl,
        };
      }

      // Check for common remote URL patterns
      const remotePatterns = [/^https?:\/\//i, /^git@/, /^ssh:\/\//i, /^ftp:\/\//i];

      for (const pattern of remotePatterns) {
        if (pattern.test(remoteUrl)) {
          return {
            safe: false,
            message: "Remote is a remote URL. Write operations are not allowed.",
            details: remoteUrl,
          };
        }
      }

      return {
        safe: true,
        message: "Remote URL is not recognized as a remote URL.",
        details: remoteUrl,
      };
    } catch (error) {
      return {
        safe: true,
        message: "Could not determine remote URL. Assuming safe.",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async checkGitPushSafety(repoPath: string): Promise<SafetyCheckResult> {
    try {
      // Check if there are unpushed commits
      const { stdout } = await execFileAsync("git", ["rev-list", "--count", "HEAD..@{upstream}"], {
        cwd: repoPath,
        maxBuffer: 1024 * 1024,
      });

      const unpushedCount = parseInt(stdout.trim(), 10);

      if (unpushedCount > 0) {
        return {
          safe: false,
          message: `There are ${unpushedCount} unpushed commit(s). Pushing is not allowed.`,
          details: `${unpushedCount} unpushed commit(s)`,
        };
      }

      return {
        safe: true,
        message: "No unpushed commits.",
      };
    } catch (error) {
      return {
        safe: true,
        message: "Could not check for unpushed commits. Assuming safe.",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async validateOperation(repoPath: string, operation: string): Promise<SafetyCheckResult> {
    // Check if the operation is a write operation
    const writeOperations = ["push", "commit", "merge", "rebase", "reset", "checkout", "stash"];

    if (writeOperations.includes(operation.toLowerCase())) {
      const remoteCheck = await this.checkGitRemoteSafety(repoPath);
      if (!remoteCheck.safe) {
        return {
          safe: false,
          message: `Write operation '${operation}' is not allowed on remote repositories.`,
          details: remoteCheck.details,
        };
      }

      const pushCheck = await this.checkGitPushSafety(repoPath);
      if (!pushCheck.safe) {
        return {
          safe: false,
          message: `Write operation '${operation}' is not allowed when there are unpushed commits.`,
          details: pushCheck.details,
        };
      }
    }

    return {
      safe: true,
      message: `Operation '${operation}' is allowed.`,
    };
  }
}
