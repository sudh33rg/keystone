import { createHash } from "node:crypto";
import type { PrReviewService } from "./PrReviewService";
import type { ReviewChangeSetSource } from "../../shared/contracts/prReview";

export interface PrReviewUrlServiceOptions {
  httpGet: (url: string, headers?: Record<string, string>) => Promise<{ status: number; text: () => Promise<string> }>;
}

interface ParsedPr {
  provider: "github" | "gitlab" | "bitbucket" | "unknown";
  owner: string;
  repo: string;
  prNumber: number;
}

interface FetchedDiff {
  owner: string;
  repo: string;
  prNumber: number;
  title?: string;
  description?: string;
  baseCommit?: string;
  headCommit?: string;
  files: Array<{
    path: string;
    status: "added" | "removed" | "modified" | "renamed";
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

export class PrReviewUrlService {
  constructor(private readonly prReview: PrReviewService, private readonly options: PrReviewUrlServiceOptions) {}

  async startFromUrl(input: {
    workflowId: string;
    prUrl: string;
    confirmPartial?: boolean;
    delegateFindings?: boolean;
  }): Promise<{
    reviewId: string;
    findingCount: number;
    status: string;
    pr: { owner: string; repo: string; number: number };
  }> {
    const pr = this.parsePrUrl(input.prUrl);
    const diff = await this.fetchDiff(pr);
    const changeSet = this.toChangeSet(diff);

    const prepared = await this.prReview.prepare(input.workflowId, changeSet, input.confirmPartial ?? false);
    const review = prepared.review;

    return {
      reviewId: review.id,
      findingCount: prepared.findings.length,
      status: review.status,
      pr: { owner: pr.owner, repo: pr.repo, number: pr.prNumber },
    };
  }

  private parsePrUrl(url: string): ParsedPr {
    const patterns: Array<{ regex: RegExp; provider: ParsedPr["provider"] }> = [
      { regex: /^https?:\/\/(?:www\.)?github\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/pull\/(?<number>\d+)/, provider: "github" },
      { regex: /^https?:\/\/(?:www\.)?gitlab\.com\/(?<owner>[^\/]+)\/(?<repo>[^\/\?]+)(?:-\/|\/-\/)?merge_requests\/(?<number>\d+)/, provider: "gitlab" },
      { regex: /^https?:\/\/(?:www\.)?bitbucket\.org\/(?<owner>[^\/]+)\/(?<repo>[^\/]+)\/pull-requests\/(?<number>\d+)/, provider: "bitbucket" },
    ];

    for (const pattern of patterns) {
      const match = url.match(pattern.regex);
      if (match?.groups) {
        return {
          provider: pattern.provider,
          owner: match.groups.owner ?? "",
          repo: (match.groups.repo ?? "").replace(/\/$/, ""),
          prNumber: Number(match.groups.number),
        };
      }
    }

    throw new Error(`Unsupported PR URL: ${url}`);
  }

  private async fetchDiff(pr: ParsedPr): Promise<FetchedDiff> {
    const filesUrl = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}/files`;
    const pullUrl = `https://api.github.com/repos/${pr.owner}/${pr.repo}/pulls/${pr.prNumber}`;

    const [filesResponse, pullResponse] = await Promise.all([
      this.options.httpGet(filesUrl, { Accept: "application/vnd.github.v3.diff" }),
      this.options.httpGet(pullUrl, { Accept: "application/vnd.github.v3+json" }),
    ]);

    if (filesResponse.status !== 200) {
      throw new Error(`Failed to load PR diff: ${filesResponse.status}`);
    }

    const filesRaw = await filesResponse.text();
    const files = this.parsePatchFiles(filesRaw);

    let title: string | undefined;
    let description: string | undefined;
    let baseCommit: string | undefined;
    let headCommit: string | undefined;

    try {
      const pullText = await pullResponse.text();
      const pullJson = JSON.parse(pullText) as Record<string, unknown>;
      title = typeof pullJson.title === "string" ? pullJson.title : undefined;
      description = typeof pullJson.body === "string" ? pullJson.body : undefined;

      const base = pullJson.base;
      const head = pullJson.head;
      if (base && typeof base === "object" && base !== null && typeof (base as Record<string, unknown>).sha === "string") {
        baseCommit = (base as Record<string, unknown>).sha as string;
      }
      if (head && typeof head === "object" && head !== null && typeof (head as Record<string, unknown>).sha === "string") {
        headCommit = (head as Record<string, unknown>).sha as string;
      }
    }
    catch {
      // non-fatal
    }

    return {
      owner: pr.owner,
      repo: pr.repo,
      prNumber: pr.prNumber,
      title,
      description,
      baseCommit,
      headCommit,
      files,
    };
  }

  private parsePatchFiles(raw: string): FetchedDiff["files"] {
    const entries: FetchedDiff["files"] = [];
    const fileHeaderRegex = /^(?<path>[^\t]+)\t(?<status>[^\t]+)(?:\t(?<orig>[^\t]+))?(?:\t(?<new>[^\t]+))?/m;
    const blocks = raw.split(/^diff --git /m).filter((block) => block.trim().length > 0);

    for (const block of blocks) {
      const headerMatch = block.match(fileHeaderRegex);
      if (!headerMatch?.groups) continue;

      const path = (headerMatch.groups.path ?? "").replace(/^a\//, "").replace(/^b\//, "");
      let status = (headerMatch.groups.status ?? "").replace("_", "-") as FetchedDiff["files"][number]["status"];
      if (!["added", "removed", "modified", "renamed"].includes(status)) status = "modified";

      let additions = 0;
      let deletions = 0;
      for (const line of block.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }

      entries.push({ path, status, additions, deletions, patch: block.slice(0, 1_000_000) });
    }

    if (entries.length === 0) {
      for (const line of raw.split("\n")) {
        const match = line.match(fileHeaderRegex);
        if (!match?.groups) continue;
        const path = (match.groups.path ?? "").replace(/^a\//, "").replace(/^b\//, "");
        let status = (match.groups.status ?? "").replace("_", "-") as FetchedDiff["files"][number]["status"];
        if (!["added", "removed", "modified", "renamed"].includes(status)) status = "modified";
        entries.push({ path, status, additions: 0, deletions: 0 });
      }
    }

    return entries;
  }

  private toChangeSet(diff: FetchedDiff): ReviewChangeSetSource {
    return {
      baseRevision: diff.baseCommit,
      currentRevision: diff.headCommit,
      committedPaths: diff.files.map((f) => f.path),
      stagedPaths: [],
      unstagedPaths: [],
      untrackedPaths: [],
      includedPaths: diff.files.map((f) => f.path),
      excludedPaths: [],
      generatedPaths: [],
      testPaths: [],
      configPaths: diff.files
        .filter((f) => /^(?:package\.json|tsconfig|\.github|Dockerfile|docker-compose|migration|alembic|prisma|knexfile|\.env)/i.test(f.path))
        .map((f) => f.path),
      documentationPaths: diff.files.filter((f) => /\.(md|rst|txt|adoc)$/i.test(f.path)).map((f) => f.path),
      partial: diff.files.length > 50,
      gitWritesPerformed: false,
    };
  }
}
