export type EventPageKey =
  | "home"
  | "volunteer"
  | "schedule"
  | "parks"
  | "hunters"
  | "awards"
  | "admin";

const routes: Record<EventPageKey, string> = {
  home: "/activate-ri-2026/",
  volunteer: "/activate-ri-2026/volunteer/",
  schedule: "/activate-ri-2026/schedule/",
  parks: "/activate-ri-2026/parks/",
  hunters: "/activate-ri-2026/hunters/",
  awards: "/activate-ri-2026/awards/",
  admin: "/activate-ri-2026/admin/",
};

export type PublicDataKey = "event" | "parks";

export function eventRoute(key: EventPageKey): string {
  return routes[key];
}

export function publicDataPath(key: PublicDataKey): string {
  return `/data/activate-ri-2026/${key}.json`;
}
