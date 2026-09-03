import { describe, expect, it } from "vitest";
import component from "./PotaSpotActivity.astro?raw";
import nav from "./EventNav.astro?raw";
import page from "../../pages/activate-ri-2026/activity.astro?raw";

describe("public POTA spot activity", () => {
  it("provides a public event page linked from event navigation", () => {
    expect(nav).toContain('["Activity", "/activate-ri-2026/activity/"]');
    expect(page).toContain('canonicalPath="/activate-ri-2026/activity/"');
    expect(page).toContain("<PotaSpotActivity />");
    expect(page).toContain('<SiteHeader variant="solid" showEventLink />');
  });

  it("shows public collection health and the requested event dimensions", () => {
    expect(component).toContain("How are we doing?");
    expect(component).toContain("Parks spotted");
    expect(component).toContain("Activators");
    expect(component).toContain("Modes");
    expect(component).toContain("Bands");
    expect(component).toContain("First spotted");
    expect(component).toContain("Last spotted");
    expect(component).toContain("rolling 14-day collection window");
    expect(component).toContain("/api/activate-ri-2026/public/spot-activity");
  });

  it("keeps the unofficial-source-of-truth disclaimer visible", () => {
    expect(component).toContain("unofficial RI POTA community summary");
    expect(component).toContain("Official Parks on the Air");
    expect(component).toContain("A spot is activity evidence, not a confirmed activation");
  });
});
