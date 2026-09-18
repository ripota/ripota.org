import { siteIdentity } from "../../data/site";

export const onAirEmbedBasePath = "/embed/on-air/";
export const onAirEmbedHeight = 420;

/** An attribution label, not a license or ownership check. Allows portable calls. */
export function normalizeEmbedCallsign(value: string): string | null {
  const callsign = value.trim().toUpperCase();
  return callsign.length <= 32 && /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(callsign)
    ? callsign
    : null;
}

export function onAirEmbedPath(callsign?: string | null): string {
  const normalized = callsign ? normalizeEmbedCallsign(callsign) : null;
  return normalized ? `${onAirEmbedBasePath}${encodeURIComponent(normalized)}/` : onAirEmbedBasePath;
}

export function parseOnAirEmbedPath(pathname: string): { callsign: string | null } | null {
  if (pathname === onAirEmbedBasePath || pathname === onAirEmbedBasePath.slice(0, -1)) {
    return { callsign: null };
  }
  if (!pathname.startsWith(onAirEmbedBasePath)) return null;
  const segment = pathname.slice(onAirEmbedBasePath.length).replace(/\/$/, "");
  if (segment.includes("/")) return null;
  try {
    const callsign = normalizeEmbedCallsign(decodeURIComponent(segment));
    return callsign ? { callsign } : null;
  } catch {
    return null;
  }
}

export function onAirEmbedSnippet(callsign: string): string {
  const normalized = normalizeEmbedCallsign(callsign);
  if (!normalized) throw new Error("Enter your callsign to generate the widget.");
  return `<p style="margin: 0 auto; max-width: 960px; text-align: center;">
  <iframe
    src="${siteIdentity.url}${onAirEmbedPath(normalized)}"
    title="Rhode Island on air"
    width="100%"
    height="${onAirEmbedHeight}"
    frameborder="0"
  ></iframe>
</p>`;
}
