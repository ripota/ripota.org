import { timelineOptions } from "./listing";
import type { PlanningSort } from "./planning";
import type { PublicParkSummary } from "./types";
import { readProgressView, type ProgressView } from "./progress-view";

export type PlanningView = {
  query: string;
  status: ProgressView["status"];
  sort: PlanningSort;
  timeline: string;
  county: string;
  mode: string;
  band: string;
  activator: string;
  mine: boolean;
  expanded: string[];
  moreFilters: boolean;
};

export function readPlanningView(url: URL, parks: readonly PublicParkSummary[]): PlanningView {
  const params = url.searchParams;
  const progress = readProgressView(url);
  const query = params.has("q") ? params.get("q")!.trim() : progress.query;
  const sort = params.get("sort");
  const timeline = params.get("timeline") ?? "all";
  const county = params.get("county") ?? "all";
  const mode = radioFilter(params.get("mode"));
  const band = radioFilter(params.get("band"));
  const requestedActivator = (params.get("activator") ?? "").trim().toUpperCase();
  const activator = /^[A-Z0-9][A-Z0-9/-]{0,31}$/.test(requestedActivator) ? requestedActivator : "";
  const knownReferences = new Set(parks.map((park) => park.reference));
  const expanded = uniqueSorted((params.get("expanded") ?? "").split(",")
    .map((reference) => reference.trim().toUpperCase())
    .filter((reference) => knownReferences.has(reference)));
  // Existing map/result links should still reveal the selected park's plans.
  if (!params.has("q") && !params.has("expanded") && knownReferences.has(query.toUpperCase())) {
    expanded.push(query.toUpperCase());
  }
  const more = params.get("more");

  return {
    query,
    status: progress.status,
    sort: sort === "slots" || sort === "name" ? sort : "activators",
    timeline: timelineOptions.some((option) => option.value === timeline) ? timeline : "all",
    county: parks.some((park) => park.counties.includes(county)) ? county : "all",
    mode,
    band,
    activator,
    mine: !activator && params.get("mine") === "1",
    expanded,
    moreFilters: more === "1" || (more !== "0" && hasRadioFilters(mode, band)),
  };
}

export function writePlanningView(url: URL, view: PlanningView): URL {
  const result = new URL(url.href);
  const params = result.searchParams;
  params.delete("coverage");
  params.delete("progress-q");
  if (view.query.trim()) params.set("q", view.query.trim());
  else params.delete("q");
  if (view.status === "all") params.delete("progress-status");
  else params.set("progress-status", view.status);

  for (const key of ["sort", "timeline", "county", "mode", "band"] as const) {
    const defaultValue = key === "sort" ? "activators" : "all";
    if (view[key] === defaultValue) params.delete(key);
    else params.set(key, view[key]);
  }

  if (view.activator) {
    params.set("activator", view.activator);
    params.delete("mine");
  } else {
    params.delete("activator");
    if (view.mine) params.set("mine", "1");
    else params.delete("mine");
  }

  const expanded = uniqueSorted(view.expanded);
  if (expanded.length) params.set("expanded", expanded.join(","));
  else params.delete("expanded");

  if (view.moreFilters === hasRadioFilters(view.mode, view.band)) params.delete("more");
  else params.set("more", view.moreFilters ? "1" : "0");

  return result;
}

function radioFilter(value: string | null): string {
  const normalized = value?.trim() ?? "";
  return normalized && normalized.length <= 32 && !/[\u0000-\u001f\u007f<>]/.test(normalized)
    ? normalized
    : "all";
}

function hasRadioFilters(mode: string, band: string): boolean {
  return mode !== "all" || band !== "all";
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
