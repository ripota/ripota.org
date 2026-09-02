import L from "leaflet";
import type { FeatureCollection } from "geojson";
import type {
  LocationGeometryKind,
  ReportedLocation,
} from "./classify";
import {
  findGlobalLocationMatches,
  formatLocationDistance,
  globalLocationSummary,
  type GlobalLocationMatch,
  type GlobalLocationResults,
} from "./global-matches";
import {
  createLocationSession,
  type LocationSessionError,
  type LocationSessionState,
} from "./session";

export type ReferenceLocationMapItem = {
  reference: string;
  name: string;
  geometryKind: LocationGeometryKind;
  geojson: FeatureCollection | null;
  marker: {
    latitude: number;
    longitude: number;
  } | null;
};

export type ReferenceLocationMapLayers = {
  boundaries: L.Path[];
  markers: L.CircleMarker[];
};

type ReferenceLocationBaseStyle = {
  color: string;
  fillColor: string;
  boundaryFillOpacity: number;
  markerFillOpacity: number;
  markerRadius: number;
};

type SetupReferenceMapLocationOptions<TItem extends ReferenceLocationMapItem> = {
  mapElement: HTMLElement;
  map: L.Map;
  items: TItem[];
  layersByReference: ReadonlyMap<string, ReferenceLocationMapLayers>;
  getBaseStyle: (item: TItem) => ReferenceLocationBaseStyle;
};

type StatusTone = "inside" | "uncertain" | "neutral";
type ResultListKind = "inside" | "uncertain" | "nearby";

export function setupReferenceMapLocation<TItem extends ReferenceLocationMapItem>({
  mapElement,
  map,
  items,
  layersByReference,
  getBaseStyle,
}: SetupReferenceMapLocationOptions<TItem>): void {
  const shell = mapElement.closest<HTMLElement>(".reference-map-preview");
  const locationButton = shell?.querySelector<HTMLButtonElement>(
    "[data-reference-map-location]",
  );
  const resultsSheet = shell?.querySelector<HTMLElement>(
    "[data-reference-location-results]",
  );
  const statusPrimary = shell?.querySelector<HTMLElement>(
    "[data-reference-location-primary]",
  );
  const statusSecondary = shell?.querySelector<HTMLElement>(
    "[data-reference-location-secondary]",
  );
  const hideResultsButton = shell?.querySelector<HTMLButtonElement>(
    "[data-reference-location-hide]",
  );
  const stopLocationButton = shell?.querySelector<HTMLButtonElement>(
    "[data-reference-location-stop]",
  );

  if (
    !shell ||
    !locationButton ||
    !resultsSheet ||
    !statusPrimary ||
    !statusSecondary
  ) {
    return;
  }

  const locationShell = shell;
  const locationControl = locationButton;
  const sheet = resultsSheet;
  const primaryOutput = statusPrimary;
  const secondaryOutput = statusSecondary;

  const locationLayers = L.layerGroup().addTo(map);
  let accuracyLayer: L.Circle | undefined;
  let locationDot: L.CircleMarker | undefined;
  let latestLocation: ReportedLocation | undefined;
  let centeredOnFirstFix = false;
  let resultsHidden = false;

  function showStatus(
    primary: string,
    secondary: string,
    tone: StatusTone,
    canStop: boolean,
    forceOpen = false,
  ): void {
    primaryOutput.textContent = primary;
    secondaryOutput.textContent = secondary;
    sheet.dataset.tone = tone;
    stopLocationButton?.toggleAttribute("hidden", !canStop);
    if (forceOpen || !resultsHidden) {
      sheet.hidden = false;
    }
  }

  function clearLocationLayers(): void {
    locationLayers.clearLayers();
    accuracyLayer = undefined;
    locationDot = undefined;
  }

  function updateLocationLayers(location: ReportedLocation): void {
    const latlng = L.latLng(location.latitude, location.longitude);

    if (!accuracyLayer) {
      accuracyLayer = L.circle(latlng, {
        radius: location.accuracy,
        color: "#1267a5",
        fillColor: "#4ca7e8",
        fillOpacity: 0.16,
        opacity: 0.65,
        weight: 1.5,
        interactive: false,
      }).addTo(locationLayers);
    } else {
      accuracyLayer.setLatLng(latlng).setRadius(location.accuracy);
    }

    if (!locationDot) {
      locationDot = L.circleMarker(latlng, {
        radius: 8,
        color: "#ffffff",
        fillColor: "#1577c8",
        fillOpacity: 1,
        opacity: 1,
        weight: 3,
        interactive: false,
      }).addTo(locationLayers);
    } else {
      locationDot.setLatLng(latlng);
    }
  }

  function recenterOnLocation(): void {
    if (!latestLocation) return;

    map.setView(
      [latestLocation.latitude, latestLocation.longitude],
      Math.max(map.getZoom(), 14),
      { animate: true },
    );
  }

  function renderResults(
    location: ReportedLocation,
    results: GlobalLocationResults,
  ): void {
    const summary = globalLocationSummary(results, location.accuracy);
    showStatus(summary.primary, summary.secondary, summary.tone, true);
    renderResultSection(locationShell, "inside", results.inside);
    renderResultSection(locationShell, "uncertain", results.uncertain);
    renderResultSection(locationShell, "nearby", results.nearby);
  }

  function applyHighlights(results?: GlobalLocationResults): void {
    const inside = new Set(results?.inside.map(({ reference }) => reference));
    const uncertain = new Set(
      results?.uncertain.map(({ reference }) => reference),
    );

    for (const item of items) {
      const layers = layersByReference.get(item.reference);
      if (!layers) continue;

      const base = getBaseStyle(item);
      const isInside = inside.has(item.reference);
      const isUncertain = uncertain.has(item.reference);
      const color = isInside
        ? "#237242"
        : isUncertain
          ? "#b56b18"
          : base.color;
      const fillColor = isInside
        ? "#56a36d"
        : isUncertain
          ? "#f0b35d"
          : base.fillColor;

      layers.boundaries.forEach((layer) =>
        layer.setStyle({
          color,
          fillColor,
          fillOpacity: isInside
            ? 0.34
            : isUncertain
              ? 0.26
              : base.boundaryFillOpacity,
          opacity: 1,
          weight: isInside || isUncertain ? 4 : 2,
          dashArray: isUncertain ? "6 4" : "",
        }),
      );
      layers.markers.forEach((marker) => {
        marker.setRadius(
          isInside || isUncertain ? base.markerRadius + 2 : base.markerRadius,
        );
        marker.setStyle({
          color,
          fillColor,
          fillOpacity: base.markerFillOpacity,
          weight: isInside || isUncertain ? 3 : 2,
          dashArray: isUncertain ? "4 3" : "",
        });
      });
    }
  }

  function clearResults(): void {
    for (const kind of ["inside", "uncertain", "nearby"] as const) {
      renderResultSection(locationShell, kind, []);
    }
  }

  function clearActiveLocation(): void {
    latestLocation = undefined;
    centeredOnFirstFix = false;
    clearLocationLayers();
    applyHighlights();
    clearResults();
  }

  function handleSessionState(state: LocationSessionState): void {
    const active = state.status === "requesting" || state.status === "active";
    locationControl.ariaPressed = String(active);
    locationControl.dataset.state = state.status;
    locationControl.ariaLabel =
      state.status === "active"
        ? "Recenter on my location"
        : state.status === "requesting"
          ? "Finding your location"
          : "Show my location";

    switch (state.status) {
      case "requesting":
        clearResults();
        showStatus(
          "Finding your location…",
          "Used on this device; not saved or sent to RI POTA. Map tiles load from OpenStreetMap.",
          "neutral",
          true,
          true,
        );
        break;
      case "stopped":
        clearActiveLocation();
        showStatus(
          "Location stopped",
          "Tap the target to start again.",
          "neutral",
          false,
          true,
        );
        break;
      case "error": {
        clearActiveLocation();
        const [primary, secondary] = errorCopy(state.error);
        showStatus(primary, secondary, "neutral", false, true);
        break;
      }
    }
  }

  const session = createLocationSession({
    onStateChange: handleSessionState,
    onPosition: (location) => {
      latestLocation = location;
      updateLocationLayers(location);
      const results = findGlobalLocationMatches(location, items);
      renderResults(location, results);
      applyHighlights(results);

      if (!centeredOnFirstFix) {
        centeredOnFirstFix = true;
        recenterOnLocation();
      }
    },
  });

  locationControl.addEventListener("click", () => {
    if (session.getState().status === "active" && latestLocation) {
      resultsHidden = false;
      sheet.hidden = false;
      recenterOnLocation();
      return;
    }

    resultsHidden = false;
    session.start();
  });

  hideResultsButton?.addEventListener("click", () => {
    resultsHidden = true;
    sheet.hidden = true;
  });

  stopLocationButton?.addEventListener("click", () => session.stop());

  window.addEventListener(
    "pagehide",
    () => {
      session.destroy();
      clearLocationLayers();
    },
    { once: true },
  );
}

function renderResultSection(
  shell: HTMLElement,
  kind: ResultListKind,
  matches: GlobalLocationMatch[],
): void {
  const section = shell.querySelector<HTMLElement>(
    `[data-reference-location-section="${kind}"]`,
  );
  const list = section?.querySelector<HTMLUListElement>(
    "[data-reference-location-list]",
  );
  if (!section || !list) return;

  section.hidden = matches.length === 0;
  list.replaceChildren(
    ...matches.map((match) => resultListItem(match, kind)),
  );
}

function resultListItem(
  match: GlobalLocationMatch,
  kind: ResultListKind,
): HTMLLIElement {
  const item = document.createElement("li");
  const link = document.createElement("a");
  const label = document.createElement("span");
  const reference = document.createElement("strong");
  const name = document.createElement("span");
  const detail = document.createElement("small");
  const arrow = document.createElement("span");

  link.href = `/parks/${encodeURIComponent(match.reference.toLowerCase())}/`;
  reference.textContent = match.reference;
  name.textContent = match.name;
  detail.textContent = resultDetail(match, kind);
  arrow.textContent = "→";
  arrow.ariaHidden = "true";

  label.appendChild(reference);
  label.appendChild(name);
  label.appendChild(detail);
  link.appendChild(label);
  link.appendChild(arrow);
  item.appendChild(link);
  return item;
}

function resultDetail(
  match: GlobalLocationMatch,
  kind: ResultListKind,
): string {
  const geometry =
    match.geometryKind === "activation-zone"
      ? "Mapped activation zone"
      : match.geometryKind === "point"
        ? "Point only"
        : "Mapped boundary";

  if (kind === "inside") return geometry;
  if (kind === "uncertain") return `${geometry} edge overlaps accuracy`;
  return `${formatLocationDistance(match.distanceMeters)} · ${geometry}`;
}

function errorCopy(error: LocationSessionError): [string, string] {
  switch (error) {
    case "permission-denied":
      return [
        "Location access is off",
        "Enable it in browser settings, then try again.",
      ];
    case "timeout":
      return [
        "Location took too long",
        "Move to an open area or try again.",
      ];
    case "unsupported":
      return [
        "Location is not available in this browser",
        "The statewide map and park directory still work.",
      ];
    default:
      return [
        "Your device could not get a location",
        "Check your signal and try again.",
      ];
  }
}
