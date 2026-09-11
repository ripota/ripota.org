import { describe, expect, it } from "vitest";
import progress from "./PotaParkProgress.astro?raw";
import hero from "./EventHeroContent.astro?raw";
import map from "../ReferenceMap.astro?raw";
import parksPage from "../../pages/activate-ri-2026/parks.astro?raw";
import parkEvidence from "../../lib/activate-ri/park-evidence.ts?raw";
import admin from "./AdminPotaStatus.astro?raw";

describe("Activate RI POTA result surfaces", () => {
  it("keeps planning UI and switches the existing hero/parks route by event phase", () => {
    expect(hero).toContain("subscribeEventPhase");
    expect(hero).toContain("Activated");
    expect(hero).toContain("On air now");
    expect(hero).toContain('href="/activate-ri-2026/parks/"');
    expect(parksPage).toContain("<EventPhaseViews>");
    expect(parksPage).toContain("<PotaParkProgress />");
    expect(parksPage).toContain("<ParkCoverageTable />");
  });

  it("keeps overall progress compact while the page provides a single park listing", () => {
    for (const statistic of ["confirmed", "observed", "scheduled", "needed"]) {
      expect(progress).toContain(`data-pota-${statistic}`);
    }
    expect(progress).toContain("data-pota-progress-bar");
    expect(progress).toContain("potaParkStatusStore.subscribe");
    expect(progress).not.toContain("data-pota-results");
    expect(progress).not.toContain("data-pota-search");
    expect(progress).not.toContain("data-pota-filters");
    expect(progress).not.toContain("<ReferenceMap");
    expect(parksPage.match(/<ParkCoverageTable\s*\/>/g)).toHaveLength(1);
    expect(parksPage).toContain("Show park map");
    expect(progress).toContain("Official Parks on the Air");
    expect(progress).toContain("never POTA confirmation");
  });

  it("preserves POTA evidence independently from planned stops", () => {
    expect(parkEvidence).toContain("Declared N-fer via");
    expect(parkEvidence).toContain("All POTA event activation rows");
    expect(parkEvidence).toContain("a current spot is activity evidence, not confirmation");
    expect(parkEvidence).toContain("Scheduled event coverage; no POTA confirmation yet.");
    expect(parkEvidence).toContain("Attempt recorded:");
    expect(parkEvidence).not.toContain("Planned event stops");
    expect(parkEvidence).not.toContain("Open local field guide");
  });

  it("uses result map colors, text popups, current-spot overlay, and reduced-motion-compatible live marker class", () => {
    expect(map).toContain('confirmed: "#2d7a4b"');
    expect(map).toContain('observed: "#2d7a4b"');
    expect(map).toContain('scheduled: "#3758c8"');
    expect(map).toContain('needed: "#707b78"');
    expect(map).toContain("Activated");
    expect(map).toContain("On air now");
    expect(map).toContain("reference-map-marker--live");
  });

  it("provides protected organizer observability and a deep reconciliation control", () => {
    expect(admin).toContain("Last live-spot ingest");
    expect(admin).toContain("Last successful history sync");
    expect(admin).toContain("Recheck all event parks");
    expect(admin).toContain("/api/activate-ri-2026/admin/pota-reconcile");
  });
});
