export interface MappedProviderError {
  code: string;
  userMessage: string;
  retryable: boolean;
}

/** Redact any Bearer token or provider API key pattern from upstream error text. */
export function sanitizeErrorText(text: string): string {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-(?:sp-|ws-)?[A-Za-z0-9._-]{4,}/g, "[REDACTED_KEY]")
    .replace(/\bAQ\.[A-Za-z0-9._-]{8,}/g, "[REDACTED_KEY]")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}/g, "[REDACTED_KEY]");
}

interface ErrorRule {
  matches: (code: string | undefined, httpStatus: number) => boolean;
  defaultCode: string;
  userMessage: string;
  retryable: boolean;
}

const ERROR_RULES: ErrorRule[] = [
  {
    matches: (code) => code === "DataInspectionFailed",
    defaultCode: "DataInspectionFailed",
    userMessage:
      "Request was blocked by content moderation (DataInspectionFailed). Adjust the prompt or reference media and try again.",
    retryable: false,
  },
  {
    matches: (code, status) =>
      status === 429 ||
      code === "Throttling" ||
      code === "RequestLimitExceeded" ||
      code === "RESOURCE_EXHAUSTED" ||
      Boolean(code?.startsWith("Throttling.")),
    defaultCode: "Throttling",
    userMessage:
      "Provider rate limit reached (HTTP 429 / Throttling). Please retry shortly.",
    retryable: true,
  },
  {
    matches: (code, status) =>
      status === 401 ||
      status === 403 ||
      code === "InvalidApiKey" ||
      code === "Unauthorized" ||
      code === "AccessDenied" ||
      code === "UNAUTHENTICATED" ||
      code === "PERMISSION_DENIED" ||
      code === "API_KEY_INVALID",
    defaultCode: "InvalidApiKey",
    userMessage:
      "API authentication failed. Check your provider API key and endpoint settings in Settings → Providers.",
    retryable: false,
  },
  {
    matches: (code) =>
      code === "InsufficientQuota" ||
      code === "QuotaExceeded" ||
      code === "Arrearage",
    defaultCode: "InsufficientQuota",
    userMessage:
      "Account quota exceeded or billing is inactive on the provider account.",
    retryable: false,
  },
  {
    matches: (code) =>
      code === "InvalidParameter" ||
      code === "InvalidParameterValue" ||
      code === "MissingParameter" ||
      code === "INVALID_ARGUMENT",
    defaultCode: "InvalidParameter",
    userMessage:
      "Provider rejected one or more request parameters. Verify API key, model, and request settings.",
    retryable: false,
  },
  {
    matches: (code, status) =>
      status === 404 ||
      code === "ModelNotFound" ||
      code === "InvalidModel" ||
      code === "NOT_FOUND",
    defaultCode: "ModelNotFound",
    userMessage:
      "Requested model or endpoint was not found (404). Sync models and choose an available model in Settings → Models.",
    retryable: false,
  },
  {
    matches: (code, status) =>
      status === 408 ||
      status >= 500 ||
      code === "InternalError" ||
      code === "ServiceUnavailable" ||
      code === "UNAVAILABLE" ||
      code === "Timeout",
    defaultCode: "ServiceUnavailable",
    userMessage:
      "Upstream provider encountered a temporary server error or high demand. Try again shortly.",
    retryable: true,
  },
];

/**
 * Map a provider error code and HTTP status into a user-safe message and
 * retryability flag.
 */
export function mapProviderError(
  code: string | undefined,
  httpStatus: number,
): MappedProviderError {
  const normalizedCode = code?.trim() || undefined;

  for (const rule of ERROR_RULES) {
    if (rule.matches(normalizedCode, httpStatus)) {
      return {
        code: normalizedCode ?? rule.defaultCode,
        userMessage: rule.userMessage,
        retryable: rule.retryable,
      };
    }
  }

  const fallbackCode =
    normalizedCode ?? (httpStatus > 0 ? `HTTP_${httpStatus}` : "ProviderError");
  return {
    code: fallbackCode,
    userMessage:
      httpStatus >= 400
        ? `Provider request failed (${fallbackCode}, HTTP ${httpStatus}).`
        : `Provider request failed (${fallbackCode}).`,
    retryable: false,
  };
}

/** Structured error thrown when a provider HTTP request fails. */
export class ProviderHttpError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly retryable: boolean;

  constructor(mapped: MappedProviderError, httpStatus: number, detail?: string) {
    const safeDetail = detail ? ` (${sanitizeErrorText(detail)})` : "";
    super(`${mapped.userMessage}${safeDetail}`);
    this.name = "ProviderHttpError";
    this.code = mapped.code;
    this.httpStatus = httpStatus;
    this.userMessage = mapped.userMessage;
    this.retryable = mapped.retryable;
  }
}

/** Safely parse a DashScope, Gemini, or OpenAI-compatible error response body. */
export async function parseProviderErrorResponse(
  res: Response,
): Promise<ProviderHttpError> {
  let code: string | undefined;
  let detail: string | undefined;

  try {
    const text = await res.text();
    if (text) {
      try {
        const rawParsed = JSON.parse(text) as unknown;
        const unwrapped = Array.isArray(rawParsed) ? rawParsed[0] : rawParsed;
        const json = (unwrapped && typeof unwrapped === "object"
          ? unwrapped
          : {}) as {
          code?: unknown;
          status?: unknown;
          message?: unknown;
          error?: {
            code?: unknown;
            status?: unknown;
            message?: unknown;
            type?: unknown;
          };
        };
        if (typeof json.code === "string") code = json.code;
        else if (typeof json.error?.status === "string") code = json.error.status;
        else if (typeof json.error?.code === "string") code = json.error.code;
        else if (typeof json.error?.type === "string") code = json.error.type;
        else if (typeof json.status === "string") code = json.status;

        if (typeof json.message === "string") detail = json.message;
        else if (typeof json.error?.message === "string") {
          detail = json.error.message;
        }
      } catch {
        detail = text.slice(0, 300);
      }
    }
  } catch {
    // Ignore body read errors; HTTP status mapping still succeeds.
  }

  const mapped = mapProviderError(code, res.status);
  return new ProviderHttpError(mapped, res.status, detail);
}
