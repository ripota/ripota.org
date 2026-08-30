import { describe, expect, it } from "vitest";
import component from "./HunterChecklist.astro?raw";
import page from "../../pages/activate-ri-2026/hunter.astro?raw";
import nav from "./EventNav.astro?raw";

describe("hunter checklist surface", () => {
  it("uses the singular event route and navigation label", () => {
    expect(page).toContain('canonicalPath="/activate-ri-2026/hunter/"');
    expect(nav).toContain('["Hunter", "/activate-ri-2026/hunter/"]');
    expect(nav).not.toContain("/hunters/");
  });

  it("links to POTA My Stats and explains local-only import", () => {
    expect(component).toContain('href="https://pota.app/#/user/stats"');
    expect(component).toContain('rel="noopener noreferrer"');
    expect(component).toContain("Hunted Parks");
    expect(component).toContain("The file never leaves this browser");
    expect(component).toContain('accept=".csv,text/csv"');
  });

  it("provides accessible status, errors, progress, filtering, and local reset controls", () => {
    expect(component).toContain('role="status"');
    expect(component).toContain('role="alert"');
    expect(component).toContain("<progress");
    expect(component).toContain("data-hunter-search");
    expect(component).toContain("data-hunter-filter");
    expect(component).toContain("Reset manual changes");
    expect(component).toContain("Clear my checklist data");
  });
});
