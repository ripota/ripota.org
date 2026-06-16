export type EventPhase = "planning" | "schedule-live" | "event-live" | "post-event";

export type EventCta = {
  label: string;
  href: string;
  description: string;
};

export type EventPhaseCtas = Record<
  EventPhase,
  {
    primary: EventCta;
    secondary: EventCta;
  }
>;

export type ActivateRiEvent = {
  id: "activate-ri-2026";
  name: string;
  slug: string;
  phase: EventPhase;
  mainStartDate: string;
  mainEndDate: string;
  softStartDate: string;
  timezone: "America/New_York";
  goalParkCount: number;
  publicSummary: string;
  phaseCtas: EventPhaseCtas;
};

export type ActivationStopStatus =
  | "pending-review"
  | "scheduled"
  | "delayed"
  | "cancelled"
  | "completed";

export type PublicActivationStop = {
  id: string;
  parkReference: string;
  plannedDate: string;
  startTime: string;
  endTime: string;
  activatorCallsign: string;
  bands: string[];
  modes: string[];
  publicNotes: string;
  status: ActivationStopStatus;
};

export type ParkCoverageStatus =
  | "uncovered"
  | "scheduled"
  | "multiple-scheduled"
  | "cancelled-needs-replacement"
  | "completed";

export type ParkCoverage = {
  reference: string;
  name: string;
  status: ParkCoverageStatus;
  scheduledStopCount: number;
  cancelledStopCount: number;
  nextStop: PublicActivationStop | null;
  stops: PublicActivationStop[];
};
