import { describe, expect, it } from "vitest";
import { canResumeSignIn, signInReturnPath } from "./auth-sign-in";

describe("signInReturnPath", () => {
  it("preserves destinations, query selections, and inherited redirect fragments", () => {
    expect(signInReturnPath("/activate-ri-2026/activator/media/?kind=photo", "#upload"))
      .toBe("/activate-ri-2026/activator/media/?kind=photo#upload");
    expect(signInReturnPath("/account/security/#sessions", "#other"))
      .toBe("/account/security/#sessions");
  });

  it.each([
    null, "https://example.com/", "//example.com/", "/\\example.com/",
    "/account/sign-in", "/account/sign-in/?returnTo=%2Faccount%2Fsecurity%2F#signin",
    "/account/sign-in///", "/account/access/#token",
    "/activate-ri-2026/access/#token", "/activate-ri-2026/edit/token/",
  ])("falls back to account security for unsafe or authentication destinations: %s", (path) => {
    expect(signInReturnPath(path)).toBe("/account/security/");
  });

  it("validates the combined destination and inherited fragment", () => {
    expect(signInReturnPath("/account/security/", "#" + "a".repeat(2048)))
      .toBe("/account/security/");
    expect(signInReturnPath("/account/security/", "#bad\nfragment"))
      .toBe("/account/security/");
  });
});

describe("canResumeSignIn", () => {
  const activatorSession = {
    signedIn: true,
    sessionPurpose: "authenticated",
    activator: { callsign: "N1TST" },
    adminAuthorized: false,
  };

  it("resumes an activator's portal and public-page destinations", () => {
    expect(canResumeSignIn(activatorSession, "/activate-ri-2026/activator/media/#upload")).toBe(true);
    expect(canResumeSignIn(activatorSession, "/activate-ri-2026/parks/?mine=1")).toBe(true);
  });

  it("requires membership before returning an account holder to the activator portal", () => {
    expect(canResumeSignIn({ ...activatorSession, activator: null }, "/activate-ri-2026/activator/"))
      .toBe(false);
  });

  it("requires server-confirmed administrator authorization", () => {
    const path = "/activate-ri-2026/admin/?tab=accounts";
    expect(canResumeSignIn({ ...activatorSession, admin: true }, path)).toBe(false);
    expect(canResumeSignIn({ ...activatorSession, adminAuthorized: true }, path)).toBe(true);
  });

  it.each(["enrollment", "recovery"])("only resumes account setup with a %s session", (sessionPurpose) => {
    const session = { ...activatorSession, sessionPurpose, adminAuthorized: true };
    expect(canResumeSignIn(session, "/account/security/#passkeys")).toBe(true);
    expect(canResumeSignIn(session, "/activate-ri-2026/activator/")).toBe(false);
    expect(canResumeSignIn(session, "/activate-ri-2026/admin/")).toBe(false);
  });

  it.each([null, {}, { signedIn: false }, { signedIn: true }, {
    signedIn: true, sessionPurpose: "unknown",
  }])("keeps sign-in available for missing, expired, or malformed sessions: %j", (session) => {
    expect(canResumeSignIn(session, "/account/security/")).toBe(false);
  });
});
