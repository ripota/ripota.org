import type { PublicActivationStop } from "../../lib/activate-ri/types";

export const sampleActivationStops: PublicActivationStop[] = [
  {
    id: "sample-us-2868-n1rwj-2026-09-11-0900",
    parkReference: "US-2868",
    plannedDate: "2026-09-11",
    startTime: "09:00",
    endTime: "11:00",
    activatorCallsign: "N1RWJ",
    bands: ["40m", "20m"],
    modes: ["SSB"],
    publicNotes: "Sample planning record for development.",
    status: "scheduled",
  },
];
