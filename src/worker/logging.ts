type WorkerLogValue = string | number | boolean | null | undefined;

export function logWorkerError(
  event: string,
  error: unknown,
  details: Record<string, WorkerLogValue> = {},
): void {
  const normalizedDetails = Object.fromEntries(
    Object.entries(details).map(([key, value]) => [
      key,
      typeof value === "string" ? sanitizeLogText(value, 500) : value,
    ]),
  );
  console.error(JSON.stringify({
    event,
    ...normalizedDetails,
    errorName: error instanceof Error ? sanitizeLogText(error.name, 80) : "UnknownError",
    errorMessage: error instanceof Error
      ? sanitizeLogText(error.message || "Unknown error", 1_000)
      : "Unknown error",
  }));
}

export function sanitizeLogText(value: string, maximumLength = 1_000): string {
  return value
    .replace(
      /(\/activate-ri-2026\/edit\/)[^/?#\s]+/gi,
      "$1[redacted]",
    )
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(
      /([?&](?:access_token|code|key|secret|session|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    )
    .slice(0, maximumLength);
}
