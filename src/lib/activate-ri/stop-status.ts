import type { ActivationStopActivity, ActivationStopStatus } from "./types";

const stopStatusLabels: Record<ActivationStopStatus, string> = {
  "pending-review": "Pending review",
  scheduled: "Scheduled",
  delayed: "Delayed",
  cancelled: "Cancelled",
  completed: "Done",
};

export function stopStatusLabel(status: string): string {
  return Object.hasOwn(stopStatusLabels, status)
    ? stopStatusLabels[status as ActivationStopStatus]
    : status;
}

export function isStopDone(stop: { status: string; activity?: ActivationStopActivity }): boolean {
  return stop.status === "completed" || (stop.activity === "confirmed" && (stop.status === "scheduled" || stop.status === "delayed"));
}

export function scheduleStopStatusLabel(stop: { status: string; activity?: ActivationStopActivity }): string {
  return isStopDone(stop) ? "Done" : stopStatusLabel(stop.status);
}

export function stopActivityLabel(activity: ActivationStopActivity): string {
  return activity === "confirmed" ? "POTA confirmed" : "Spotted";
}
