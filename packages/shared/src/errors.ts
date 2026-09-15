/**
 * The error taxonomy.
 *
 * Every failure the API returns to a caller is an `AppError`. Anything else
 * that reaches the error handler is, by definition, a bug: it is logged with
 * full detail and reported to the client as a bare 500 with a request id and
 * nothing else. That split is deliberate — see the "Security Misconfiguration"
 * and "Logging and Monitoring Failures" sections of
 * docs/03-security/owasp-top-10.md.
 */

export const ERROR_CODES = [
  'validation_failed',
  'unauthenticated',
  'invalid_credentials',
  'token_expired',
  'token_revoked',
  'forbidden',
  'not_found',
  'conflict',
  'precondition_failed',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'dependency_failed',
  'not_implemented',
  'internal_error',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 422,
  unauthenticated: 401,
  invalid_credentials: 401,
  token_expired: 401,
  token_revoked: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  precondition_failed: 412,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  dependency_failed: 502,
  not_implemented: 501,
  internal_error: 500,
};

/** A single field-level problem, safe to show a user. */
export interface FieldIssue {
  path: string;
  message: string;
}

/** The exact JSON body the API returns for any handled failure. */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    issues?: FieldIssue[];
    requestId?: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues: FieldIssue[] | undefined;
  /** Context for the log line only. Never serialized to the client. */
  readonly details: Record<string, unknown> | undefined;
  /** `true` for errors the caller can act on; `false` means "this is our bug". */
  readonly expected: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      issues?: FieldIssue[];
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.issues = options.issues;
    this.details = options.details;
    this.expected = this.status < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  toBody(requestId?: string): ErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues ? { issues: this.issues } : {}),
        ...(requestId ? { requestId } : {}),
      },
    };
  }

  static is(value: unknown): value is AppError {
    return value instanceof AppError;
  }
}

/* -- Constructors. Use these rather than `new AppError` at call sites. ----- */

export const validationFailed = (issues: FieldIssue[], message = 'Request validation failed') =>
  new AppError('validation_failed', message, { issues });

export const unauthenticated = (message = 'Authentication required') =>
  new AppError('unauthenticated', message);

export const invalidCredentials = (message = 'Email or password is incorrect') =>
  new AppError('invalid_credentials', message);

export const tokenExpired = (message = 'Token has expired') =>
  new AppError('token_expired', message);

export const tokenRevoked = (message = 'Token is no longer valid') =>
  new AppError('token_revoked', message);

export const forbidden = (message = 'You do not have access to this resource') =>
  new AppError('forbidden', message);

/**
 * Not-found and forbidden are intentionally both reported as 404 for resources
 * outside the caller's organization, so the API never confirms the existence of
 * another tenant's records.
 */
export const notFound = (resource: string, id?: string) =>
  new AppError('not_found', `${resource} not found`, id ? { details: { id } } : {});

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new AppError('conflict', message, details ? { details } : {});

export const preconditionFailed = (message: string) =>
  new AppError('precondition_failed', message);

export const rateLimited = (message = 'Too many requests') =>
  new AppError('rate_limited', message);

export const payloadTooLarge = (message = 'Payload exceeds the permitted size') =>
  new AppError('payload_too_large', message);

export const unsupportedMediaType = (message: string) =>
  new AppError('unsupported_media_type', message);

export const dependencyFailed = (dependency: string, cause?: unknown) =>
  new AppError('dependency_failed', `Upstream dependency "${dependency}" failed`, {
    details: { dependency },
    cause,
  });

export const notImplemented = (what: string) =>
  new AppError('not_implemented', `${what} is not implemented yet`);

export const internalError = (cause?: unknown) =>
  new AppError('internal_error', 'An unexpected error occurred', { cause });
