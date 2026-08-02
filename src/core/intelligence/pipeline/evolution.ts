import { GitReadOnly } from "../../platform/git/gitReadOnly";
import type { IncrementalUpdatePlan } from "./incremental";

export interface RepositoryEvolution {
  readonly changes: Readonly<
    Record<"unchanged" | "implementation" | "structural" | "added" | "deleted", number>
  >;
  readonly coupling: ReadonlyArray<{
    fileA: string;
    fileB: string;
    commits: number;
    strength: number;
  }>;
  readonly commitsAnalyzed: number;
  readonly degraded: boolean;
  readonly warnings: readonly string[];
}

export async function buildRepositoryEvolution(
  root: string,
  incremental: IncrementalUpdatePlan,
  maxCommits = 200
): Promise<RepositoryEvolution> {
  const changes = { unchanged: 0, implementation: 0, structural: 0, added: 0, deleted: 0 };
  incremental.changes.forEach((change) => {
    changes[change.kind] += 1;
  });
  try {
    const git = new GitReadOnly(root);
    const inside = await git.run("rev-parse", ["--is-inside-work-tree"]);
    if (inside !== "true") throw new Error("Workspace is not a Git repository.");
    const stdout = await git.run("log", [
      `-n${maxCommits}`,
      "--pretty=format:__KEYSTONE_COMMIT__",
      "--name-only",
      "--no-renames"
    ]);
    const commits = parseCommits(stdout);
    const fileCommits = new Map<string, number>();
    const pairCounts = new Map<string, number>();
    for (const files of commits) {
      const bounded = [...new Set(files)].sort().slice(0, 50);
      bounded.forEach((file) => fileCommits.set(file, (fileCommits.get(file) ?? 0) + 1));
      for (let left = 0; left < bounded.length; left += 1)
        for (let right = left + 1; right < bounded.length; right += 1) {
          const key = `${bounded[left]}\0${bounded[right]}`;
          pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
        }
    }
    const coupling = [...pairCounts.entries()]
      .filter(([, count]) => count >= 2)
      .map(([key, count]) => {
        const [fileA, fileB] = key.split("\0");
        return {
          fileA,
          fileB,
          commits: count,
          strength:
            count / Math.max(fileCommits.get(fileA) ?? count, fileCommits.get(fileB) ?? count)
        };
      })
      .sort((a, b) => b.strength - a.strength || b.commits - a.commits)
      .slice(0, 500);
    return { changes, coupling, commitsAnalyzed: commits.length, degraded: false, warnings: [] };
  } catch (error) {
    return {
      changes,
      coupling: [],
      commitsAnalyzed: 0,
      degraded: true,
      warnings: [
        `Git coupling unavailable: ${error instanceof Error ? error.message : String(error)}`
      ]
    };
  }
}

function parseCommits(output: string): string[][] {
  const commits: string[][] = [];
  let current: string[] | undefined;
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "__KEYSTONE_COMMIT__") {
      if (current) commits.push(current);
      current = [];
    } else if (line && current) current.push(line);
  }
  if (current) commits.push(current);
  return commits;
}
