export type ErrorCategory =
  | "WORKSPACE"
  | "INDEXING"
  | "PARSING"
  | "PERSISTENCE"
  | "COPILOT"
  | "AGENT"
  | "CONTEXT"
  | "VALIDATION"
  | "TERMINAL"
  | "WEBVIEW"
  | "CONFIGURATION"
  | "INTERNAL";

export interface SerializedKeystoneError {
  code: string;
  category: ErrorCategory;
  message: string;
  technicalDetails?: string;
  operation: string;
  recoverable: boolean;
  recommendedAction: string;
  retryable: boolean;
  correlationId: string;
}

interface KeystoneErrorOptions {
  code: string;
  category: ErrorCategory;
  message: string;
  technicalDetails?: string;
  operation: string;
  recoverable?: boolean;
  recommendedAction: string;
  retryable?: boolean;
  correlationId?: string;
  cause?: unknown;
}

export class KeystoneError extends Error {
  readonly code: string;
  readonly category: ErrorCategory;
  readonly technicalDetails?: string;
  readonly operation: string;
  readonly recoverable: boolean;
  readonly recommendedAction: string;
  readonly retryable: boolean;
  readonly correlationId: string;

  constructor(options: KeystoneErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "KeystoneError";
    this.code = options.code;
    this.category = options.category;
    this.technicalDetails = options.technicalDetails;
    this.operation = options.operation;
    this.recoverable = options.recoverable ?? true;
    this.recommendedAction = options.recommendedAction;
    this.retryable = options.retryable ?? false;
    this.correlationId = options.correlationId ?? crypto.randomUUID();
  }

  serialize(): SerializedKeystoneError {
    return {
      code: this.code,
      category: this.category,
      message: this.message,
      technicalDetails: this.technicalDetails,
      operation: this.operation,
      recoverable: this.recoverable,
      recommendedAction: this.recommendedAction,
      retryable: this.retryable,
      correlationId: this.correlationId,
    };
  }

  static fromUnknown(error: unknown, operation: string, correlationId?: string): KeystoneError {
    if (error instanceof KeystoneError) return error;
    return new KeystoneError({
      code: "KEYSTONE_INTERNAL_ERROR",
      category: "INTERNAL",
      message: "Keystone could not complete the operation.",
      technicalDetails: error instanceof Error ? error.message : String(error),
      operation,
      recoverable: true,
      recommendedAction: "Review the Keystone logs and retry the operation.",
      retryable: true,
      correlationId,
      cause: error,
    });
  }
}
