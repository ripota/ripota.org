import {
  activationRecords, defaultActivationResultView, filterActivationRecords,
  readActivationResultView, writeActivationResultView,
  type ActivationRecord, type ActivationResultView,
} from "./activation-results";
import { replaceLiveContent } from "./live-content";
import { parkMediaStore } from "./park-media-store";
import { potaParkStatusStore } from "./pota-status-store";

export function setupActivationResults(root: HTMLElement): void {
  const search = root.querySelector<HTMLInputElement>("[data-results-search]")!;
  const controls = Array.from(root.querySelectorAll("[data-results-filter]")) as unknown as HTMLSelectElement[];
  const clear = root.querySelector<HTMLButtonElement>("[data-results-clear]")!;
  const refresh = root.querySelector<HTMLButtonElement>("[data-results-refresh]")!;
  let view = readActivationResultView(new URL(window.location.href));
  let records: ActivationRecord[] | undefined;
  let media: ReadonlyMap<string, { photos: number; videos: number }> = new Map();
  let searchEditing = false;
  let refreshing = false;
  const format = new Intl.NumberFormat("en-US");
  const setText = (selector: string, text: string) => { root.querySelector(selector)!.textContent = text; };

  function syncControls(): void {
    search.value = view.query;
    for (const control of controls) control.value = view[control.dataset.resultsFilter as keyof ActivationResultView];
    clear.disabled = Object.keys(defaultActivationResultView).every((key) =>
      view[key as keyof ActivationResultView] === defaultActivationResultView[key as keyof ActivationResultView]);
  }

  function updateUrl(mode: "push" | "replace"): boolean {
    const url = writeActivationResultView(new URL(window.location.href), view);
    if (url.href === window.location.href) return false;
    if (mode === "push") window.history.pushState(window.history.state, "", url);
    else window.history.replaceState(window.history.state, "", url);
    return true;
  }

  function render(): void {
    clear.disabled = Object.keys(defaultActivationResultView).every((key) =>
      view[key as keyof ActivationResultView] === defaultActivationResultView[key as keyof ActivationResultView]);
    if (!records) return;
    const visible = filterActivationRecords(records, view);
    replaceLiveContent(root.querySelector("[data-results-rows]")!, visible.map(recordRow));
    root.querySelector<HTMLElement>("[data-results-table]")!.hidden = visible.length === 0;
    const empty = root.querySelector<HTMLElement>("[data-results-empty]")!;
    empty.hidden = visible.length > 0;
    empty.textContent = records.length === 0
      ? "No event activation logs are available yet. This does not mean the parks were inactive; uploaded POTA logs may still be pending."
      : "No activation records match these filters. Try another park, callsign, date, or mode; some event logs may still be pending.";
    const parks = new Set(visible.map(({ parkReference }) => parkReference)).size;
    const qualifying = visible.filter(({ qualifying }) => qualifying).length;
    setText("[data-results-count]", `Showing ${format.format(visible.length)} of ${format.format(records.length)} log ${records.length === 1 ? "record" : "records"} · ${format.format(parks)} ${parks === 1 ? "park" : "parks"} · ${format.format(qualifying)} qualifying ${qualifying === 1 ? "activation" : "activations"}.`);
  }

  function recordRow(record: ActivationRecord): HTMLTableRowElement {
    const row = document.createElement("tr");
    row.dataset.activationRecord = record.id;
    row.dataset.reference = record.parkReference;
    const park = document.createElement("th");
    park.scope = "row";
    const link = document.createElement("a");
    link.href = `https://pota.app/#/park/${encodeURIComponent(record.parkReference)}`;
    link.textContent = record.parkReference;
    link.dataset.liveKey = `${record.id}:park`;
    const name = document.createElement("span");
    name.className = "activation-record__name";
    name.textContent = record.parkName;
    park.appendChild(link);
    park.appendChild(name);
    row.appendChild(park);
    row.appendChild(cell("Callsign", record.callsign));
    row.appendChild(cell("Date (UTC)", record.qsoDate, "activation-record__date"));
    const result = cell("Result", "");
    const outcome = document.createElement("span");
    outcome.className = "activation-record__outcome";
    outcome.dataset.outcome = record.qualifying ? "qualifying" : "attempt";
    outcome.textContent = record.qualifying ? "Qualifying activation" : "Recorded attempt";
    result.appendChild(outcome);
    row.appendChild(result);
    for (const [label, value] of [["Total QSOs", record.totalQsos], ["CW", record.cw], ["Phone", record.phone], ["Data", record.data]] as const) {
      row.appendChild(cell(label, format.format(value), "activation-record__numeric"));
    }
    const mediaCell = cell("From this park", "", "activation-record__media");
    const counts = media.get(record.parkReference);
    if (counts && counts.photos + counts.videos > 0) {
      const mediaLink = document.createElement("a");
      mediaLink.href = `/activate-ri-2026/media/?${new URLSearchParams({ mediaPark: record.parkReference })}`;
      mediaLink.textContent = "Photos";
      mediaLink.dataset.liveKey = `${record.id}:media`;
      mediaCell.appendChild(mediaLink);
    } else mediaCell.textContent = "—";
    row.appendChild(mediaCell);
    return row;
  }

  root.querySelector("[data-results-filters]")!.addEventListener("submit", (event) => event.preventDefault());
  search.addEventListener("input", () => {
    view = { ...view, query: search.value.trim() };
    searchEditing = updateUrl(searchEditing ? "replace" : "push") || searchEditing;
    render();
  });
  for (const event of ["blur", "change"]) search.addEventListener(event, () => { searchEditing = false; });
  for (const control of controls) control.addEventListener("change", () => {
    searchEditing = false;
    view = { ...view, [control.dataset.resultsFilter!]: control.value };
    updateUrl("push");
    render();
  });
  clear.addEventListener("click", () => {
    searchEditing = false;
    view = { ...defaultActivationResultView };
    syncControls();
    updateUrl("push");
    render();
    search.focus();
  });
  window.addEventListener("popstate", () => {
    searchEditing = false;
    view = readActivationResultView(new URL(window.location.href));
    syncControls();
    render();
  });
  refresh.addEventListener("click", async () => {
    if (refreshing) return;
    refreshing = true;
    // Native disabled drops keyboard focus. Keep the button focusable while
    // guarding repeat requests, without reclaiming focus after the update.
    refresh.setAttribute("aria-disabled", "true");
    refresh.setAttribute("aria-busy", "true");
    try { await Promise.all([potaParkStatusStore.refresh(), parkMediaStore.refresh()]); }
    finally {
      refreshing = false;
      refresh.removeAttribute("aria-disabled");
      refresh.removeAttribute("aria-busy");
    }
  });
  syncControls();
  updateUrl("replace");
  potaParkStatusStore.subscribe((state) => {
    root.dataset.resultsState = state.status;
    if (state.status === "unavailable") {
      setText("[data-results-status]", "POTA activation records are temporarily unavailable. Use Refresh results to try again.");
      return;
    }
    if (state.status !== "ready") return;
    records = activationRecords(state.snapshot);
    const checked = state.snapshot.lastPotaSyncAt ? Date.parse(state.snapshot.lastPotaSyncAt) : Number.NaN;
    const timestamp = Number.isFinite(checked)
      ? `POTA logs last checked ${new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(checked)}.`
      : "Waiting for a completed POTA log check.";
    const warning = state.refreshFailed ? " The latest refresh failed; showing the last available records."
      : state.snapshot.warning ? ` ${state.snapshot.warning}` : state.snapshot.stale ? " Log updates are delayed." : "";
    setText("[data-results-status]", `Provisional results. ${timestamp}${warning}`);
    render();
  });
  parkMediaStore.subscribe((state) => {
    media = state.status === "ready" ? state.counts : new Map();
    render();
  });
  potaParkStatusStore.start();
  parkMediaStore.start();
}

function cell(label: string, value: string, className = ""): HTMLTableCellElement {
  const result = document.createElement("td");
  result.dataset.label = label;
  result.className = className;
  result.textContent = value;
  return result;
}
