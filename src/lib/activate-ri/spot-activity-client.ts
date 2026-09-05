import type {
  PublicPotaSpotActivity as ActivitySnapshot,
  PublicPotaSpotActivityPark as ActivityPark,
} from "../../worker/pota-spot-activity";
import { spotCoverageLabels } from "./spot-coverage";

type ActivityView = "all" | "spotted" | "unspotted";
const refreshIntervalMilliseconds = 60_000;

export function setupSpotActivity(root: HTMLElement): void {
  let snapshot: ActivitySnapshot | undefined;
  let refreshing = false;
  const search = root.querySelector<HTMLInputElement>("[data-activity-search]");
  const filters = root.querySelector("[data-activity-filters]");
  const selectedView = (): ActivityView => {
    const value = root.querySelector<HTMLInputElement>('input[name="activity-view"]:checked')?.value;
    return value === "all" || value === "unspotted" ? value : "spotted";
  };
  const restoreView = () => {
    const requested = new URL(window.location.href).searchParams.get("view");
    const view = requested === "all" || requested === "unspotted" ? requested : "spotted";
    const input = root.querySelector<HTMLInputElement>(`input[value="${view}"]`);
    if (input) input.checked = true;
    renderRows();
  };
  const renderRows = () => {
    if (!snapshot) return;
    const view = selectedView();
    const query = search?.value.trim().toLowerCase() ?? "";
    const candidates = view === "spotted" ? snapshot.parks : view === "unspotted"
      ? snapshot.unspottedParks : [...snapshot.unspottedParks, ...snapshot.parks];
    const parks = candidates.filter(park =>
      !query || park.reference.toLowerCase().includes(query) || park.name.toLowerCase().includes(query),
    );
    root.querySelector("[data-pota-activity-rows]")?.replaceChildren(...parks.map(parkRow));
    setText(root, "[data-activity-filter-status]",
      `Showing ${parks.length} of ${candidates.length} ${view === "unspotted" ? "parks not yet spotted" : view === "spotted" ? "spotted parks" : "parks"}.`);
    const table = root.querySelector<HTMLElement>("[data-pota-activity-table]");
    const empty = root.querySelector<HTMLElement>("[data-pota-activity-empty]");
    if (table) table.hidden = parks.length === 0;
    if (empty) {
      empty.hidden = parks.length > 0;
      empty.textContent = query ? "No parks match this search."
        : view === "unspotted" ? "Every Rhode Island park has spot evidence in this window."
          : "No Rhode Island spots have been collected in this window yet.";
    }
  };
  filters?.addEventListener("change", () => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", selectedView());
    window.history.replaceState(null, "", url);
    renderRows();
  });
  search?.addEventListener("input", renderRows);
  window.addEventListener("popstate", restoreView);
  restoreView();

  const refresh = async () => {
    if (refreshing) return;
    refreshing = true;
    try {
      const response = await fetch("/api/activate-ri-2026/public/spot-activity", {
        headers: { accept: "application/json" }, cache: "no-store",
      });
      if (!response.ok) throw new Error(`Spot activity responded with ${response.status}`);
      snapshot = await response.json() as ActivitySnapshot;
      renderSummary(root, snapshot);
      renderRows();
    } catch {
      setText(root, "[data-pota-activity-status]", snapshot
        ? "Refresh failed. Showing the last successful result; missing-park status may be out of date."
        : "Collected spot activity is temporarily unavailable. Try again shortly.");
    } finally {
      refreshing = false;
    }
  };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
  window.setInterval(() => { if (!document.hidden) void refresh(); }, refreshIntervalMilliseconds);
  void refresh();
}

function renderSummary(root: HTMLElement, snapshot: ActivitySnapshot): void {
  setText(root, "[data-activity-parks]", `${snapshot.summary.parks} / ${snapshot.summary.totalParks}`);
  setText(root, "[data-activity-unspotted]", String(snapshot.summary.unspottedParks));
  for (const [selector, value] of [
    ["activators", snapshot.summary.activators], ["modes", snapshot.summary.modes],
    ["bands", snapshot.summary.bands], ["spots", snapshot.summary.spots],
    ["rbn-spots", snapshot.summary.rbnSpots], ["non-rbn-spots", snapshot.summary.nonRbnSpots],
    ["non-rbn-spotters", snapshot.summary.nonRbnSpotters],
    ["count-all", snapshot.summary.totalParks], ["count-spotted", snapshot.summary.parks],
    ["count-unspotted", snapshot.summary.unspottedParks],
  ] as const) setText(root, `[data-activity-${selector}]`, String(value));
  const scope = snapshot.scope === "event"
    ? "Showing spots from the Activate All RI event window"
    : "Pre-event rehearsal: showing the rolling 14-day collection window";
  setText(root, "[data-pota-activity-status]", `${scope}. Collector last checked ${formatTimestamp(snapshot.lastCollectedAt)}.`);
}

function parkRow(park: ActivityPark): HTMLTableRowElement {
  const row = document.createElement("tr");
  row.dataset.reference = park.reference;
  const parkCell = document.createElement("th");
  parkCell.scope = "row";
  parkCell.dataset.label = "Park";
  const link = document.createElement("a");
  link.className = "event-table-park-link";
  link.href = park.potaUrl;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = `${park.reference} · ${park.name}`;
  parkCell.appendChild(link);
  if (park.live) {
    const badge = document.createElement("span");
    badge.className = "pota-activity__live";
    badge.textContent = "On air now";
    parkCell.appendChild(badge);
  }
  const coverage = park.coverage;
  const coverageCell = cell("Coverage / next step", coverage ? spotCoverageLabels[coverage.status] : "Status unavailable");
  if (coverage) coverageCell.dataset.coverageStatus = coverage.status;
  if (park.confirmation) {
    coverageCell.appendChild(document.createElement("br"));
    coverageCell.appendChild(document.createTextNode(
      `${park.confirmation.activatorCallsign} · ${park.confirmation.totalQsos} QSOs · ${formatQsoDate(park.confirmation.qsoDate)} UTC`,
    ));
  }
  const stop = coverage?.stop;
  for (const element of [
    parkCell, coverageCell,
    cell("Planned activation", stop
      ? `${stop.activatorCallsign} · ${formatTimestamp(stop.startAt)}–${formatTimestamp(stop.endAt)}${stop.status === "delayed" ? " · delayed" : ""}`
      : "No remaining scheduled activation"),
    cell("First spotted", formatTimestamp(park.firstSpottedAt)),
    cell("Last spotted", formatTimestamp(park.lastSpottedAt)),
    cell("Activators", park.activators.join(", ") || "—"),
    cell("Modes", park.modes.join(", ") || "—"),
    cell("Bands", park.bands.join(", ") || "—"),
    cell("Evidence", evidenceLabel(park)),
    cell("Non-RBN spotters", park.nonRbnSpotters.join(", ") || "None retained"),
    cell("Spot reports", park.retainedEventEvidence ? "Detailed reports expired"
      : `${park.spotCount} total · ${park.rbnSpotCount} RBN · ${park.nonRbnSpotCount} non-RBN`),
  ]) row.appendChild(element);
  return row;
}

function evidenceLabel(park: ActivityPark): string {
  if (park.retainedEventEvidence) return "Retained event spot evidence";
  if (park.spotCount === 0) return "No spots recorded in this window";
  if (park.structuredSpotCount > 0) return park.declaredNferSpotCount > 0
    ? "Structured POTA spot and declared N-fer" : "Structured POTA spot";
  return `Declared N-fer from ${park.declaredByReferences.join(", ")}`;
}

function cell(label: string, value: string): HTMLTableCellElement {
  const element = document.createElement("td");
  element.dataset.label = label;
  element.textContent = value;
  return element;
}

function setText(root: HTMLElement, selector: string, value: string): void {
  root.querySelector(selector)?.replaceChildren(value);
}

function formatQsoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    timeZone: "America/New_York", timeZoneName: "short",
  }).format(date) : value;
}
