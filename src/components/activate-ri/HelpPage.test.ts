import { describe, expect, it } from "vitest";
import siteDataSource from "../../data/site.ts?raw";
import pageSource from "../../pages/activate-ri-2026/help.astro?raw";
import noticeSource from "../Notice.astro?raw";
import eventNavSource from "./EventNav.astro?raw";

describe("Activate All RI FAQ", () => {
  it("keeps the stable help route and exposes it as FAQ navigation", () => {
    expect(pageSource).toContain('canonicalPath="/activate-ri-2026/help/"');
    expect(eventNavSource).toContain('["FAQ", "/activate-ri-2026/help/"]');
    expect(pageSource).toContain('id="general-faq"');
    expect(pageSource).toContain('id="activator-faq"');
    expect(pageSource).toContain('id="hunter-faq"');
  });

  it("publishes the approved event, poster, cookout, and contact details", () => {
    expect(pageSource).toContain("Friday, September 11 through Sunday, September 13");
    expect(pageSource).toContain("all 61 Rhode");
    expect(pageSource).toContain("1gtihnT-KiDTAM71OzQ87f64ijt6jTXsA");
    expect(pageSource).toContain("forms.gle/sE3GeGEasuigx6u79");
    expect(pageSource).toContain('href="tel:+14012625225"');
    expect(pageSource).toContain('href="tel:+14014875958"');
  });

  it("includes the QRZ-piloted responsive snippet and editor steps", () => {
    expect(pageSource).toContain("Add or edit your biography text, fonts, etc.");
    expect(pageSource).toContain("choose <strong>Source</strong>");
    expect(pageSource).toContain('src="https://ripota.org/embed/activate-ri-2026/"');
    expect(pageSource).toContain("max-width: 960px");
    expect(pageSource).toContain('width="100%"');
    expect(pageSource).toContain('height="420"');
    expect(pageSource).toContain('scrolling="no"');
  });

  it("links activators to chat and hunters to the checklist and live route", () => {
    expect(pageSource).toContain("The schedule is an estimate");
    expect(pageSource).toContain('href="/activate-ri-2026/activator/"');
    expect(pageSource).toContain("Activators can use the in-app chat");
    expect(pageSource).not.toContain("Approved activators can use");
    expect(pageSource).toContain('href="/activate-ri-2026/hunter/"');
    expect(pageSource).toContain("hunter_parks.csv");
    expect(pageSource).toContain('href="/on-air/"');
    expect(pageSource).toContain("the on-air page is where to check live activity");
    expect(pageSource).toContain('href="https://docs.pota.app/"');
    expect(pageSource).toContain('href="https://pota.app/"');
  });

  it("retains the shared unofficial-site notice", () => {
    expect(pageSource).toContain("<Notice />");
    expect(noticeSource).toContain("siteIdentity.disclaimer");
    expect(siteDataSource).toContain("not an official Parks on the Air property");
  });
});
