import { useId } from "react";

export interface KeystoneUiAction {
  id: string;
  label: string;
  kind: "primary" | "secondary";
  run: () => void;
}

export interface KeystoneUiError {
  id: string;
  category: string;
  title: string;
  message: string;
  preservedState: boolean;
  retryable: boolean;
  recoveryActions: KeystoneUiAction[];
  technicalDetailsAvailable: boolean;
}

interface UiErrorOptions {
  category: string;
  title: string;
  fallbackMessage: string;
  preservedState?: boolean;
  retry?: () => void;
  dismiss?: () => void;
}

export function toUiError(cause: unknown, options: UiErrorOptions): KeystoneUiError {
  const message =
    cause instanceof Error && cause.message.trim()
      ? cause.message
      : typeof cause === "string" && cause.trim()
        ? cause
        : options.fallbackMessage;
  const recoveryActions: KeystoneUiAction[] = [];
  if (options.retry)
    recoveryActions.push({ id: "retry", label: "Try again", kind: "primary", run: options.retry });
  if (options.dismiss)
    recoveryActions.push({
      id: "dismiss",
      label: "Dismiss",
      kind: "secondary",
      run: options.dismiss,
    });
  return {
    id: `ui-${options.category}-${Date.now().toString(36)}`,
    category: options.category,
    title: options.title,
    message,
    preservedState: options.preservedState ?? true,
    retryable: Boolean(options.retry),
    recoveryActions,
    technicalDetailsAvailable: cause instanceof Error && Boolean(cause.stack),
  };
}

export function UiErrorState({ error }: { error: KeystoneUiError }): React.JSX.Element {
  return (
    <section className="ui-state ui-error" role="alert" aria-labelledby={`${error.id}-title`}>
      <div>
        <strong id={`${error.id}-title`}>{error.title}</strong>
        <p>{error.message}</p>
        <small>
          {error.preservedState
            ? "Your current state was preserved."
            : "Some unsaved UI state may need to be entered again."}
          {error.technicalDetailsAvailable ? ` Reference: ${error.id}.` : ""}
        </small>
      </div>
      {error.recoveryActions.length > 0 && (
        <div className="button-row" aria-label="Recovery actions">
          {error.recoveryActions.map((action) => (
            <button
              key={action.id}
              className={action.kind === "primary" ? "primary-button" : "ghost-button"}
              onClick={action.run}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function EmptyState({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: KeystoneUiAction;
}): React.JSX.Element {
  const titleId = useId();
  return (
    <section className="ui-state ui-empty" aria-labelledby={titleId}>
      <div>
        <strong id={titleId}>{title}</strong>
        <p>{message}</p>
      </div>
      {action && (
        <button
          className={action.kind === "primary" ? "primary-button" : "ghost-button"}
          onClick={action.run}
        >
          {action.label}
        </button>
      )}
    </section>
  );
}

export interface LoadingStateProps {
  message?: string;
  title?: string;
}

export function LoadingState({
  message = "Loading…",
  title,
}: LoadingStateProps): React.JSX.Element {
  const titleId = useId();
  return (
    <section
      className="loading-view"
      aria-live="polite"
      aria-labelledby={title ? titleId : undefined}
    >
      <div className="loader" aria-hidden="true" />
      {title && <strong id={titleId}>{title}</strong>}
      <p>{message}</p>
    </section>
  );
}

export function RecoveryNotice({
  recovery,
}: {
  recovery: { title: string; message: string; code: string };
}): React.JSX.Element {
  return (
    <section className="ui-state recovery-notice" role="status" aria-label="Recovery notice">
      <div>
        <strong>{recovery.title}</strong>
        <p>{recovery.message}</p>
        <small>Recovery code: {recovery.code}</small>
      </div>
    </section>
  );
}
