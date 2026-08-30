import { describe, expect, it } from "vitest";
import { withPrivateHeaders } from "./private-response";

describe("private responses", () => {
  it("prevents storage, indexing, and referrer leakage", () => {
    const response = withPrivateHeaders(new Response("private"));

    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
  });

  it("allows Turnstile only on the editor response profile", () => {
    const portal = withPrivateHeaders(new Response(), "portal");
    const editor = withPrivateHeaders(new Response(), "editor");

    expect(portal.headers.get("content-security-policy")).toContain(
      "frame-src 'none'",
    );
    expect(editor.headers.get("content-security-policy")).toContain(
      "frame-src https://challenges.cloudflare.com",
    );
  });
});
