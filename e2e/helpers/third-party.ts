import type { Browser, BrowserContext } from "@playwright/test";

export async function createTestContext(browser: Browser, options?: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  await mockThirdPartyAssets(context);
  return context;
}

// Only browser-side provider assets are replaced. Worker APIs, D1, sessions,
// authorization, form submissions, and application error reporting remain real.
export async function mockThirdPartyAssets(context: BrowserContext): Promise<void> {
  await context.route("https://tile.openstreetmap.org/**", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#e8eddf" d="M0 0h256v256H0z"/><path stroke="#ced7c4" fill="none" d="M0 128h256M128 0v256M0 0h256v256H0z"/></svg>',
  }));
  await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", route => route.fulfill({
    contentType: "application/javascript",
    body: `(${turnstileFixture.toString()})();`,
  }));
}

function turnstileFixture(): void {
  type Options = {
    sitekey?: string;
    callback?: (token: string) => void;
    "response-field-name"?: string;
  };
  const token = "XXXX.DUMMY.TOKEN.XXXX";
  const widgets = new Map<string, { element: HTMLElement; options: Options; field: HTMLInputElement }>();
  let nextId = 0;
  function render(target: string | HTMLElement, options: Options = {}): string {
    const element = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!element) throw new Error("Turnstile fixture container is missing.");
    if ((options.sitekey ?? element.dataset.sitekey) !== "1x00000000000000000000AA") {
      throw new Error("Turnstile fixture requires the public test sitekey.");
    }
    for (const [id, widget] of widgets) if (widget.element === element) return id;
    const id = `test-widget-${++nextId}`;
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = options["response-field-name"] ?? "cf-turnstile-response";
    field.value = token;
    element.appendChild(field);
    widgets.set(id, { element, options, field });
    queueMicrotask(() => options.callback?.(token));
    return id;
  }
  const api = {
    render,
    ready(callback: () => void) { queueMicrotask(callback); },
    getResponse(id?: string) { return widgets.get(id ?? widgets.keys().next().value ?? "")?.field.value ?? ""; },
    reset(id?: string) {
      const widget = widgets.get(id ?? widgets.keys().next().value ?? "");
      if (widget) { widget.field.value = token; queueMicrotask(() => widget.options.callback?.(token)); }
    },
    remove(id: string) { widgets.get(id)?.field.remove(); widgets.delete(id); },
    isExpired() { return false; },
  };
  Object.assign(window, { turnstile: api });
  const renderImplicitWidgets = () => document.querySelectorAll<HTMLElement>(".cf-turnstile[data-sitekey]").forEach(element => render(element));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderImplicitWidgets, { once: true });
  else queueMicrotask(renderImplicitWidgets);
}
