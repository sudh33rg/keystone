/** Framework-neutral cooperative cancellation used by QA workers. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(): void;
}
