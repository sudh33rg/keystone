/** Framework-neutral cooperative cancellation used by QA workers. */
export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

export function cancellationFromAbortSignal(signal: AbortSignal): CancellationToken {
  return { get isCancellationRequested() { return signal.aborted; } };
}
