export type ParkMediaCounts = Readonly<{ photos: number; videos: number }>;

export type ParkMediaState =
  | { status: "loading" }
  | { status: "ready"; counts: ReadonlyMap<string, ParkMediaCounts> }
  | { status: "unavailable" };

type Listener = (state: ParkMediaState) => void;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchParkMediaCounts(fetcher: Fetcher = fetch): Promise<ReadonlyMap<string, ParkMediaCounts>> {
  const response = await fetcher("/api/activate-ri-2026/public/media?summary=parks", {
    headers: { accept: "application/json" },
    cache: "no-store",
    credentials: "omit",
  });
  if (!response.ok) throw new Error("Park media response was unavailable.");
  const value: unknown = await response.json();
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.parks)) {
    throw new Error("Park media response was invalid.");
  }
  const counts = new Map<string, ParkMediaCounts>();
  for (const park of value.parks) {
    if (!isRecord(park) || typeof park.reference !== "string" || !/^US-\d+$/.test(park.reference) ||
      !isCount(park.photos) || !isCount(park.videos) || counts.has(park.reference)) {
      throw new Error("Park media response was invalid.");
    }
    counts.set(park.reference, { photos: park.photos, videos: park.videos });
  }
  return counts;
}

// The recap map and results table share one request. A failed refresh clears
// availability so neither can advertise a gallery whose contents are unknown.
export function createParkMediaStore(
  fetchCounts: () => Promise<ReadonlyMap<string, ParkMediaCounts>> = fetchParkMediaCounts,
) {
  const listeners = new Set<Listener>();
  let state: ParkMediaState = { status: "loading" };
  let started = false;
  let inProgress: Promise<void> | undefined;
  const publish = (next: ParkMediaState) => {
    state = next;
    listeners.forEach((listener) => listener(next));
  };
  const refresh = (): Promise<void> => {
    if (inProgress) return inProgress;
    started = true;
    publish({ status: "loading" });
    inProgress = Promise.resolve().then(fetchCounts)
      .then((counts) => publish({ status: "ready", counts }))
      .catch(() => publish({ status: "unavailable" }))
      .finally(() => { inProgress = undefined; });
    return inProgress;
  };
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    start(): void {
      if (!started) void refresh();
    },
    refresh,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export const parkMediaStore = createParkMediaStore();
