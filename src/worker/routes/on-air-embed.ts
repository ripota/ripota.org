import { siteIdentity } from "../../data/site";
import { parkGuidePath } from "../../lib/parks/directory";
import { onAirEmbedBasePath, onAirEmbedPath, parseOnAirEmbedPath } from "../../lib/pota/on-air-embed";
import { formatRadioDetails } from "../../lib/pota/radio-details";
import { officialPotaSpotsUrl, type LivePotaSpot } from "../../lib/pota/spots";
import type { Env } from "../env";
import { captureWidgetRequest } from "../widget-analytics";
import { getRiPotaSpotsSnapshot, type PotaSpotsHandlerOptions, type RiPotaSpotsSnapshot } from "./pota";

const headers = {
  "cache-control": "no-store",
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'self' https:",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
};

export function isOnAirEmbedPath(pathname: string): boolean {
  return pathname === onAirEmbedBasePath.slice(0, -1) || pathname.startsWith(onAirEmbedBasePath);
}

export async function handleOnAirEmbed(
  request: Request,
  env: Pick<Env, "DB" | "ANALYTICS" | "REMOTE_DATA_READ_ONLY">,
  options: PotaSpotsHandlerOptions & { getSnapshot?: typeof getRiPotaSpotsSnapshot } = {},
  ctx?: ExecutionContext,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { ...headers, allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const parsed = parseOnAirEmbedPath(url.pathname);
  if (!parsed) return new Response(request.method === "HEAD" ? null : "Widget not found", { status: 404, headers });
  const preview = url.searchParams.get("preview") === "1";
  const action = url.searchParams.get("visit") === "1" ? "click"
    : url.searchParams.get("refresh") === "1" ? "refresh" : "load";

  // These are request counts, not unique visitors. Previews and HEAD probes are excluded.
  if (!preview && request.method === "GET") {
    await captureWidgetRequest(request, env, ctx, parsed.callsign ?? "generic", action,
      (options.now?.() ?? new Date()).toISOString());
  }
  if (action === "click") {
    const destination = new URL("/on-air/", url.origin);
    if (!preview) {
      destination.search = new URLSearchParams({
        utm_source: "qrz", utm_medium: "widget", utm_campaign: "ri-on-air",
        utm_content: parsed.callsign ?? "generic",
      }).toString();
    }
    return new Response(null, { status: 302, headers: { ...headers, location: destination.href } });
  }
  if (request.method === "HEAD") return new Response(null, { headers });

  const now = options.now ?? (() => new Date());
  const result = await (options.getSnapshot ?? getRiPotaSpotsSnapshot)(env, options);
  const html = renderOnAirEmbed(result.ok ? result.snapshot : null, {
    callsign: parsed.callsign, preview, now: now(),
  });
  return new Response(html, { headers });
}

export function renderOnAirEmbed(
  snapshot: RiPotaSpotsSnapshot | null,
  options: { callsign?: string | null; preview?: boolean; now?: Date } = {},
): string {
  const path = onAirEmbedPath(options.callsign);
  const previewQuery = options.preview ? "&preview=1" : "";
  const visit = escapeHtml(`${path}?visit=1${previewQuery}`);
  const refresh = escapeHtml(`${path}?refresh=1${previewQuery}`);
  const state = !snapshot ? "unavailable" : snapshot.stale ? "stale" : snapshot.spots.length ? "live" : "empty";
  const parks = new Set(snapshot?.spots.map(spot => spot.parkReference)).size;
  const status = !snapshot ? "Live status temporarily unavailable"
    : snapshot.stale ? "Updates delayed"
    : parks ? `${parks} Rhode Island ${parks === 1 ? "park" : "parks"} spotted` : "No current Rhode Island spots";
  const detail = !snapshot ? "Please check official POTA spots. We’ll try again in a minute."
    : snapshot.stale ? "Showing the last successful update; activity may have changed."
    : "Recent spots from the official POTA app. Refreshes every minute.";
  const spots = snapshot?.spots ?? [];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="60;url=${refresh}">
  <title>Rhode Island on air</title>
  <style>${styles}</style>
</head>
<body>
  <main class="widget" data-embed-state="${state}">
    <header>
      <img src="/assets/logos/ri-pota-coastal-signal.svg" width="56" height="56" alt="RI POTA">
      <div><p class="eyebrow">Parks on the Air · All year long</p><h1>Rhode Island on air</h1></div>
    </header>
    <section class="activity" aria-labelledby="activity-title">
      <div class="status"><h2 id="activity-title">${status}</h2><p>${detail}</p></div>
      ${spots.length ? `<div class="spot-scroll" tabindex="0" role="region" aria-label="Current Rhode Island spots"><ul>${spots.map(spot => renderSpot(spot, options.now ?? new Date())).join("")}</ul></div>`
        : `<p class="empty">${!snapshot ? "The live feed will return here when it’s available." : snapshot.stale ? "No unexpired spots remain in the last update. Check official POTA spots for current activity." : "The bands are quiet here for now. An activation may be underway but not spotted yet."}</p>`}
    </section>
    <div class="action"><a class="button" href="${visit}" target="_blank" rel="noreferrer">Full on-air view <span aria-hidden="true">→</span></a><span>${snapshot ? `Updated ${escapeHtml(formatUpdatedAt(snapshot.generatedAt))}` : "Retrying every minute"}</span></div>
    <footer><span>Community-run and unofficial.</span><a href="${officialPotaSpotsUrl}" target="_blank" rel="noreferrer">Official POTA spots</a></footer>
  </main>
</body>
</html>`;
}

function renderSpot(spot: LivePotaSpot, now: Date): string {
  const timestamp = /(Z|[+-]\d{2}:?\d{2})$/i.test(spot.spotTime) ? spot.spotTime : `${spot.spotTime}Z`;
  const minutes = Math.max(0, Math.floor((now.valueOf() - Date.parse(timestamp)) / 60_000));
  const age = !Number.isFinite(minutes) ? "Spot time unavailable" : minutes < 1 ? "Just spotted" : `Spotted ${minutes}m ago`;
  return `<li class="spot">
    <a class="park" href="${escapeHtml(`${siteIdentity.url}${parkGuidePath(spot.parkReference)}`)}" target="_blank" rel="noreferrer"><span>${escapeHtml(spot.parkReference)}</span> ${escapeHtml(spot.parkName)}</a>
    <div class="radio"><strong>${escapeHtml(spot.activatorCallsign)}</strong><span>${escapeHtml(formatRadioDetails(spot.frequency, spot.mode))}</span><time datetime="${escapeHtml(timestamp)}">${age}</time></div>
  </li>`;
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("en-US", {
    hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  }).format(date) : "time unavailable";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]!);
}

const styles = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color: #17221f; background: #fffdf7; }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  a { color: #063f4c; text-underline-offset: .18em; }
  a:focus-visible, .spot-scroll:focus-visible { outline: 3px solid #d7913a; outline-offset: -3px; }
  .widget { height: 100%; min-height: 360px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto auto; border: 1px solid #ccd2c7; }
  header { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: #18312f; color: #fffaf0; border-bottom: 3px solid #a87338; }
  header img { flex: 0 0 56px; }
  h1, h2, p { margin: 0; }
  h1 { font: bold clamp(23px, 4vw, 32px)/1.1 Georgia, serif; }
  .eyebrow { margin-bottom: 5px; color: #e5bc7b; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .activity { min-height: 0; display: flex; flex-direction: column; }
  .status { padding: 12px 18px 8px; }
  h2 { font-size: 14px; }
  .status p { margin-top: 3px; font-size: 11px; line-height: 1.4; color: #5b6761; }
  [data-embed-state="stale"] .status { background: #fff0d4; }
  .spot-scroll { overflow: auto; min-height: 0; padding: 0 18px; }
  ul { margin: 0; padding: 0; list-style: none; }
  .spot { padding: 9px 0; border-top: 1px solid #dfe1d6; }
  .park { font-size: 13px; font-weight: 750; line-height: 1.4; overflow-wrap: anywhere; }
  .park span { display: inline-block; margin-right: 5px; font-size: 11px; color: #765124; }
  .radio { display: flex; align-items: baseline; flex-wrap: wrap; gap: 3px 12px; margin-top: 4px; font-size: 12px; }
  .radio strong { color: #18312f; }
  time { margin-left: auto; font-size: 10px; color: #5b6761; }
  .empty { margin: auto 0; padding: 16px 18px; max-width: 60ch; font-size: 14px; line-height: 1.5; color: #5b6761; }
  .action { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; padding: 10px 18px; border-top: 1px solid #dfe1d6; }
  .button { display: inline-block; padding: 8px 12px; border-radius: 4px; background: #18312f; color: #fffaf0; font-size: 12px; font-weight: 750; text-decoration: none; }
  .button:hover { background: #264643; }
  .action > span { color: #5b6761; font-size: 10px; }
  footer { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 4px 10px; padding: 8px 18px; background: #f1ede2; font-size: 10px; color: #5b6761; }
  @media (max-width: 380px) { header { padding: 12px; gap: 8px; } header img { width: 44px; height: 44px; flex-basis: 44px; } h1 { font-size: 23px; } .eyebrow { font-size: 8px; } .status, .action, footer { padding-inline: 12px; } .spot-scroll { padding-inline: 12px; } }
`;
