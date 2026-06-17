import { describe, expect, it } from "vitest";
import editPageSource from "../../pages/activate-ri-2026/edit/[token].astro?raw";

describe("activate-ri edit token page", () => {
  it("shows the reference map and does not show the edit link resend form", () => {
    expect(editPageSource).toContain("ReferenceMap");
    expect(editPageSource).not.toContain("EditLinkResendForm");
  });
});
