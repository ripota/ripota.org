import { describe, expect, it } from "vitest";
import source from "./CommunityByline.astro?raw";

describe("CommunityByline", () => {
  it("uses a keyboard-native form with bounded callsign and public-name validation", () => {
    expect(source).toContain('data-community-byline-form');
    expect(source).toContain('name="callsign"');
    expect(source).toContain('minlength="3"');
    expect(source).toContain('maxlength="24"');
    expect(source).toContain('pattern="[A-Za-z0-9]+(/[A-Za-z0-9]+)*"');
    expect(source).toContain('name="publicName"');
    expect(source).toContain('maxlength="80"');
    expect(source).toContain('type="submit"');
    expect(source).toContain('aria-live="polite"');
  });

  it("explains the public profile without exposing internal claim labels", () => {
    expect(source).toContain("Public contribution profile");
    expect(source).toContain("This is separate from your Activate RI registration and Ops Room name.");
    expect(source).not.toContain("Claim status:");
    expect(source).not.toContain("data-claim-status");
    expect(source).toContain("Your verified email stays private");
    expect(source).toContain("not official POTA or FCC verification");
    expect(source).toContain("A passkey proves continuity with this account—it does not prove callsign ownership.");
    expect(source).toContain("It remains private until you save this community byline.");
  });

  it("renders a public preview with text-only DOM updates and a single-column mobile layout", () => {
    expect(source).toContain('data-byline-preview');
    expect(source).toContain("preview?.replaceChildren");
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("@media (max-width: 560px)");
    expect(source).toContain("grid-template-columns: 1fr");
    expect(source).toContain("width: 100%");
  });
});
