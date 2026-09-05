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
import {
  createGeometryClassificationRequest,
  requireCanonicalGeometry,
  type CanonicalGeometry,
} from "./canonical-geometry";
export { createCanonicalGeometryLoader } from "./canonical-geometry";

export type ReferenceLocationMapItem = {
  reference: string;
  name: string;
  geometryKind: LocationGeometryKind;
  geojson: FeatureCollection | null;
  bbox?: readonly [number, number, number, number] | null;
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
  loadGeometry: () => Promise<CanonicalGeometry>;
};

type StatusTone = "inside" | "uncertain" | "neutral";
type ResultListKind = "inside" | "uncertain" | "nearby";
const collapsedNearbyLimit = 3;
const expandedNearbyLimit = 8;
const parksMapReturnStateKey = "ripotaParksMapReturn";

type StoredMapView = {
  center: [number, number];
  zoom: number;
};

type ParksMapReturnState = {
  camera: StoredMapView;
  browseView?: StoredMapView;
  scroll: [number, number];
  resultsScrollTop: number;
};

export function setupReferenceMapLocation<TItem extends ReferenceLocationMapItem>({
  mapElement,
  map,
  items,
  layersByReference,
  getBaseStyle,
  loadGeometry,
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
  const stopLocationButton = shell?.querySelector<HTMLButtonElement>(
    "[data-reference-location-stop]",
  );
  const moreNearbyButton = shell?.querySelector<HTMLButtonElement>(
    "[data-reference-location-more]",
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
  let locationDot: L.Marker | undefined;
  let latestLocation: ReportedLocation | undefined;
  let latestResults: GlobalLocationResults | undefined;
  let centeredOnFirstFix = false;
  let nearbyExpanded = false;
  let hoveredReference: string | undefined;
  let locationModeActive = false;
  let browseView: { center: L.LatLng; zoom: number } | undefined;
  let pendingResultsScrollTop: number | undefined;
  let canonicalGeometry: CanonicalGeometry | undefined;

  function historyState(): Record<string, unknown> {
    const state = window.history.state;
    return state && typeof state === "object"
      ? { ...(state as Record<string, unknown>) }
      : {};
  }

  function saveReturnState(): void {
    const center = map.getCenter();
    const state: ParksMapReturnState = {
      camera: { center: [center.lat, center.lng], zoom: map.getZoom() },
      browseView: browseView
        ? {
            center: [browseView.center.lat, browseView.center.lng],
            zoom: browseView.zoom,
          }
        : undefined,
      scroll: [window.scrollX, window.scrollY],
      resultsScrollTop: sheet.scrollTop,
    };

    window.history.scrollRestoration = "manual";
    window.history.replaceState(
      { ...historyState(), [parksMapReturnStateKey]: state },
      "",
      window.location.href,
    );
  }

  function clearReturnState(): void {
    const state = historyState();
    delete state[parksMapReturnStateKey];
    window.history.replaceState(state, "", window.location.href);
    window.history.scrollRestoration = "auto";
  }

  function afterLayout(callback: () => void): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(callback);
    });
  }

  function setResultsVisible(visible: boolean): void {
    sheet.hidden = !visible;
    locationShell.dataset.locationResults = visible ? "visible" : "hidden";
  }

  function setLocationMode(active: boolean, restoreView = false): void {
    const hero = locationShell.closest<HTMLElement>(".parks-directory-hero");

    if (active && !locationModeActive) {
      browseView = { center: map.getCenter(), zoom: map.getZoom() };
    }

    locationModeActive = active;
    if (active) {
      map.scrollWheelZoom.enable();
      locationShell.dataset.locationMode = "active";
      hero?.setAttribute("data-location-mode", "active");
    } else {
      map.scrollWheelZoom.disable();
      delete locationShell.dataset.locationMode;
      hero?.removeAttribute("data-location-mode");
    }

    afterLayout(() => {
      map.invalidateSize({ animate: false });
      if (!active && restoreView && browseView) {
        map.setView(browseView.center, browseView.zoom, { animate: false });
        browseView = undefined;
      }
    });
  }

  function showStatus(
    primary: string,
    secondary: string,
    tone: StatusTone,
  ): void {
    primaryOutput.textContent = primary;
    secondaryOutput.textContent = secondary;
    sheet.dataset.tone = tone;
    setResultsVisible(true);
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
      locationDot = L.marker(latlng, {
        icon: L.divIcon({
          className: "reference-map-user-location-marker",
          html: "<span></span>",
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1_000,
      }).addTo(locationLayers);
    } else {
      locationDot.setLatLng(latlng);
    }
  }

  function fitLocationContext(results: GlobalLocationResults | undefined): void {
    if (!latestLocation) return;

    afterLayout(() => {
      if (!latestLocation) return;

      map.invalidateSize({ animate: false });
      const location = L.latLng(
        latestLocation.latitude,
        latestLocation.longitude,
      );
      const bounds = accuracyLayer?.getBounds() ?? L.latLngBounds(location, location);
      const focusMatches = results?.inside.length
        ? results.inside
        : results?.uncertain.length
          ? results.uncertain
          : results?.nearby.slice(0, 1) ?? [];

      for (const match of focusMatches) {
        const item = items.find(({ reference }) => reference === match.reference);
        if (!item) continue;

        if (item.bbox) {
          bounds.extend([
            [item.bbox[1], item.bbox[0]],
            [item.bbox[3], item.bbox[2]],
          ]);
        } else if (canonicalGeometry?.has(item.reference)) {
          const parkBounds = L.geoJSON(canonicalGeometry.get(item.reference)).getBounds();
          if (parkBounds.isValid()) bounds.extend(parkBounds);
        }
        if (item.marker) {
          bounds.extend([item.marker.latitude, item.marker.longitude]);
        }
      }

      const resultsOverlap =
        !sheet.hidden && !window.matchMedia("(min-width: 760px)").matches;
      const bottomPadding = resultsOverlap
        ? Math.min(sheet.offsetHeight + 28, map.getSize().y * 0.58)
        : 40;
      map.fitBounds(bounds, {
        animate: true,
        maxZoom: 16,
        paddingTopLeft: [40, 40],
        paddingBottomRight: [40, bottomPadding],
      });
    });
  }

  function renderResults(
    location: ReportedLocation,
    results: GlobalLocationResults,
  ): void {
    const summary = globalLocationSummary(results, location.accuracy);
    showStatus(summary.primary, summary.secondary, summary.tone);
    renderResultSection(locationShell, "inside", results.inside);
    renderResultSection(locationShell, "uncertain", results.uncertain);
    renderNearbyResultSection(
      locationShell,
      results.nearby,
      nearbyExpanded,
    );
    if (pendingResultsScrollTop !== undefined) {
      const scrollTop = pendingResultsScrollTop;
      pendingResultsScrollTop = undefined;
      window.requestAnimationFrame(() => {
        sheet.scrollTop = scrollTop;
      });
    }
  }

  function applyHighlights(results?: GlobalLocationResults): void {
    const inside = new Set(results?.inside.map(({ reference }) => reference));
    const uncertain = new Set(
      results?.uncertain.map(({ reference }) => reference),
    );
    const closest =
      inside.size === 0 && uncertain.size === 0
        ? results?.nearby[0]?.reference
        : undefined;

    for (const item of items) {
      const layers = layersByReference.get(item.reference);
      if (!layers) continue;

      const base = getBaseStyle(item);
      const isInside = inside.has(item.reference);
      const isUncertain = uncertain.has(item.reference);
      const isClosest = item.reference === closest;
      const isHovered = item.reference === hoveredReference;
      let color = base.color;
      let fillColor = base.fillColor;
      let fillOpacity = base.boundaryFillOpacity;

      if (isClosest) {
        color = "#6f4618";
        fillColor = "#f6bd46";
        fillOpacity = 0.28;
      }
      if (isUncertain) {
        color = "#b56b18";
        fillColor = "#f0b35d";
        fillOpacity = 0.26;
      }
      if (isInside) {
        color = "#237242";
        fillColor = "#56a36d";
        fillOpacity = 0.34;
      }
      if (isHovered) {
        color = "#0b6670";
        fillColor = "#71c2c5";
        fillOpacity = 0.4;
      }

      layers.boundaries.forEach((layer) =>
        layer.setStyle({
          color,
          fillColor,
          fillOpacity,
          opacity: 1,
          weight: isHovered ? 5 : isInside || isUncertain || isClosest ? 4 : 2,
          dashArray: !isHovered && isUncertain ? "6 4" : "",
        }),
      );
      if (isHovered) layers.boundaries.forEach((layer) => layer.bringToFront());
      layers.markers.forEach((marker) => {
        marker.setRadius(
          isHovered
            ? base.markerRadius + 4
            : isInside || isUncertain || isClosest
              ? base.markerRadius + 2
              : base.markerRadius,
        );
        marker.setStyle({
          color,
          fillColor,
          fillOpacity: base.markerFillOpacity,
          weight: isHovered ? 4 : isInside || isUncertain || isClosest ? 3 : 2,
          dashArray: !isHovered && isUncertain ? "4 3" : "",
        });
        if (isHovered) marker.bringToFront();
      });
    }
  }

  function clearResults(): void {
    for (const kind of ["inside", "uncertain", "nearby"] as const) {
      renderResultSection(locationShell, kind, []);
    }
    if (moreNearbyButton) moreNearbyButton.hidden = true;
  }

  function clearActiveLocation(): void {
    classificationRequest.invalidate();
    latestLocation = undefined;
    latestResults = undefined;
    nearbyExpanded = false;
    hoveredReference = undefined;
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
        classificationRequest.invalidate();
        setLocationMode(true);
        nearbyExpanded = false;
        clearResults();
        showStatus(
          "Finding your location…",
          "Used on this device; not saved or sent to RI POTA. Map tiles load from OpenStreetMap.",
          "neutral",
        );
        break;
      case "stopped":
        clearActiveLocation();
        setResultsVisible(false);
        setLocationMode(false, true);
        break;
      case "error": {
        clearActiveLocation();
        const [primary, secondary] = errorCopy(state.error);
        showStatus(primary, secondary, "neutral");
        break;
      }
    }
  }

  const classificationRequest = createGeometryClassificationRequest({
    load: async () => {
      const geometry = await loadGeometry();
      // Never turn an incomplete response into a misleading no-match result.
      for (const item of items) requireCanonicalGeometry(geometry, item.reference);
      return geometry;
    },
    onLoading: () => {
      latestResults = undefined;
      clearResults();
      applyHighlights();
      showStatus(
        "Loading mapped boundaries…",
        "Your location is shown; boundary checks are not ready yet.",
        "neutral",
      );
    },
    onError: () => {
      showStatus(
        "Mapped boundaries could not load",
        "Your location is shown. Use the location button to try again.",
        "neutral",
      );
    },
    onReady: (geometry, location) => {
      canonicalGeometry = geometry;
      const results = findGlobalLocationMatches(
        location,
        items.map((item) => ({
          ...item,
          geojson: requireCanonicalGeometry(geometry, item.reference),
        })),
        expandedNearbyLimit,
      );
      latestResults = results;
      renderResults(location, results);
      applyHighlights(results);
      if (!centeredOnFirstFix) {
        centeredOnFirstFix = true;
        fitLocationContext(results);
      }
    },
  });

  const session = createLocationSession({
    onStateChange: handleSessionState,
    onPosition: (location) => {
      latestLocation = location;
      updateLocationLayers(location);
      classificationRequest.request(location);
    },
  });

  function restoreReturnState(): boolean {
    const stored = parseReturnState(historyState()[parksMapReturnStateKey]);
    if (!stored) return false;

    window.history.scrollRestoration = "manual";
    map.setView(stored.camera.center, stored.camera.zoom, { animate: false });
    setLocationMode(true);
    browseView = stored.browseView
      ? {
          center: L.latLng(stored.browseView.center),
          zoom: stored.browseView.zoom,
        }
      : browseView;
    centeredOnFirstFix = true;
    pendingResultsScrollTop = stored.resultsScrollTop;
    session.start();
    afterLayout(() => {
      const restoreScroll = () => {
        window.scrollTo(stored.scroll[0], stored.scroll[1]);
        sheet.scrollTop = stored.resultsScrollTop;
      };
      restoreScroll();
      window.setTimeout(restoreScroll, 0);
      window.setTimeout(restoreScroll, 100);
    });
    return true;
  }

  locationControl.addEventListener("click", () => {
    if (session.getState().status === "active" && latestLocation) {
      classificationRequest.request(latestLocation);
      setResultsVisible(true);
      fitLocationContext(latestResults);
      return;
    }
    session.start();
  });

  moreNearbyButton?.addEventListener("click", () => {
    if (!latestResults) return;

    nearbyExpanded = !nearbyExpanded;
    renderNearbyResultSection(
      locationShell,
      latestResults.nearby,
      nearbyExpanded,
    );
  });

  const setHoveredResult = (target: EventTarget | null): void => {
    const element = target instanceof Element ? target : null;
    const reference = element
      ?.closest<HTMLElement>("[data-reference-location-reference]")
      ?.dataset.referenceLocationReference;
    if (!reference || reference === hoveredReference) return;

    hoveredReference = reference;
    applyHighlights(latestResults);
  };

  const clearHoveredResult = (
    target: EventTarget | null,
    relatedTarget: EventTarget | null,
  ): void => {
    const element = target instanceof Element ? target : null;
    const result = element?.closest<HTMLElement>(
      "[data-reference-location-reference]",
    );
    if (!result || result.dataset.referenceLocationReference !== hoveredReference) {
      return;
    }
    if (relatedTarget instanceof Node && result.contains(relatedTarget)) return;

    hoveredReference = undefined;
    applyHighlights(latestResults);
  };

  sheet.addEventListener("pointerover", (event) => {
    setHoveredResult(event.target);
  });
  sheet.addEventListener("pointerout", (event) => {
    clearHoveredResult(event.target, event.relatedTarget);
  });
  sheet.addEventListener("focusin", (event) => {
    setHoveredResult(event.target);
  });
  sheet.addEventListener("focusout", (event) => {
    clearHoveredResult(event.target, event.relatedTarget);
  });

  const preserveLocationNavigation = (event: MouseEvent): void => {
    if (!locationModeActive || !(event.target instanceof Element)) return;

    const link = event.target.closest<HTMLAnchorElement>('a[href^="/parks/"]');
    if (!link) return;

    const destination = new URL(link.href, window.location.href);
    if (
      destination.origin !== window.location.origin ||
      !/^\/parks\/[^/]+\/$/.test(destination.pathname)
    ) {
      return;
    }

    saveReturnState();
    destination.searchParams.set("location", "1");
    destination.searchParams.set("from", "parks-map");
    link.href = `${destination.pathname}${destination.search}${destination.hash}`;
  };
  document.addEventListener("click", preserveLocationNavigation, true);

  stopLocationButton?.addEventListener("click", () => {
    session.stop();
    clearReturnState();
    const destination = new URL(window.location.href);
    destination.searchParams.delete("location");
    window.history.replaceState(
      window.history.state,
      "",
      `${destination.pathname}${destination.search}${destination.hash}`,
    );
  });

  if (!restoreReturnState() && new URLSearchParams(window.location.search).get("location") === "1") {
    session.start();
  }

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) restoreReturnState();
  });

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) {
      classificationRequest.invalidate();
      session.destroy();
      clearLocationLayers();
      document.removeEventListener("click", preserveLocationNavigation, true);
    }
  });
}

function renderNearbyResultSection(
  shell: HTMLElement,
  matches: GlobalLocationMatch[],
  expanded: boolean,
): void {
  const visibleMatches = matches.slice(
    0,
    expanded ? expandedNearbyLimit : collapsedNearbyLimit,
  );
  renderResultSection(shell, "nearby", visibleMatches);

  const button = shell.querySelector<HTMLButtonElement>(
    "[data-reference-location-more]",
  );
  if (!button) return;

  button.hidden = matches.length <= collapsedNearbyLimit;
  button.ariaExpanded = String(expanded);
  button.textContent = expanded
    ? "Show fewer parks"
    : `Show ${matches.length - collapsedNearbyLimit} more parks`;
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

  link.href = `/parks/${encodeURIComponent(match.reference.toLowerCase())}/?location=1&from=parks-map`;
  link.dataset.referenceLocationReference = match.reference;
  reference.textContent = match.reference;
  name.textContent = match.name;
  detail.textContent = resultDetail(match, kind);
  arrow.textContent = "Open guide →";

  label.appendChild(reference);
  label.appendChild(name);
  label.appendChild(detail);
  link.appendChild(label);
  link.appendChild(arrow);
  item.appendChild(link);
  return item;
}

function parseReturnState(value: unknown): ParksMapReturnState | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as Partial<ParksMapReturnState>;
  const camera = parseMapView(candidate.camera);
  const browseView = candidate.browseView === undefined
    ? undefined
    : parseMapView(candidate.browseView);
  const scroll = candidate.scroll;
  if (
    !camera ||
    (candidate.browseView !== undefined && !browseView) ||
    !Array.isArray(scroll) ||
    scroll.length !== 2 ||
    !scroll.every(Number.isFinite) ||
    !Number.isFinite(candidate.resultsScrollTop)
  ) {
    return undefined;
  }

  return {
    camera,
    browseView,
    scroll: [scroll[0] as number, scroll[1] as number],
    resultsScrollTop: candidate.resultsScrollTop as number,
  };
}

function parseMapView(value: unknown): StoredMapView | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = value as Partial<StoredMapView>;
  if (
    !Array.isArray(candidate.center) ||
    candidate.center.length !== 2 ||
    !candidate.center.every(Number.isFinite) ||
    !Number.isFinite(candidate.zoom)
  ) {
    return undefined;
  }

  return {
    center: [candidate.center[0] as number, candidate.center[1] as number],
    zoom: candidate.zoom as number,
  };
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
