import { z } from "zod";

/**
 * Read-only repository contracts.
 *
 * These describe repository inspection results only. No mutation, remote, or
 * pull-request concept is represented here. This is the local-first security
 * boundary: Keystone reads status, revisions, changed files, diffs, and bounded
 * history, and never stages, commits, pushes, or interacts with remote PRs.
 */

export const RepositoryStatusSchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1).max(4096),
  repositoryDetected: z.boolean(),
  branch: z.string().max(250).optional(),
  revision: z.string().max(64).optional(),
  detachedHead: z.boolean(),
  operation: z.enum(["none", "merge", "rebase", "cherry-pick", "revert", "bisect", "unknown"]),
  conflictedFiles: z.array(z.string().max(1024)).max(5000),
  ahead: z.number().int().nonnegative().max(1_000_000),
  behind: z.number().int().nonnegative().max(1_000_000),
  fingerprint: z.string().min(1).max(128),
});
export type RepositoryStatus = z.infer<typeof RepositoryStatusSchema>;

export const RepositoryChangedFileSchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1).max(4096),
  path: z.string().min(1).max(1024),
  previousPath: z.string().min(1).max(1024).optional(),
  status: z.enum([
    "added",
    "modified",
    "deleted",
    "renamed",
    "copied",
    "untracked",
    "unmerged",
  ]),
  staged: z.boolean(),
  sourceKind: z.enum(["file", "hunk"]),
});
export type RepositoryChangedFile = z.infer<typeof RepositoryChangedFileSchema>;

export const RepositoryDiffSchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1).max(4096),
  path: z.string().min(1).max(1024),
  hunks: z
    .array(
      z.object({
        oldStart: z.number().int().nonnegative(),
        oldLines: z.number().int().nonnegative(),
        newStart: z.number().int().nonnegative(),
        newLines: z.number().int().nonnegative(),
        header: z.string().max(200),
        lines: z.array(z.string().max(2000)).max(5000),
      }),
    )
    .max(500),
});
export type RepositoryDiff = z.infer<typeof RepositoryDiffSchema>;

export const RepositoryHistoryEntrySchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1).max(4096),
  revision: z.string().min(1).max(64),
  shortRevision: z.string().min(1).max(64),
  author: z.string().max(250),
  timestamp: z.string().datetime(),
  message: z.string().max(2000),
});
export type RepositoryHistoryEntry = z.infer<typeof RepositoryHistoryEntrySchema>;

export const RepositoryIdentitySchema = z.object({
  schemaVersion: z.literal(1),
  repositoryRoot: z.string().min(1).max(4096),
  remoteUrl: z.string().max(2000).optional(),
  sanitizedRemoteUrl: z.string().max(2000).optional(),
  defaultBranch: z.string().max(250).optional(),
  revision: z.string().max(64).optional(),
  branch: z.string().max(250).optional(),
  fingerprint: z.string().min(1).max(128),
});
export type RepositoryIdentity = z.infer<typeof RepositoryIdentitySchema>;
