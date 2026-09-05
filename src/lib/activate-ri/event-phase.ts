import { activateRi2026Event } from "../../data/activate-ri-2026/event";
import type { EventPhase } from "./types";

export const eventStart = Date.parse(`${activateRi2026Event.softStartDate}T00:00:00Z`);
export const eventEnd = Date.parse(`${activateRi2026Event.mainEndDate}T00:00:00Z`) + 86_400_000;

export function eventPhaseAt(now = new Date()): EventPhase {
  if (now.valueOf() >= eventEnd) return "post-event";
  if (now.valueOf() >= eventStart) return "event-live";
  return activateRi2026Event.phase;
}

// Evaluate at runtime: a static build made before the event must still transition.
export function subscribeEventPhase(listener: (phase: EventPhase) => void): () => void {
  let previous: EventPhase | undefined;
  let timer: number;
  const update = () => {
    const now = new Date();
    const phase = eventPhaseAt(now);
    if (phase !== previous) {
      previous = phase;
      listener(phase);
    }
    window.clearTimeout(timer);
    const boundary = now.valueOf() < eventStart ? eventStart : eventEnd;
    if (phase !== "post-event") {
      timer = window.setTimeout(update, Math.max(1, Math.min(60_000, boundary - now.valueOf())));
    }
  };
  const visible = () => { if (!document.hidden) update(); };
  document.addEventListener("visibilitychange", visible);
  update();
  return () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", visible);
  };
}
