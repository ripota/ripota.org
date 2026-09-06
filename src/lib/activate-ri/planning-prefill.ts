import { references } from "@ripota/parks";
import { timelineOptions } from "./listing";

export type PlanningPrefill = {
  parkReference: string;
  date?: string;
};

const parkReferences = new Set(references.map((park) => park.reference));
const eventDates = new Set<string>(timelineOptions.map((option) => option.value).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)));

export function readPlanningPrefill(search: string): PlanningPrefill | null {
  const params = new URLSearchParams(search);
  const parkReference = params.get("park")?.trim().toUpperCase() ?? "";
  if (!parkReferences.has(parkReference)) return null;

  const date = params.get("date") ?? "";
  return {
    parkReference,
    ...(eventDates.has(date) ? { date } : {}),
  };
}

export function planningPrefillPlanUrl(prefill: PlanningPrefill | null): string {
  const pathname = "/activate-ri-2026/activator/plan/";
  if (!prefill) return pathname;

  const params = new URLSearchParams({ park: prefill.parkReference });
  if (prefill.date) params.set("date", prefill.date);
  return `${pathname}?${params}`;
}
