import { describe, expect, it } from "vitest";
import accessPageSource from "../../pages/activate-ri-2026/access.astro?raw";
import planPageSource from "../../pages/activate-ri-2026/activators/plan.astro?raw";
import eventNavSource from "../../components/activate-ri/EventNav.astro?raw";
import siteDataSource from "../../data/site.ts?raw";

describe("activate-ri private activator pages", () => {
  it("exchanges fragment credentials without leaving them in browser history", () => {
    expect(accessPageSource).toContain("window.location.hash.slice(1)");
    expect(accessPageSource).toContain("window.history.replaceState");
    expect(accessPageSource).toContain("/api/activate-ri-2026/activator/session");
  });

  it("shows the reference map in the tokenless plan editor", () => {
    expect(planPageSource).toContain("ReferenceMap");
    expect(planPageSource).not.toContain("EditLinkResendForm");
  });

  it("offers a public Activator tab with session-aware access recovery", () => {
    expect(eventNavSource).toContain('["Activator", "/activate-ri-2026/activators/"]');
    expect(eventNavSource).toContain('"/activate-ri-2026/access/"');
    expect(eventNavSource).toContain('"/activate-ri-2026/volunteer/"');
    expect(accessPageSource).toContain("EditLinkResendForm");
    expect(accessPageSource).toContain("authorize this browser for 14 days");
    expect(accessPageSource).toContain("No active activator session was found");
    expect(accessPageSource).toContain("Plan an activation");
  });

  it("keeps the public event navigation focused on core and audience destinations", () => {
    expect(eventNavSource).not.toContain('["Volunteer",');
    expect(eventNavSource).not.toContain('["Help",');
    expect(eventNavSource.indexOf('["Hunter",')).toBeLessThan(
      eventNavSource.indexOf('["Activator",'),
    );
    expect(siteDataSource).toContain('label: "Activate All RI help"');
  });
});
