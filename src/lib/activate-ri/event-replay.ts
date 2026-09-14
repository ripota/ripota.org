import { activateRiPotaEventId, activateRiPotaStartDate, activateRiPotaEndDate } from "./pota-event";

export const eventReplayPath = "/api/activate-ri-2026/public/event-replay";
export const eventReplayMaximumEventsPerPark = 128;
export const eventReplayWindow = {
  start: `${activateRiPotaStartDate}T00:00:00.000Z`,
  end: new Date(Date.parse(`${activateRiPotaEndDate}T00:00:00.000Z`) + 86_400_000).toISOString(),
};

/** A reported on-air observation, not the time an activation qualified. */
export type EventReplayEvent = {
  at: string;
  parkReference: string;
  activatorCallsign: string;
  mode: string;
  frequency: string;
};

export type EventReplay = {
  ok: true;
  eventId: string;
  generatedAt: string;
  window: { start: string; end: string };
  source: "pota-spot-archive";
  totalParks: number;
  /** Dense report streams are sampled across the full event, retaining each park's first and last report. */
  truncated: boolean;
  events: EventReplayEvent[];
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchEventReplay(fetcher: Fetcher = fetch): Promise<EventReplay> {
  const response = await fetcher(eventReplayPath, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Event replay is temporarily unavailable.");
  return parseEventReplay(await response.json());
}

export function parseEventReplay(value: unknown): EventReplay {
  const unavailable = () => new Error("Event replay is temporarily unavailable.");
  if (!isRecord(value) || value.ok !== true || value.eventId !== activateRiPotaEventId ||
    value.source !== "pota-spot-archive" || !isIsoDate(value.generatedAt) ||
    !isRecord(value.window) || value.window.start !== eventReplayWindow.start ||
    value.window.end !== eventReplayWindow.end ||
    typeof value.totalParks !== "number" || !Number.isSafeInteger(value.totalParks) ||
    value.totalParks < 1 || value.totalParks > 1_000 || typeof value.truncated !== "boolean" ||
    !Array.isArray(value.events) || value.events.length > value.totalParks * eventReplayMaximumEventsPerPark) {
    throw unavailable();
  }
  let previousAt = eventReplayWindow.start;
  const events = value.events.map((candidate): EventReplayEvent => {
    if (!isRecord(candidate) || !isIsoDate(candidate.at) ||
      candidate.at < previousAt || candidate.at >= eventReplayWindow.end ||
      typeof candidate.parkReference !== "string" || !/^[A-Z]{1,4}-\d{4,6}$/.test(candidate.parkReference) ||
      typeof candidate.activatorCallsign !== "string" || !/^[A-Z0-9/]{1,32}$/.test(candidate.activatorCallsign) ||
      typeof candidate.mode !== "string" || candidate.mode.length > 24 ||
      typeof candidate.frequency !== "string" || candidate.frequency.length > 32) {
      throw unavailable();
    }
    previousAt = candidate.at;
    return {
      at: candidate.at, parkReference: candidate.parkReference,
      activatorCallsign: candidate.activatorCallsign, mode: candidate.mode, frequency: candidate.frequency,
    };
  });
  return {
    ok: true, eventId: value.eventId, generatedAt: value.generatedAt,
    window: { ...eventReplayWindow }, source: "pota-spot-archive",
    totalParks: value.totalParks, truncated: value.truncated, events,
  };
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
