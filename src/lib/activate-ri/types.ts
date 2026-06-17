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
  timezone: "UTC";
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
  counties: string[];
  status: ParkCoverageStatus;
  scheduledStopCount: number;
  cancelledStopCount: number;
  nextStop: PublicActivationStop | null;
  stops: PublicActivationStop[];
};

export type ActivationStopInput = {
  parkReference: string;
  plannedDate: string;
  timeBlock?: string;
  startTime: string;
  endTime: string;
  bands: string[];
  modes: string[];
  publicNotes?: string;
  organizerNotes?: string;
};

export type RouteSubmissionInput = {
  submitterCallsign: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone?: string;
  club?: string;
  publicNotes?: string;
  organizerNotes?: string;
  stops: ActivationStopInput[];
};

export type NormalizedRouteSubmission = {
  submitterCallsign: string;
  submitterName: string;
  submitterEmail: string;
  submitterPhone: string;
  club: string;
  publicNotes: string;
  organizerNotes: string;
  stops: Required<ActivationStopInput>[];
};

export type PlanSubmissionInput = RouteSubmissionInput;
export type NormalizedPlanSubmission = NormalizedRouteSubmission;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type PublicParkSummary = {
  reference: string;
  name: string;
  counties: string[];
  latitude?: number;
  longitude?: number;
  grid?: string;
  potaUrl?: string;
};

export type StopExportRow = {
  id: string;
  park_reference: string;
  start_at: string;
  end_at: string;
  submitter_callsign: string;
  submitter_email?: string;
  submitter_phone?: string;
  bands_json: string;
  modes_json: string;
  public_notes: string | null;
  organizer_notes?: string | null;
  status: ActivationStopStatus;
};
