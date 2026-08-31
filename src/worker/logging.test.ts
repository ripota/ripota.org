import { afterEach, describe, expect, it, vi } from "vitest";
import { logWorkerError, sanitizeLogText } from "./logging";

afterEach(() => vi.restoreAllMocks());

describe("Worker error logging", () => {
  it("preserves diagnostic fields while redacting private values", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logWorkerError(
      "upstream-failed",
      new TypeError(
        "Request for person@example.com at /activate-ri-2026/edit/private-link failed?token=secret",
      ),
      { path: "/account/access", category: "network", attempt: 2 },
    );

    const entry = JSON.parse(String(logged.mock.calls[0][0])) as Record<string, unknown>;
    expect(entry).toEqual({
      event: "upstream-failed",
      path: "/account/access",
      category: "network",
      attempt: 2,
      errorName: "TypeError",
      errorMessage:
        "Request for [redacted-email] at /activate-ri-2026/edit/[redacted] failed?token=[redacted]",
    });
  });

  it("bounds log values and removes bearer and JWT credentials", () => {
    const jwt = "eyJheader12345.eyJpayload12345.signature12345";
    const value = sanitizeLogText(`Bearer secret ${jwt} ${"x".repeat(2_000)}`, 80);
    expect(value).toHaveLength(80);
    expect(value).toContain("Bearer [redacted]");
    expect(value).toContain("[redacted-token]");
    expect(value).not.toContain("secret");
    expect(value).not.toContain(jwt);
  });
});
