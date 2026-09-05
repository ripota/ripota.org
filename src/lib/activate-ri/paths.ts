export type EventPageKey =
  | "home"
  | "volunteer"
  | "schedule"
  | "parks"
  | "hunter"
  | "progress"
  | "activatorPlan"
  | "help"
  | "admin";

const routes: Record<EventPageKey, string> = {
  home: "/activate-ri-2026/",
  volunteer: "/activate-ri-2026/volunteer/",
  schedule: "/activate-ri-2026/schedule/",
  parks: "/activate-ri-2026/parks/",
  hunter: "/activate-ri-2026/hunter/",
  progress: "/activate-ri-2026/progress/",
  activatorPlan: "/activate-ri-2026/activator/plan/",
  help: "/activate-ri-2026/help/",
  admin: "/activate-ri-2026/admin/",
};

export type PublicDataKey = "event" | "parks" | "stops";

export function eventRoute(key: EventPageKey): string {
  return routes[key];
}

export function publicDataPath(key: PublicDataKey): string {
  return `/data/activate-ri-2026/${key}.json`;
}
