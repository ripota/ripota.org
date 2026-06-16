import type { ActivateRiEvent } from "../../lib/activate-ri/types";

export const activateRi2026Event = {
  id: "activate-ri-2026",
  name: "Activate All RI 2026",
  slug: "activate-ri-2026",
  phase: "planning",
  mainStartDate: "2026-09-11",
  mainEndDate: "2026-09-13",
  softStartDate: "2026-09-10",
  timezone: "America/New_York",
  goalParkCount: 61,
  publicSummary:
    "A Rhode Island POTA community weekend to cover all 61 Rhode Island references.",
  phaseCtas: {
    planning: {
      primary: {
        label: "Volunteer to activate",
        href: "/activate-ri-2026/volunteer/",
        description: "Submit one park or a multi-park route for organizer review.",
      },
      secondary: {
        label: "See the schedule",
        href: "/activate-ri-2026/schedule/",
        description: "Review planned activation windows as they are approved.",
      },
    },
    "schedule-live": {
      primary: {
        label: "Find scheduled activations",
        href: "/activate-ri-2026/schedule/",
        description: "Browse approved activation windows by date and time.",
      },
      secondary: {
        label: "Fill a coverage gap",
        href: "/activate-ri-2026/parks/",
        description: "Find parks that still need activator coverage.",
      },
    },
    "event-live": {
      primary: {
        label: "Open event schedule",
        href: "/activate-ri-2026/schedule/",
        description: "Use the schedule and official POTA spots during the event.",
      },
      secondary: {
        label: "Update my activation",
        href: "/activate-ri-2026/volunteer/",
        description: "Use your private edit link to update or cancel a stop.",
      },
    },
    "post-event": {
      primary: {
        label: "Check recognition",
        href: "/activate-ri-2026/awards/",
        description: "Review community recognition details after the event.",
      },
      secondary: {
        label: "Submit corrections",
        href: "/activate-ri-2026/volunteer/",
        description: "Contact organizers about schedule or log corrections.",
      },
    },
  },
} as const satisfies ActivateRiEvent;
