import { describe, expect, it } from "vitest";
import component from "./PotaSpotActivity.astro?raw";
import client from "../../lib/activate-ri/spot-activity-client?raw";
import nav from "./EventNav.astro?raw";
import page from "../../pages/activate-ri-2026/progress.astro?raw";
import adminPage from "../../pages/activate-ri-2026/admin.astro?raw";

describe("public POTA spot activity", () => {
  it("provides a progress page with phase-aware public navigation and an admin override", () => {
    expect(nav).toContain('["Progress", progressPath]');
    expect(nav).toContain("subscribeEventPhase");
    expect(adminPage).toContain("<EventNav showProgress />");
    expect(page).toContain("<EventNav />");
    expect(page).toContain('canonicalPath="/activate-ri-2026/progress/"');
    expect(page).toContain('id="progress-title">Event progress</h1>');
    expect(page).toContain("<PotaSpotActivity />");
    expect(page).toContain('<SiteHeader variant="solid" showEventLink />');
  });

  it("keeps headline metrics focused on coverage and participation", () => {
    const summary = component.match(/<dl\b[\s\S]*?<\/dl>/)?.[0] ?? "";
    for (const label of ["Parks spotted", "Not yet spotted", "Activators", "Modes", "Bands"]) {
      expect(summary).toContain(`<dt>${label}</dt>`);
    }
    for (const label of ["Spots retained", "RBN reports", "Non-RBN reports", "Non-RBN spotters"]) {
      expect(summary).not.toContain(label);
    }
  });

  it("preserves per-park spot details and collection status", () => {
    expect(component).toContain("How are we doing?");
    expect(component).toContain("Parks spotted");
    expect(component).toContain("Activators");
    expect(component).toContain("Modes");
    expect(component).toContain("Bands");
    expect(component).toContain('<th scope="col">Non-RBN spotters</th>');
    expect(component).toContain('<th scope="col">Spot reports</th>');
    expect(client).toContain("Declared N-fer");
    expect(component).toContain("First spotted");
    expect(component).toContain("Last spotted");
    expect(client).toContain("rolling 14-day collection window");
    expect(client).toContain("/api/activate-ri-2026/public/spot-activity");
  });

  it("keeps the spot caveat brief and retains the shared site disclaimer", () => {
    expect(component).toContain("Unofficial RI POTA summary. Spots aren’t confirmed activations.");
    expect(page).toContain("<Notice />");
  });

  it("briefly explains the missing-park order", () => {
    expect(component).toContain("No spots recorded yet. Parks with no remaining schedule or an elapsed window appear first.");
  });
});
