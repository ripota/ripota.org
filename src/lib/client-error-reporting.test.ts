import { describe, expect, it } from "vitest";
import {
  errorEventReport,
  unhandledRejectionReport,
} from "./client-error-reporting";

const location = {
  href: "https://ripota.org/activate-ri-2026/edit/private-token/?ignored=yes",
  origin: "https://ripota.org",
  pathname: "/activate-ri-2026/edit/private-token/",
};

describe("client error reporting", () => {
  it("builds a useful report without URL secrets or email addresses", () => {
    const error = new TypeError("Could not load person@example.com?token=secret");
    error.stack = `TypeError: person@example.com\n at https://ripota.org/app.js?token=hidden`;
    expect(errorEventReport({
      message: error.message,
      filename: "https://ripota.org/_astro/app.js?token=asset-secret",
      lineno: 42,
      colno: 7,
      error,
    }, location)).toEqual({
      version: 1,
      kind: "error",
      name: "TypeError",
      message: "Could not load [redacted-email]?token=[redacted]",
      route: "/activate-ri-2026/edit/[redacted]/",
      source: "/_astro/app.js",
      stack: "TypeError: [redacted-email]\n at https://ripota.org/app.js?token=[redacted]",
      line: 42,
      column: 7,
    });
  });

  it("does not serialize arbitrary promise rejection values", () => {
    expect(unhandledRejectionReport({
      email: "private@example.com",
      token: "secret",
    }, location)).toMatchObject({
      version: 1,
      kind: "unhandledrejection",
      name: "UnhandledRejection",
      message: "Unhandled promise rejection",
      route: "/activate-ri-2026/edit/[redacted]/",
    });
  });
});
