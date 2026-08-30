import { describe, expect, it } from "vitest";
import roomSource from "../../components/activate-ri/ActivatorOpsRoom.astro?raw";
import portalNavSource from "../../components/activate-ri/ActivatorPortalNav.astro?raw";
import portalSource from "../../pages/activate-ri-2026/activator/index.astro?raw";

describe("Activator Ops Room client", () => {
  it("uses a WebSocket with cursor catch-up and no periodic polling", () => {
    expect(roomSource).toContain("new WebSocket");
    expect(roomSource).toContain("highWatermark");
    expect(roomSource).toContain("/api/activate-ri-2026/ops/events?after=");
    expect(roomSource).not.toContain("setInterval");
  });

  it("pauses in the background and requires explicit resend of stored drafts", () => {
    expect(roomSource).toContain('document.addEventListener("visibilitychange"');
    expect(roomSource).toContain("30_000");
    expect(roomSource).toContain('indexedDB.open("activate-ri-ops"');
    expect(roomSource).toContain("Not sent");
    expect(roomSource).not.toContain("sync.register");
  });

  it("renders message content as text and preserves the unofficial-site notice", () => {
    expect(roomSource).toContain("body.textContent");
    expect(roomSource).not.toContain("innerHTML");
    expect(portalSource).toContain("<Notice />");
  });

  it("keeps event navigation above a secondary Activator tools navigation", () => {
    expect(portalSource.indexOf("<EventNav />")).toBeLessThan(
      portalSource.indexOf("<ActivatorPortalNav />"),
    );
    expect(portalSource).not.toContain("showEventLink compact");
    expect(portalNavSource).toContain('class="event-nav activator-tools-nav"');
    expect(portalNavSource).toContain('aria-label="Activator tools"');
  });

  it("requires explicit confirmation before signing out of the browser", () => {
    expect(portalNavSource).not.toContain(">Exit<");
    expect(portalNavSource).toContain("Sign out of this browser?");
    expect(portalNavSource).toContain("You’ll need your private email link to get back in.");
    expect(portalNavSource).toContain("signoutDialog?.showModal()");
    expect(portalNavSource.indexOf('method: "DELETE"')).toBeGreaterThan(
      portalNavSource.indexOf('signoutConfirm?.addEventListener("click"'),
    );
  });
});
