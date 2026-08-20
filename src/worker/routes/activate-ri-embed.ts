import { activateRi2026Event } from "../../data/activate-ri-2026/event";
import { eventRoute } from "../../lib/activate-ri/paths";
import type { EventPhase } from "../../lib/activate-ri/types";
import { officialPotaSpotsUrl, type LivePotaSpot } from "../../lib/pota/spots";
import type { Env } from "../env";
import {
  getRiPotaSpotsSnapshot,
  type PotaSpotsHandlerOptions,
  type RiPotaSpotsSnapshot,
  type RiPotaSpotsSnapshotResult,
} from "./pota";

const embedPath = "/embed/activate-ri-2026/";
const refreshSeconds = 60;

const embedHeaders = {
  "cache-control": "no-store",
  "content-security-policy": [
    "default-src 'none'",
    "img-src 'self'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors https:",
  ].join("; "),
  "content-type": "text/html; charset=utf-8",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export type ActivateRiEmbedView =
  | { kind: "pre-event" }
  | { kind: "post-event" }
  | { kind: "live"; snapshot: RiPotaSpotsSnapshot | null };

export type ActivateRiEmbedHandlerOptions = PotaSpotsHandlerOptions & {
  eventPhase?: EventPhase;
  getSnapshot?: (
    env: Pick<Env, "DB">,
    options: PotaSpotsHandlerOptions,
  ) => Promise<RiPotaSpotsSnapshotResult>;
};

export async function handleActivateRiEmbed(
  request: Request,
  env: Pick<Env, "DB">,
  options: ActivateRiEmbedHandlerOptions = {},
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }

  const url = new URL(request.url);
  const phase = options.eventPhase ?? activateRi2026Event.phase;
  const forceLive = url.searchParams.get("preview") === "live";
  const live = forceLive || phase === "event-live";
  const now = options.now ?? (() => new Date());
  let view: ActivateRiEmbedView;

  if (live) {
    const getSnapshot = options.getSnapshot ?? getRiPotaSpotsSnapshot;
    const result = await getSnapshot(env, {
      fetcher: options.fetcher,
      now,
      sleep: options.sleep,
    });
    view = {
      kind: "live",
      snapshot: result.ok ? result.snapshot : null,
    };
  } else if (phase === "post-event") {
    view = { kind: "post-event" };
  } else {
    view = { kind: "pre-event" };
  }

  const html = renderActivateRiEmbed(view, now());
  return new Response(request.method === "HEAD" ? null : html, {
    headers: embedHeaders,
  });
}

export function renderActivateRiEmbed(
  view: ActivateRiEmbedView,
  now: Date = new Date(),
): string {
  const event = activateRi2026Event;
  const dateRange = formatDateRange(event.mainStartDate, event.mainEndDate);
  const dayCount = inclusiveDayCount(event.mainStartDate, event.mainEndDate);
  const refresh = view.kind === "live"
    ? `<meta http-equiv="refresh" content="${refreshSeconds}">`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refresh}
  <title>${escapeHtml(event.name)}</title>
  <style>${styles}</style>
</head>
<body>
  <main class="widget widget--${view.kind}" data-embed-state="${view.kind}">
    <header class="flyer">
      <img class="logo" src="/assets/logos/ri-pota-coastal-signal.svg" width="88" height="88" alt="RI POTA coastal signal">
      <div class="flyer__copy">
        <p class="eyebrow">${escapeHtml(dateRange)} · Rhode Island</p>
        <h1>${escapeHtml(event.name)}</h1>
        <p class="headline">${event.goalParkCount} Rhode Island references <span aria-hidden="true">·</span> ${dayCount} days</p>
        <p class="invitation">Join activators and hunters for a community-wide weekend on the air.</p>
      </div>
    </header>
    ${renderPanel(view, now)}
    <footer>
      <span>Community-run and unofficial.</span>
      <a href="${officialPotaSpotsUrl}" target="_blank" rel="noreferrer">Official POTA data</a>
    </footer>
  </main>
</body>
</html>`;
}

function renderPanel(view: ActivateRiEmbedView, now: Date): string {
  if (view.kind === "pre-event") {
    return `<section class="panel panel--pre" aria-labelledby="widget-action">
      <div class="pre-state" aria-hidden="true">
        <svg viewBox="550 140 380 570" focusable="false">
          <path d="M803.8 383.8L808.0 371.7L813.7 386.1L808.5 388.5L826.9 401.6L816.7 426.5L811.6 416.5L816.9 398.3L803.8 383.8ZM799.6 498.8L811.9 486.3L812.1 493.9L821.1 489.0L815.8 463.4L823.5 461.1L841.8 398.4L865.6 378.8L869.6 389.0L877.1 366.7L906.1 376.0L902.4 408.6L911.8 476.7L877.8 502.1L879.6 484.8L865.3 437.4L870.5 438.8L873.3 415.6L866.1 397.4L856.2 401.3L862.1 457.6L852.8 481.1L856.3 489.9L835.5 481.9L824.0 505.4L817.7 499.8L803.9 506.2L799.6 498.8ZM782.2 499.3L796.2 429.3L803.6 488.2L794.0 491.3L788.8 482.7L791.0 494.9L782.6 506.9L782.1 503.0L782.2 499.3ZM683.8 685.4L698.8 658.7L700.2 641.5L711.1 652.8L705.4 670.5L714.4 689.5L689.9 693.6L684.5 689.3L683.8 685.4ZM568.2 592.2L583.6 572.6L577.5 530.9L598.3 526.7L603.3 378.6L597.6 160.6L791.1 154.0L790.9 231.7L810.8 228.5L809.9 290.5L815.8 301.5L846.6 318.9L863.6 344.8L853.8 353.1L857.2 372.6L845.8 386.6L835.4 362.2L828.1 382.3L832.8 349.7L825.4 337.9L810.5 335.9L796.5 311.4L798.6 303.3L786.8 299.5L791.2 334.4L802.2 341.0L792.7 372.0L786.8 361.2L759.2 359.7L762.3 374.2L778.4 374.1L781.3 403.6L774.6 410.2L780.7 419.8L761.0 423.6L775.3 456.6L773.9 492.0L756.6 516.6L757.9 531.0L745.0 561.6L734.8 553.0L712.3 552.8L636.1 579.7L568.2 592.2Z"/>
        </svg>
      </div>
      <div class="pre-copy">
        <p class="panel__kicker">A statewide POTA challenge</p>
        <h2 id="widget-action">Put all ${activateRi2026Event.goalParkCount} Rhode Island references on the air.</h2>
        <p class="pre-summary">Activators will coordinate routes across the state while hunters follow the action throughout the three-day weekend.</p>
      </div>
      <div class="pre-action">${scheduleLink("Explore the schedule")}</div>
    </section>`;
  }

  if (view.kind === "post-event") {
    return `<section class="panel panel--centered" aria-labelledby="widget-action">
      <p class="panel__kicker">Thank you, Rhode Island</p>
      <p id="widget-action" class="panel__message">Thanks to everyone who activated, hunted, and helped make the weekend possible.</p>
      ${scheduleLink("Visit the event page", eventRoute("home"))}
    </section>`;
  }

  if (!view.snapshot) {
    return `<section class="panel panel--centered panel--live" aria-labelledby="live-title">
      <p class="live-dot"><span aria-hidden="true"></span> Event live</p>
      <h2 id="live-title">Live status temporarily unavailable</h2>
      <p class="panel__message">The event flyer is still current. Check the schedule or official POTA spots for the latest activity.</p>
      <div class="links">${scheduleLink("Event schedule")} ${potaLink()}</div>
    </section>`;
  }

  const spots = view.snapshot.spots.slice(0, 2);
  if (spots.length === 0) {
    return `<section class="panel panel--centered panel--live" aria-labelledby="live-title">
      <p class="live-dot"><span aria-hidden="true"></span> Event live</p>
      <h2 id="live-title">No current Rhode Island spots</h2>
      <p class="panel__message">Activations may be between stops or not spotted yet. Check the schedule and official POTA spots.</p>
      <div class="links">${scheduleLink("Event schedule")} ${potaLink()}</div>
    </section>`;
  }

  const moreCount = Math.max(0, view.snapshot.spots.length - spots.length);
  const staleNotice = view.snapshot.stale
    ? `<p class="stale">Live status is delayed; showing the last successful update.</p>`
    : "";
  const more = moreCount > 0
    ? `<a class="more" href="${eventRoute("schedule")}" target="_blank" rel="noreferrer">+${moreCount} more · full status</a>`
    : scheduleLink("Full schedule");

  return `<section class="panel panel--spots panel--live" aria-labelledby="live-title">
    <div class="panel__heading">
      <div>
        <p class="live-dot"><span aria-hidden="true"></span> Event live</p>
        <h2 id="live-title">On air in Rhode Island</h2>
      </div>
      ${more}
    </div>
    ${staleNotice}
    <ol class="spots">${spots.map((spot) => renderSpot(spot, now)).join("")}</ol>
  </section>`;
}

function renderSpot(spot: LivePotaSpot, now: Date): string {
  const parkUrl = `https://pota.app/#/park/${encodeURIComponent(spot.parkReference)}`;
  const timestamp = normalizedSpotTimestamp(spot.spotTime);
  const age = formatSpotAge(timestamp, now);

  return `<li class="spot">
    <div class="spot__topline">
      <strong>${escapeHtml(spot.activatorCallsign)}</strong>
      <span>${escapeHtml(spot.frequency)} kHz · ${escapeHtml(spot.mode)}</span>
    </div>
    <div class="spot__detail">
      <a href="${escapeHtml(parkUrl)}" target="_blank" rel="noreferrer">${escapeHtml(spot.parkReference)} · ${escapeHtml(spot.parkName)}</a>
      <time datetime="${escapeHtml(timestamp)}">${escapeHtml(age)}</time>
    </div>
  </li>`;
}

function scheduleLink(
  label: string,
  href = eventRoute("schedule"),
): string {
  return `<a class="button" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)} <span aria-hidden="true">→</span></a>`;
}

function potaLink(): string {
  return `<a class="text-link" href="${officialPotaSpotsUrl}" target="_blank" rel="noreferrer">Official POTA spots</a>`;
}

function normalizedSpotTimestamp(value: string): string {
  return /(Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
}

function formatSpotAge(value: string, now: Date): string {
  const spottedAt = new Date(value);
  if (!Number.isFinite(spottedAt.valueOf())) {
    return "Spot time unavailable";
  }

  const elapsedMinutes = Math.max(
    0,
    Math.floor((now.valueOf() - spottedAt.valueOf()) / 60_000),
  );
  if (elapsedMinutes < 1) {
    return "Spotted just now";
  }
  if (elapsedMinutes < 60) {
    return `Spotted ${elapsedMinutes}m ago`;
  }

  return `Spotted ${new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(spottedAt)}`;
}

function formatDateRange(start: string, end: string): string {
  const startDate = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(startDate);
  return `${month} ${startDate.getUTCDate()}–${endDate.getUTCDate()}, ${endDate.getUTCFullYear()}`;
}

function inclusiveDayCount(start: string, end: string): number {
  const startTime = Date.parse(`${start}T00:00:00Z`);
  const endTime = Date.parse(`${end}T00:00:00Z`);
  return Math.floor((endTime - startTime) / 86_400_000) + 1;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

const styles = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #17221f; background: #f7f4ed; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-width: 280px; min-height: 100%; }
  body { background: #f7f4ed; }
  a { color: inherit; text-underline-offset: 0.18em; }
  a:focus-visible { outline: 3px solid #d7913a; outline-offset: 2px; }
  .widget { min-height: 420px; height: 100vh; max-height: 440px; display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; border: 1px solid rgba(31, 55, 51, 0.22); background: #fffdf7; }
  .flyer { display: grid; grid-template-columns: 88px 1fr; align-items: center; gap: 16px; padding: 18px 20px 16px; border-bottom: 4px solid #a87338; background: #18312f; color: #fffaf0; }
  .logo { width: 88px; height: 88px; }
  .flyer__copy { min-width: 0; }
  .eyebrow, .headline, .invitation, .panel p { margin: 0; }
  .eyebrow { margin-bottom: 3px; color: #e5bc7b; font-size: 11px; font-weight: 850; letter-spacing: 0.1em; text-transform: uppercase; }
  h1, h2 { margin: 0; font-family: Georgia, "Times New Roman", serif; line-height: 1.02; }
  h1 { color: #fffaf0; font-size: clamp(27px, 5vw, 42px); }
  h2 { color: #18312f; font-size: 21px; }
  .headline { margin-top: 5px; color: #fffaf0; font-size: 14px; font-weight: 850; }
  .invitation { margin-top: 4px; color: rgba(255, 250, 240, 0.82); font-size: 12px; line-height: 1.3; }
  .panel { min-height: 0; padding: 16px 20px; background: linear-gradient(135deg, rgba(168, 115, 56, 0.09), transparent 52%), #fffdf7; }
  .panel--pre { display: grid; grid-template-columns: minmax(100px, 0.55fr) minmax(0, 2.25fr) minmax(180px, 0.85fr); align-items: center; gap: clamp(18px, 3vw, 32px); }
  .pre-state { align-self: stretch; display: grid; min-width: 0; place-items: center; border-right: 1px solid rgba(168, 115, 56, 0.4); padding-right: clamp(12px, 2.5vw, 24px); }
  .pre-state svg { width: min(100%, 100px); max-height: 150px; overflow: visible; fill: rgba(168, 115, 56, 0.16); stroke: #765124; stroke-linecap: round; stroke-linejoin: round; stroke-width: 7; }
  .pre-copy { min-width: 0; }
  .pre-copy h2 { max-width: 22ch; font-size: clamp(25px, 3.35vw, 34px); line-height: 1.06; }
  .pre-summary { max-width: 58ch; margin-top: 9px !important; color: #3f4e48; font-size: 14px; line-height: 1.38; }
  .pre-action { display: flex; justify-content: flex-end; }
  .pre-action .button { min-height: 52px; padding: 12px 16px; background: #18312f; font-size: 14px; white-space: nowrap; }
  .pre-action .button:hover { background: #264643; }
  .panel--centered { display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 8px; }
  .panel__kicker, .live-dot { color: #765124; font-size: 11px; font-weight: 900; letter-spacing: 0.1em; text-transform: uppercase; }
  .panel__message { max-width: 54ch; margin-top: 6px !important; color: #3f4e48; font-size: 13px; line-height: 1.38; }
  .button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 6px; min-height: 38px; border-radius: 4px; padding: 8px 12px; background: #a87338; color: #fffaf0; font-size: 12px; font-weight: 850; text-decoration: none; }
  .button:hover { background: #765124; }
  .links { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 14px; }
  .text-link, .more { color: #063f4c; font-size: 12px; font-weight: 800; }
  .panel__heading { display: flex; align-items: end; justify-content: space-between; gap: 12px; margin-bottom: 9px; }
  .live-dot { display: flex; align-items: center; gap: 6px; margin-bottom: 2px !important; }
  .live-dot span { width: 7px; height: 7px; border-radius: 50%; background: #28754c; box-shadow: 0 0 0 3px rgba(40, 117, 76, 0.16); }
  .stale { margin: -3px 0 7px !important; color: #765124; font-size: 10px; font-weight: 750; }
  .spots { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
  .spot { min-width: 0; border: 1px solid rgba(31, 55, 51, 0.16); border-left: 3px solid #a87338; border-radius: 3px; padding: 8px 9px; background: #fffdf7; }
  .spot__topline, .spot__detail { display: flex; min-width: 0; justify-content: space-between; gap: 8px; }
  .spot__topline { align-items: baseline; }
  .spot__topline strong { color: #18312f; font-size: 15px; }
  .spot__topline span { color: #5b6761; font-size: 10px; white-space: nowrap; }
  .spot__detail { flex-direction: column; gap: 3px; margin-top: 3px; }
  .spot__detail a { overflow: hidden; color: #063f4c; font-size: 10px; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
  .spot__detail time { color: #5b6761; font-size: 10px; }
  footer { display: flex; justify-content: space-between; gap: 12px; padding: 8px 20px; border-top: 1px solid rgba(31, 55, 51, 0.14); background: #f1ede2; color: #5b6761; font-size: 9px; }
  footer a { color: #063f4c; font-weight: 750; }
  @media (max-width: 700px) {
    .panel--pre { grid-template-columns: 76px minmax(0, 1fr); gap: 10px 16px; }
    .pre-state { grid-row: 1 / span 2; padding-right: 14px; }
    .pre-state svg { width: 70px; max-height: 112px; }
    .pre-copy h2 { max-width: 24ch; font-size: clamp(23px, 5vw, 29px); }
    .pre-summary { margin-top: 6px !important; font-size: 12px; }
    .pre-action { grid-column: 2; justify-content: flex-start; }
    .pre-action .button { min-height: 42px; padding: 9px 13px; font-size: 12px; }
  }
  @media (max-width: 460px) {
    .flyer { grid-template-columns: 64px 1fr; gap: 11px; padding: 14px 14px 12px; }
    .logo { width: 64px; height: 64px; }
    h1 { font-size: clamp(24px, 8vw, 32px); }
    .invitation { display: none; }
    .panel { padding: 12px 14px; }
    .panel--pre { grid-template-columns: 1fr; align-content: center; gap: 9px; }
    .pre-state { display: none; }
    .pre-copy h2 { font-size: clamp(23px, 7.5vw, 27px); }
    .pre-summary { font-size: 12px; }
    .pre-action { grid-column: 1; }
    .panel__heading { align-items: flex-start; }
    .spots { grid-template-columns: 1fr; gap: 6px; }
    .spot { padding-block: 6px; }
    footer { padding: 7px 14px; }
  }
`;

export { embedPath as activateRiEmbedPath };

export function isActivateRiEmbedPath(pathname: string): boolean {
  return pathname === embedPath || pathname === embedPath.slice(0, -1);
}
