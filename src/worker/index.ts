import type { Env } from "./env";
import { requireAccessIdentity } from "./access";
import { json } from "./http";
import { handleActivateRiApi } from "./routes/activate-ri";

const activateRiAdminPathPattern = /^\/activate-ri-2026\/admin\/?$/;
const activateRiEditPathPattern = /^\/activate-ri-2026\/edit\/[^/]+\/?$/;
const activateRiEditShellPath = "/activate-ri-2026/edit/[token]/";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/activate-ri-2026/health") {
      return json({ ok: true, eventId: env.ACTIVATE_RI_EVENT_ID });
    }

    if (url.pathname.startsWith("/api/activate-ri-2026/")) {
      return handleActivateRiApi(request, env);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiAdminPathPattern.test(url.pathname)
    ) {
      const identity = await requireAccessIdentity(request, env);
      if (identity instanceof Response) {
        return identity;
      }

      return env.ASSETS.fetch(request);
    }

    if (
      (request.method === "GET" || request.method === "HEAD") &&
      activateRiEditPathPattern.test(url.pathname)
    ) {
      const shellUrl = new URL(request.url);
      shellUrl.pathname = activateRiEditShellPath;
      shellUrl.search = "";

      return env.ASSETS.fetch(new Request(shellUrl, request));
    }

    return env.ASSETS.fetch(request);
  },
};
