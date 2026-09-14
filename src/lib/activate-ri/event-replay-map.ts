import L from "leaflet";
import { subscribeEventPhase } from "./event-phase";
import { fetchEventReplay, type EventReplay, type EventReplayEvent } from "./event-replay";
import { advanceReplay, replayActivity, replayMoment, replayTimeLabel } from "./replay-timeline";
import { referenceMapLeafletOptions } from "../reference-map";
import { parkGuidePath } from "../parks/directory";

type ReplayPark = { reference: string; name: string; latitude: number; longitude: number };

export function setupEventReplay(root: HTMLElement): void {
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const mapElement = find<HTMLDivElement>("[data-replay-map]");
  const play = find<HTMLButtonElement>("[data-replay-play]");
  const playLabel = find("[data-replay-play-label]");
  const playIcon = find("[data-replay-play-icon]");
  const endButton = find<HTMLButtonElement>("[data-replay-end]");
  const retry = find<HTMLButtonElement>("[data-replay-retry]");
  const scrubber = find<HTMLInputElement>("[data-replay-scrubber]");
  const clock = find<HTMLTimeElement>("[data-replay-clock]");
  const count = find("[data-replay-count]");
  const phaseLabel = find("[data-replay-phase]");
  const badge = find<HTMLButtonElement>("[data-replay-badge]");
  const detail = find("[data-replay-detail]");
  const notice = find("[data-replay-notice]");
  const announcement = find("[data-replay-announcement]");
  const activity = find("[data-replay-activity]");
  const payload = JSON.parse(find("[data-replay-parks]").textContent!) as { items: ReplayPark[] };
  const parks = new Map(payload.items.map(park => [park.reference, park]));
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let map: L.Map | undefined;
  const markers = new Map<string, L.Marker>();
  const lastPulse = new Map<string, number>();
  let data: EventReplay | undefined;
  let start = 0;
  let end = 0;
  let at = 0;
  let wantsPlay = false;
  let visible = false;
  let componentVisible = false;
  let hasStarted = false;
  let enabled = false;
  let requested = false;
  let raf = 0;
  let lastFrame = 0;
  let lastDraw = 0;
  let lastDetailDraw = 0;
  let previousMoment = replayMoment([], 0);
  let selectedPark: string | undefined;
  let userMovedMap = false;

  const announce = () => {
    announcement.textContent = `${at === end ? "Replay complete" : "Paused"}. ${replayTimeLabel(at === end ? end - 1 : at)}. ${previousMoment.heard.size} of ${payload.items.length} parks heard.`;
  };

  function syncPlayback(): void {
    cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
    if (data && !data.events.length) {
      wantsPlay = false;
      root.dataset.state = "empty";
      return;
    }
    const running = wantsPlay && (hasStarted ? componentVisible : visible) && enabled && !document.hidden && !!data && at < end;
    if (running) hasStarted = true;
    root.dataset.state = at === end && data ? "complete" : running ? "playing" : data ? "paused" : root.dataset.state;
    playLabel.textContent = running ? "Pause replay" : at === end ? "Replay weekend" : "Play weekend";
    playIcon.textContent = running ? "Ⅱ" : at === end ? "↺" : "▶";
    badge.textContent = running ? "Ⅱ Pause" : at === end && data ? "↺ Replay" : "▶ Play";
    badge.setAttribute("aria-label", running ? "Pause map replay" : at === end && data ? "Replay map" : "Play map replay");
    if (running) raf = requestAnimationFrame(tick);
  }

  function tick(now: number): void {
    if (lastFrame) at = advanceReplay(at, now - lastFrame, start, end, Date.parse(data!.events[0].at));
    lastFrame = now;
    if (now - lastDraw >= 80 || at === end) {
      draw(true);
      lastDraw = now;
    }
    if (at === end) {
      wantsPlay = false;
      syncPlayback();
      announce();
    } else {
      raf = requestAnimationFrame(tick);
    }
  }

  function pause(): void {
    wantsPlay = false;
    syncPlayback();
  }

  function popup(park: ReplayPark): HTMLElement {
    const container = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = park.name;
    container.appendChild(title);
    const reference = document.createElement("p");
    reference.textContent = park.reference;
    container.appendChild(reference);
    const event = previousMoment.latestByPark.get(park.reference);
    const report = document.createElement("p");
    report.textContent = event
      ? `${event.activatorCallsign} · ${[event.frequency && `${event.frequency} kHz`, event.mode].filter(Boolean).join(" · ")} · ${replayTimeLabel(Date.parse(event.at))}`
      : "No spot report by this point in the replay.";
    container.appendChild(report);
    const link = document.createElement("a");
    link.href = parkGuidePath(park.reference);
    link.textContent = "Explore this park →";
    container.appendChild(link);
    return container;
  }

  function initializeMap(): void {
    if (map) return;
    map = L.map(mapElement, { ...referenceMapLeafletOptions, attributionControl: true });
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution('<a href="https://github.com/ripota/parks">RI park data</a>');
    for (const park of payload.items) {
      const marker = L.marker([park.latitude, park.longitude], {
        icon: L.divIcon({ className: "event-replay__marker", html: '<span class="event-replay__dot" aria-hidden="true"></span>', iconSize: [32, 32], iconAnchor: [16, 16] }),
        keyboard: true, title: `${park.name} · ${park.reference}`, alt: park.name,
      }).addTo(map);
      marker.bindPopup(() => popup(park), { maxWidth: 260, autoPanPadding: [16, 16] });
      marker.on("click", () => {
        pause();
        selectedPark = park.reference;
        const event = previousMoment.latestByPark.get(park.reference);
        detail.textContent = event ? eventDetail(event) : `${park.name} · No spot report yet at this point.`;
        announce();
      });
      markers.set(park.reference, marker);
    }
    mapElement.addEventListener("pointerdown", () => { userMovedMap = true; pause(); });
    mapElement.addEventListener("keydown", event => {
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "+", "-", "Enter", " "].includes(event.key)) {
        userMovedMap = true;
        pause();
      }
    });
    const fit = () => {
      if (!map || !mapElement.clientWidth || !mapElement.clientHeight) return;
      map.invalidateSize({ animate: false });
      if (!userMovedMap) {
        map.fitBounds(payload.items.map(park => [park.latitude, park.longitude] as [number, number]), {
          paddingTopLeft: [32, 24], paddingBottomRight: [32, 28], maxZoom: 10, animate: false,
        });
      }
    };
    // Fit before observing user navigation: programmatic zoom isn't interaction.
    userMovedMap = false;
    fit();
    userMovedMap = false;
    new ResizeObserver(fit).observe(mapElement);
  }

  function eventDetail(event: EventReplayEvent): string {
    return `${parks.get(event.parkReference)?.name ?? event.parkReference} · ${event.activatorCallsign}${event.mode ? ` · ${event.mode}` : ""}`;
  }

  function draw(animate = false): void {
    if (!data) return;
    const moment = replayMoment(data.events, at);
    const progress = (at - start) / (end - start);
    scrubber.value = String(Math.round(progress * 1000));
    const displayTime = at === end ? end - 1 : at;
    scrubber.setAttribute("aria-valuetext", `${replayTimeLabel(displayTime)}, ${moment.heard.size} parks heard`);
    clock.dateTime = new Date(displayTime).toISOString();
    clock.textContent = replayTimeLabel(displayTime);
    count.textContent = String(moment.heard.size);
    find("[data-replay-count-label]").textContent = at === end ? "Parks heard" : "Parks heard so far";
    endButton.disabled = at === end;
    phaseLabel.textContent = at === end ? "Weekend complete" : at < Date.parse("2026-09-11T00:00:00Z") ? "Early activations · Sep 10" : "Across the weekend";
    for (const [reference, marker] of markers) {
      const element = marker.getElement();
      if (!element) continue;
      const heard = moment.heard.has(reference);
      element.dataset.heard = String(heard);
      element.setAttribute("aria-label", `${parks.get(reference)!.name} · ${reference} · ${heard ? "Reported on air" : "Not yet heard"}`);
      const current = moment.latestByPark.get(reference);
      const before = previousMoment.latestByPark.get(reference);
      if (animate && !motion.matches && current && current !== before && performance.now() - (lastPulse.get(reference) ?? -Infinity) > 1200) {
        delete element.dataset.pulse;
        void element.offsetWidth;
        element.dataset.pulse = before ? "again" : "first";
        lastPulse.set(reference, performance.now());
      } else if (!animate) {
        delete element.dataset.pulse;
      }
    }
    Array.from(activity.children).forEach((bar, index) => {
      (bar as HTMLElement).dataset.past = String((index + .5) / activity.children.length <= progress);
    });
    if (!selectedPark && (!animate || at === end || performance.now() - lastDetailDraw >= 1000)) {
      detail.textContent = at === end
        ? `${moment.heard.size} parks heard across the weekend. Select a park to explore its activity.`
        : moment.latest ? eventDetail(moment.latest) : "The opening moments. A 72-second replay of the weekend.";
      lastDetailDraw = performance.now();
    }
    previousMoment = moment;
  }

  function seek(value: number): void {
    pause();
    selectedPark = undefined;
    map?.closePopup();
    at = start + value / 1000 * (end - start);
    draw();
    syncPlayback();
  }

  const togglePlayback = () => {
    if (!data) return;
    if (wantsPlay && root.dataset.state === "playing") { pause(); announce(); return; }
    selectedPark = undefined;
    map?.closePopup();
    if (at === end) { at = start; draw(); }
    wantsPlay = true;
    hasStarted = true;
    syncPlayback();
  };
  play.addEventListener("click", togglePlayback);
  badge.addEventListener("click", togglePlayback);
  endButton.addEventListener("click", () => { seek(1000); announce(); });
  scrubber.addEventListener("input", () => seek(Number(scrubber.value)));
  scrubber.addEventListener("change", announce);
  retry.addEventListener("click", () => { void load(); });
  document.addEventListener("visibilitychange", syncPlayback);
  motion.addEventListener("change", () => {
    if (motion.matches && data) { seek(1000); announce(); }
  });
  new IntersectionObserver(entries => {
    visible = entries[0].isIntersecting && entries[0].intersectionRatio >= .15;
    syncPlayback();
  }, { threshold: [0, .15] }).observe(mapElement);
  new IntersectionObserver(entries => {
    componentVisible = entries[0].isIntersecting;
    syncPlayback();
  }).observe(root);

  async function load(): Promise<void> {
    root.dataset.state = "loading";
    retry.hidden = true;
    detail.textContent = "Loading archived park activity…";
    try {
      const response = await fetchEventReplay();
      if (response.totalParks !== payload.items.length || response.events.some(event => !parks.has(event.parkReference))) throw new Error("Park catalog mismatch");
      data = response;
      start = Date.parse(data.window.start);
      end = Date.parse(data.window.end);
      at = motion.matches ? end : start;
      const bins = replayActivity(data.events, start, end);
      const max = Math.max(1, ...bins);
      activity.replaceChildren(...bins.map(value => {
        const bar = document.createElement("span");
        bar.style.height = `${Math.max(5, value / max * 100)}%`;
        return bar;
      }));
      draw();
      notice.hidden = !data.truncated;
      notice.textContent = "Repeated reports are condensed; each park’s first and last report are retained.";
      if (!data.events.length) {
        pause();
        root.dataset.state = "empty";
        phaseLabel.textContent = "No replay reports yet";
        detail.textContent = "There are no archived spot reports to replay. Explore the park results for available activation records.";
        return;
      }
      badge.disabled = play.disabled = scrubber.disabled = false;
      endButton.disabled = at === end;
      wantsPlay = !motion.matches;
      syncPlayback();
    } catch {
      root.dataset.state = "unavailable";
      phaseLabel.textContent = "Replay unavailable";
      detail.textContent = "The event replay is temporarily unavailable. Park results are still available below the recap totals.";
      retry.hidden = false;
      announcement.textContent = "The event replay is temporarily unavailable.";
    }
  }

  subscribeEventPhase(phase => {
    enabled = phase === "post-event";
    if (enabled && !requested) {
      requested = true;
      initializeMap();
      void load();
    }
    syncPlayback();
  });
}
