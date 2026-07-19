// GitHistoryParser.ts
// Read-only Git history parser for intelligence enhancement.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { IntelligenceStore } from "../core/persistence/IntelligenceStore";
import type { KeystoneLogger } from "../shared/logging/KeystoneLogger";
import { KeystoneError } from "../shared/errors/KeystoneError";

const execFileAsync = promisify(execFile);

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  date: string;
  message: string;
  files: GitFileChange[];
}

export interface GitFileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
}

export interface GitHistoryParserOptions {
  /** Maximum number of commits to parse. Defaults to 100. */
  maxCommits?: number;
  /** Path to the Git repository. Defaults to the workspace root. */
  repoPath?: string;
}

export class GitHistoryParser {
  private readonly maxCommits: number;
  private readonly repoPath: string;

  constructor(
    private readonly store: IntelligenceStore,
    private readonly logger: KeystoneLogger,
    options: GitHistoryParserOptions = {},
  ) {
    this.maxCommits = options.maxCommits ?? 100;
    this.repoPath = options.repoPath ?? process.cwd();
  }

  async parseHistory(signal?: AbortSignal): Promise<GitCommit[]> {
    const commits: GitCommit[] = [];

    try {
      // Get commit log with stats
      const logOutput = await execFileAsync(
        "git",
        [
          "log",
          `--max-count=${this.maxCommits}`,
          "--pretty=format:%H|%h|%an|%ae|%ad|%s",
          "--stat",
        ],
        { cwd: this.repoPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const logLines = logOutput.stdout.split("\n");
      let currentCommit: GitCommit | undefined;
      let currentFiles: GitFileChange[] = [];

      for (const line of logLines) {
        if (signal?.aborted) throw new Error("Cancelled.");

        // Commit header line
        if (line.startsWith("commit ") && line.includes("|")) {
          if (currentCommit) {
            currentCommit.files = currentFiles;
            commits.push(currentCommit);
          }

          const parts = line.slice(7).split("|");
          if (parts.length >= 6) {
            currentCommit = {
              hash: parts[0]!,
              shortHash: parts[1]!,
              author: parts[2]!,
              authorEmail: parts[3]!,
              date: parts[4]!,
              message: parts.slice(5).join("|"),
              files: [],
            };
            currentFiles = [];
          }
        } else if (currentCommit && line.trim()) {
          // File change line
          const match = line.match(/^[^\s]+\s+(\d+)\s+\d+\s+([^\s]+)$/);
          if (match) {
            const additions = parseInt(match[1]!, 10);
            const path = match[2]!;
            currentFiles.push({
              path,
              status: "modified",
              additions,
              deletions: 0,
            });
          }
        }
      }

      // Push the last commit
      if (currentCommit) {
        currentCommit.files = currentFiles;
        commits.push(currentCommit);
      }
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, "git-history.parse"));
      throw error;
    }

    return commits;
  }

  async getRecentCommits(limit: number = 10, signal?: AbortSignal): Promise<GitCommit[]> {
    const allCommits = await this.parseHistory(signal);
    return allCommits.slice(0, limit);
  }

  async getCommitsForFile(filePath: string, limit: number = 50, signal?: AbortSignal): Promise<GitCommit[]> {
    try {
      const logOutput = await execFileAsync(
        "git",
        [
          "log",
          `--max-count=${limit}`,
          "--pretty=format:%H|%h|%an|%ae|%ad|%s",
          "--",
          filePath,
        ],
        { cwd: this.repoPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const commits: GitCommit[] = [];
      const lines = logOutput.stdout.split("\n");

      for (const line of lines) {
        if (signal?.aborted) throw new Error("Cancelled.");
        if (line.startsWith("commit ") && line.includes("|")) {
          const parts = line.slice(7).split("|");
          if (parts.length >= 6) {
            commits.push({
              hash: parts[0]!,
              shortHash: parts[1]!,
              author: parts[2]!,
              authorEmail: parts[3]!,
              date: parts[4]!,
              message: parts.slice(5).join("|"),
              files: [{ path: filePath, status: "modified", additions: 0, deletions: 0 }],
            });
          }
        }
      }

      return commits;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, "git-history.file-commits"));
      return [];
    }
  }

  async getBlame(filePath: string, signal?: AbortSignal): Promise<Array<{ line: number; commit: string; author: string; content: string }>> {
    try {
      const blameOutput = await execFileAsync(
        "git",
        ["blame", "--line-porcelain", filePath],
        { cwd: this.repoPath, maxBuffer: 10 * 1024 * 1024 },
      );

      const lines = blameOutput.stdout.split("\n");
      const result: Array<{ line: number; commit: string; author: string; content: string }> = [];
      let currentLine = 0;
      let currentCommit = "";
      let currentAuthor = "";

      for (const line of lines) {
        if (signal?.aborted) throw new Error("Cancelled.");

        if (line.startsWith("author ")) {
          currentAuthor = line.slice(7);
        } else if (line.match(/^[0-9a-f]{40}/)) {
          currentCommit = line.slice(0, 40);
        } else if (line.startsWith("\t")) {
          currentLine++;
          result.push({
            line: currentLine,
            commit: currentCommit,
            author: currentAuthor,
            content: line.slice(1),
          });
        }
      }

      return result;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, "git-history.blame"));
      return [];
    }
  }
}
