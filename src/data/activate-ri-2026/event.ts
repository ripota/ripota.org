import { eventRoute } from "../../lib/activate-ri/paths";
import type { ActivateRiEvent } from "../../lib/activate-ri/types";

export const activateRi2026Event = {
  id: "activate-ri-2026",
  name: "Activate All RI 2026",
  slug: "activate-ri-2026",
  phase: "planning",
  mainStartDate: "2026-09-11",
  mainEndDate: "2026-09-13",
  softStartDate: "2026-09-10",
  timezone: "UTC",
  goalParkCount: 61,
  publicSummary:
    "Activate Rhode Island parks or work toward your Worked All RI award during our community POTA weekend.",
  phaseCtas: {
    planning: {
      primary: {
        label: "Add an activation",
        href: eventRoute("volunteer"),
        description: "Submit one park or a multi-park route for organizer review.",
      },
      secondary: {
        label: "Get ready to hunt",
        href: eventRoute("hunter"),
        description: "Find the parks you still need for your Worked All RI award.",
      },
    },
    "schedule-live": {
      primary: {
        label: "Add an activation",
        href: eventRoute("volunteer"),
        description: "Give hunters another chance with more parks, times, bands, and modes.",
      },
      secondary: {
        label: "Get ready to hunt",
        href: eventRoute("hunter"),
        description: "Find the parks you still need for your Worked All RI award.",
      },
    },
    "event-live": {
      primary: {
        label: "See RI on air now",
        href: "/on-air/",
        description: "Check current POTA spots for frequencies and modes.",
      },
      secondary: {
        label: "Update my activation",
        href: eventRoute("activatorPlan"),
        description: "Sign in to My Plan to update or cancel a stop.",
      },
    },
    "post-event": {
      primary: {
        label: "View event progress",
        href: eventRoute("progress"),
        description: "See Rhode Island park activity during the event.",
      },
      secondary: {
        label: "Submit corrections",
        href: eventRoute("help"),
        description: "Contact organizers about schedule or log corrections.",
      },
    },
  },
} as const satisfies ActivateRiEvent;
