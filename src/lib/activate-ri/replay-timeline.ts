import type { EventReplayEvent } from "./event-replay";

export const replayDurationMs = 72_000;

// Give the opening frame a beat, then get to the first real report. Scrubbing
// still uses the full, linear event timeline; only playback compresses silence.
export function advanceReplay(at: number, elapsed: number, start: number, end: number, firstReport: number): number {
  const first = Math.max(start, Math.min(end, firstReport));
  const intro = Math.min(1_000, (first - start) / (end - start) * replayDurationMs);
  const position = at < first
    ? (at - start) / (first - start) * intro
    : intro + (at - first) / (end - first) * (replayDurationMs - intro);
  const next = Math.min(replayDurationMs, position + Math.max(0, elapsed));
  return next < intro
    ? start + next / intro * (first - start)
    : first + (next - intro) / (replayDurationMs - intro) * (end - first);
}

export type ReplayMoment = {
  at: number;
  heard: Set<string>;
  latestByPark: Map<string, EventReplayEvent>;
  latest: EventReplayEvent | null;
};

export function replayMoment(events: readonly EventReplayEvent[], at: number): ReplayMoment {
  const latestByPark = new Map<string, EventReplayEvent>();
  let latest: EventReplayEvent | null = null;
  for (const event of events) {
    if (Date.parse(event.at) > at) break;
    latestByPark.set(event.parkReference, event);
    latest = event;
  }
  return { at, heard: new Set(latestByPark.keys()), latestByPark, latest };
}

// Count parks with a report in each hour. Re-spots should not make one busy
// station dwarf the rest of the state in this compact activity silhouette.
export function replayActivity(events: readonly EventReplayEvent[], start: number, end: number, bins = 96): number[] {
  const references = Array.from({ length: bins }, () => new Set<string>());
  for (const event of events) {
    const at = Date.parse(event.at);
    if (at < start || at >= end) continue;
    const index = Math.min(bins - 1, Math.floor((at - start) / (end - start) * bins));
    references[index].add(event.parkReference);
  }
  return references.map(bucket => bucket.size);
}

export function replayTimeLabel(at: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    hourCycle: "h23", timeZone: "UTC",
  }).format(at) + " UTC";
}
