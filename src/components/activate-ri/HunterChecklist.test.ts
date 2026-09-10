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
    expect(component).toContain("formatHunterImportSummary(parsed)");
    expect(component).toContain("Reset manual changes");
    expect(component).toContain("Clear my checklist data");
  });

  it("summarizes visible opportunities and links to the canonical personal schedule", () => {
    expect(component).toContain("fetchPublicActivationStops");
    expect(component).toContain("scheduleVisibleStops");
    expect(component).toContain("View and print my schedule");
    expect(component).toContain("/activate-ri-2026/schedule/?scope=remaining");
    expect(component).toContain("announced activation window");
    expect(component).toContain('data-hunter-planner-copy aria-live="polite"');
    expect(component).not.toContain("Show event schedule");
  });

  it("discloses aggregate all-time telemetry while keeping import details local and honoring privacy signals", () => {
    const privacy = component.match(/<details class="hunter-privacy-details">([\s\S]*?)<\/details>/)?.[1] ?? "";
    expect(privacy).toMatch(/does not upload or retain your CSV/);
    expect(privacy).toMatch(/park reference IDs and individual checkbox choices stay in this browser/);
    expect(privacy).toMatch(/anonymous feature actions and their times, checklist totals and change direction/);
    expect(privacy).toMatch(/all-time checklist progress, not contacts made during the event/);
    expect(privacy).toMatch(/skipped when Global Privacy Control or Do Not Track is enabled/);
  });
});
