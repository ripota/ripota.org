import { safeLocalReturnPath } from "./auth-return-path";

const accountSecurityPath = "/account/security/";

export function signInReturnPath(requested: unknown, inheritedHash = ""): string {
  const path = safeLocalReturnPath(requested) ?? accountSecurityPath;
  const url = new URL(path, "https://return-path.invalid");
  // Returning to an authentication landing page would restart the same flow.
  if (/^\/account\/(?:sign-in|access)\/*$/.test(url.pathname) ||
    /^\/activate-ri-2026\/(?:access|edit)(?:\/|$)/.test(url.pathname)) return accountSecurityPath;

  // Browsers inherit the original fragment across a redirect without a fragment.
  // The Worker can preserve the path/query, but never receives this fragment.
  return safeLocalReturnPath(path + (!url.hash && inheritedHash.startsWith("#") ? inheritedHash : ""))
    ?? accountSecurityPath;
}

export function canResumeSignIn(session: unknown, returnTo: string): boolean {
  if (!isRecord(session) || session.signedIn !== true) return false;
  const purpose = session.sessionPurpose;
  if (purpose !== "authenticated" && purpose !== "enrollment" && purpose !== "recovery") return false;

  const pathname = new URL(returnTo, "https://return-path.invalid").pathname;
  if (/^\/activate-ri-2026\/admin(?:\/|$)/.test(pathname)) {
    return purpose === "authenticated" && session.adminAuthorized === true;
  }
  if (/^\/activate-ri-2026\/activator(?:\/|$)/.test(pathname)) {
    return purpose === "authenticated" && isRecord(session.activator);
  }
  // Enrollment and recovery sessions may continue setting up account security,
  // but do not grant access to the activator or administrator pages.
  return /^\/account\/security\/?$/.test(pathname) || purpose === "authenticated";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
