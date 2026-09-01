import { describe, expect, it } from "vitest";
import siteHeaderSource from "./SiteHeader.astro?raw";
import eventHomeSource from "../pages/activate-ri-2026/index.astro?raw";
import eventHelpSource from "../pages/activate-ri-2026/help.astro?raw";
import eventParksSource from "../pages/activate-ri-2026/parks.astro?raw";
import eventScheduleSource from "../pages/activate-ri-2026/schedule.astro?raw";
import eventHunterSource from "../pages/activate-ri-2026/hunter.astro?raw";

describe("shared header Activate All RI contract", () => {
  it("retains the event entry point when site-wide navigation gains additive links", () => {
    expect(siteHeaderSource).toContain(
      '{showEventLink && <a href="/activate-ri-2026/">Activate All RI</a>}',
    );
    expect(siteHeaderSource).toContain('<a href="/activate-ri-2026/">Event home</a>');
  });

  it("keeps every critical public event route opted into the event header", () => {
    const routes = [
      eventHomeSource,
      eventHelpSource,
      eventParksSource,
      eventScheduleSource,
      eventHunterSource,
    ];

    for (const route of routes) {
      expect(route).toContain('<SiteHeader variant="solid" showEventLink />');
      expect(route).toContain("<EventNav />");
    }
  });

  it("keeps the parks route as the public coverage/results surface", () => {
    expect(eventParksSource).toContain(
      "showPotaResults ? <PotaParkProgress /> : <ParkCoverageTable />",
    );
  });
});
