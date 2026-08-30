import { describe, expect, it } from "vitest";
import progress from "./PotaParkProgress.astro?raw";
import hero from "./EventHero.astro?raw";
import map from "../ReferenceMap.astro?raw";
import parksPage from "../../pages/activate-ri-2026/parks.astro?raw";
import admin from "./AdminPotaStatus.astro?raw";

describe("Activate RI POTA result surfaces", () => {
  it("keeps planning UI and switches the existing hero/parks route by event phase", () => {
    expect(hero).toContain('"event-live", "post-event"');
    expect(hero).toContain("Confirmed by POTA");
    expect(hero).toContain("Without confirmation");
    expect(hero).toContain('href="/activate-ri-2026/parks/"');
    expect(parksPage).toContain("showPotaResults ? <PotaParkProgress /> : <ParkCoverageTable />");
  });

  it("provides textual status filters, evidence details, schedules, official links, and source-of-truth copy", () => {
    for (const label of ["All", "Confirmed", "Observed", "Scheduled", "Still needed"]) {
      expect(progress).toContain(`> ${label}</label>`);
    }
    expect(progress).toContain("All POTA event activation rows");
    expect(progress).toContain("Planned event stops");
    expect(progress).toContain("Open official POTA park page");
    expect(progress).toContain("Official Parks on the Air");
    expect(progress).toContain("never POTA confirmation");
  });

  it("uses result map colors, text popups, current-spot overlay, and reduced-motion-compatible live marker class", () => {
    expect(map).toContain('confirmed: "#2d7a4b"');
    expect(map).toContain('observed: "#b56b00"');
    expect(map).toContain('scheduled: "#0b7180"');
    expect(map).toContain('needed: "#707b78"');
    expect(map).toContain("POTA confirmed");
    expect(map).toContain("On air now");
    expect(map).toContain("reference-map-marker--live");
  });

  it("provides protected organizer observability and a deep reconciliation control", () => {
    expect(admin).toContain("Last live-spot ingest");
    expect(admin).toContain("Last successful history sync");
    expect(admin).toContain("Start final deep reconciliation");
    expect(admin).toContain("/api/activate-ri-2026/admin/pota-reconcile");
  });
});
