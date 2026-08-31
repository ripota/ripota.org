const clientErrorEndpoint = "/api/client-errors";
const maximumReportsPerPage = 5;
const maximumMessageLength = 500;
const maximumNameLength = 80;
const maximumRouteLength = 300;
const maximumSourceLength = 500;
const maximumStackLength = 4 * 1024;

export type ClientErrorReport = {
  version: 1;
  kind: "error" | "resource" | "unhandledrejection";
  name?: string;
  message: string;
  route: string;
  source?: string;
  stack?: string;
  line?: number;
  column?: number;
};

type PageLocation = {
  href: string;
  origin: string;
  pathname: string;
};

type ErrorDetails = {
  message?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  error?: unknown;
};

let installed = false;

export function installClientErrorReporter(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const fingerprints = new Set<string>();
  let reportsSent = 0;
  const report = (payload: ClientErrorReport): void => {
    if (reportsSent >= maximumReportsPerPage) return;
    const fingerprint = reportFingerprint(payload);
    if (fingerprints.has(fingerprint)) return;
    fingerprints.add(fingerprint);
    reportsSent += 1;
    sendReport(payload);
  };

  const handleWindowError: EventListener = (event) => {
    try {
      if (event instanceof ErrorEvent) {
        report(errorEventReport(event, window.location));
        return;
      }
      const resource = resourceErrorReport(event.target, window.location);
      if (resource) report(resource);
    } catch {
      // Telemetry must never create a second application failure.
    }
  };
  window.addEventListener("error", handleWindowError, true);

  window.addEventListener("unhandledrejection", (event) => {
    try {
      report(unhandledRejectionReport(event.reason, window.location));
    } catch {
      // Telemetry must never create a second application failure.
    }
  });
}

export function errorEventReport(
  event: ErrorDetails,
  location: PageLocation,
): ClientErrorReport {
  const error = event.error instanceof Error ? event.error : undefined;
  const message = error?.message || event.message || "Uncaught client error";
  return compactReport({
    version: 1,
    kind: "error",
    name: error?.name || "Error",
    message,
    route: location.pathname,
    source: event.filename ? safeSource(event.filename, location) : undefined,
    stack: error?.stack,
    line: locationNumber(event.lineno),
    column: locationNumber(event.colno),
  });
}

export function unhandledRejectionReport(
  reason: unknown,
  location: PageLocation,
): ClientErrorReport {
  const error = reason instanceof Error ? reason : undefined;
  return compactReport({
    version: 1,
    kind: "unhandledrejection",
    name: error?.name || "UnhandledRejection",
    message: error?.message || "Unhandled promise rejection",
    route: location.pathname,
    stack: error?.stack,
  });
}

function resourceErrorReport(
  target: EventTarget | null,
  location: PageLocation,
): ClientErrorReport | null {
  let source: string | undefined;
  let resourceType: "script" | "stylesheet" | undefined;
  if (target instanceof HTMLScriptElement && target.src) {
    source = target.src;
    resourceType = "script";
  } else if (
    target instanceof HTMLLinkElement &&
    target.relList.contains("stylesheet") &&
    target.href
  ) {
    source = target.href;
    resourceType = "stylesheet";
  }
  if (!source || !resourceType || !isSameOrigin(source, location)) {
    return null;
  }
  return compactReport({
    version: 1,
    kind: "resource",
    name: "ResourceLoadError",
    message: `Failed to load ${resourceType}`,
    route: location.pathname,
    source: safeSource(source, location),
  });
}

function compactReport(report: ClientErrorReport): ClientErrorReport {
  return {
    version: 1,
    kind: report.kind,
    name: boundedText(report.name, maximumNameLength),
    message: boundedText(report.message, maximumMessageLength) || "Client error",
    route: sanitizeRoute(report.route).slice(0, maximumRouteLength),
    source: boundedText(report.source, maximumSourceLength),
    stack: boundedText(report.stack, maximumStackLength),
    line: report.line,
    column: report.column,
  };
}

function sendReport(report: ClientErrorReport): void {
  const body = JSON.stringify(report);
  const blob = new Blob([body], { type: "application/json" });
  if (navigator.sendBeacon?.(clientErrorEndpoint, blob)) {
    return;
  }
  void fetch(clientErrorEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
}

function reportFingerprint(report: ClientErrorReport): string {
  return [
    report.kind,
    report.name,
    report.message,
    report.source,
    report.line,
    report.column,
  ].join("|");
}

function safeSource(source: string, location: PageLocation): string | undefined {
  try {
    const url = new URL(source, location.href);
    return url.origin === location.origin
      ? url.pathname
      : `${url.origin}${url.pathname}`;
  } catch {
    return undefined;
  }
}

function isSameOrigin(source: string, location: PageLocation): boolean {
  try {
    return new URL(source, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

function sanitizeRoute(route: string): string {
  const pathname = route.split(/[?#]/, 1)[0];
  return pathname.replace(
    /^(\/activate-ri-2026\/edit\/)[^/]+/,
    "$1[redacted]",
  );
}

function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  if (!value) return undefined;
  return redactClientText(value).slice(0, maximumLength);
}

function redactClientText(value: string): string {
  return value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .replace(
      /([?&](?:access_token|code|key|secret|session|token)=)[^&#\s]+/gi,
      "$1[redacted]",
    );
}

function locationNumber(value: number | undefined): number | undefined {
  return value === undefined || !Number.isSafeInteger(value) || value < 0
    ? undefined
    : Math.min(value, 10_000_000);
}
