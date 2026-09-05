import { describe, expect, it } from "vitest";
import component from "./PotaSpotActivity.astro?raw";
import client from "../../lib/activate-ri/spot-activity-client?raw";
import nav from "./EventNav.astro?raw";
import page from "../../pages/activate-ri-2026/activity.astro?raw";
import adminPage from "../../pages/activate-ri-2026/admin.astro?raw";

describe("public POTA spot activity", () => {
  it("provides a public event page linked only from the admin navigation", () => {
    expect(nav).toContain('showActivity ? [["Activity", "/activate-ri-2026/activity/"]] : []');
    expect(adminPage).toContain("<EventNav showActivity />");
    expect(page).toContain("<EventNav />");
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
    expect(component).toContain("RBN reports");
    expect(component).toContain("Non-RBN reports");
    expect(client).toContain("Declared N-fer");
    expect(component).toContain("First spotted");
    expect(component).toContain("Last spotted");
    expect(client).toContain("rolling 14-day collection window");
    expect(client).toContain("/api/activate-ri-2026/public/spot-activity");
  });

  it("keeps the unofficial-source-of-truth disclaimer visible", () => {
    expect(component).toContain("unofficial RI POTA community summary");
    expect(component).toContain("Official Parks on the Air");
    expect(component).toContain("A spot is activity evidence, not a confirmed activation");
  });
});
