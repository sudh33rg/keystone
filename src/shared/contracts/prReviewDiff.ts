import { z } from "zod";

export const PR_REVIEW_DIFF_SCHEMA_VERSION = 1 as const;
const Id = z.string().uuid();
const Path = z.string().min(1).max(1024);

export const PullRequestIdentitySchema = z.object({
  provider: z.enum(["github", "gitlab", "bitbucket", "unknown"]),
  owner: z.string().min(1).max(200),
  repo: z.string().min(1).max(200),
  prNumber: z.number().int().positive(),
  url: z.string().url().max(2000),
  branch: z.string().max(500).optional(),
  baseBranch: z.string().max(500).optional(),
  title: z.string().max(500).optional(),
  description: z.string().max(20_000).optional(),
});
export type PullRequestIdentity = z.infer<typeof PullRequestIdentitySchema>;

export const DiffFileSchema = z.object({
  path: Path,
  status: z.enum(["added", "removed", "modified", "renamed"]),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  patch: z.string().max(1_000_000).optional(),
  language: z.string().max(100).optional(),
  changedSymbols: z.array(z.string().min(1).max(1000)).max(500).default([]),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const PullRequestDiffSchema = z.object({
  schemaVersion: z.literal(PR_REVIEW_DIFF_SCHEMA_VERSION),
  pr: PullRequestIdentitySchema,
  baseCommit: z.string().max(200).optional(),
  headCommit: z.string().max(200).optional(),
  totalFiles: z.number().int().nonnegative(),
  totalAdditions: z.number().int().nonnegative(),
  totalDeletions: z.number().int().nonnegative(),
  files: z.array(DiffFileSchema).max(2000).default([]),
  reviewPackages: z
    .array(
      z.object({
        filePath: Path,
        startLine: z.number().int().nonnegative(),
        endLine: z.number().int().nonnegative(),
        packageId: Id,
        provider: z.string().max(200),
        url: z.string().url().max(2000),
      }),
    )
    .max(500)
    .default([]),
});
export type PullRequestDiff = z.infer<typeof PullRequestDiffSchema>;

export const PrReviewUrlRequestSchema = z.object({
  correlationId: z.string().min(1).max(200),
  prUrl: z.string().url().max(2000),
  includePatch: z.boolean().default(true),
  maxFiles: z.number().int().positive().max(500).default(200),
});
export type PrReviewUrlRequest = z.infer<typeof PrReviewUrlRequestSchema>;

export const PrReviewStartFromUrlRequestSchema = PrReviewUrlRequestSchema.extend({
  workflowId: z.string().min(1).max(200).optional(),
  confirmPartial: z.boolean().default(false),
  delegateFindings: z.boolean().default(true),
});
export type PrReviewStartFromUrlRequest = z.infer<typeof PrReviewStartFromUrlRequestSchema>;
