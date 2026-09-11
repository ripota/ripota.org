import { describe, expect, it } from "vitest";
import { readPlanningView, writePlanningView, type PlanningView } from "./planning-view";
import type { PublicParkSummary } from "./types";

const parks: PublicParkSummary[] = [
  { reference: "US-2868", name: "Beavertail State Park", counties: ["Newport County"] },
  { reference: "US-2872", name: "Colt State Park", counties: ["Bristol County"] },
];

const defaults: PlanningView = {
  query: "", status: "all",
  sort: "activators", timeline: "all", county: "all", mode: "all", band: "all",
  activator: "", mine: false, expanded: [], moreFilters: false,
};

function url(query = ""): URL {
  return new URL(`https://ripota.org/activate-ri-2026/parks/${query}`);
}

describe("planning view URLs", () => {
  it("reads defaults when no planning parameters are supplied", () => {
    expect(readPlanningView(url(), parks)).toEqual(defaults);
  });

  it("round-trips every view property, keeping unrelated parameters and the page anchor", () => {
    const view: PlanningView = {
      query: "Beavertail", status: "confirmed",
      sort: "slots", timeline: "2026-09-12", county: "Newport County", mode: "CW", band: "20m",
      activator: "N1RWJ/P", mine: false, expanded: ["US-2868", "US-2872"], moreFilters: false,
    };
    const original = url("?source=club&source=email#park-planning");
    const result = writePlanningView(original, view);

    expect(readPlanningView(result, parks)).toEqual(view);
    expect(result.searchParams.getAll("source")).toEqual(["club", "email"]);
    expect(result.hash).toBe("#park-planning");
    expect(original.href).toBe(url("?source=club&source=email#park-planning").href);
    expect(result).not.toBe(original);
  });

  it("removes explicit defaults and the obsolete coverage filter", () => {
    const result = writePlanningView(url("?q=park&progress-q=park&progress-status=confirmed&sort=name&timeline=main&county=Newport+County&mode=CW&band=20m&activator=N1RWJ&mine=1&expanded=US-2868&more=1&coverage=needed&source=club#park-planning"), defaults);

    expect([...result.searchParams.entries()]).toEqual([["source", "club"]]);
    expect(result.hash).toBe("#park-planning");
  });

  it("migrates a legacy result link into the single park list with its plans expanded", () => {
    const original = url("?progress-q=us-2868&progress-status=confirmed#park-results");
    const view = readPlanningView(original, parks);
    expect(view).toEqual({ ...defaults, query: "us-2868", status: "confirmed", expanded: ["US-2868"] });
    const result = writePlanningView(original, view);
    expect(result.searchParams.get("q")).toBe("us-2868");
    expect(result.searchParams.has("progress-q")).toBe(false);
    expect(result.hash).toBe("#park-results");
    expect(readPlanningView(result, parks)).toEqual(view);
  });

  it("gives the unified query precedence and validates park status", () => {
    const view = readPlanningView(url("?q=Colt&progress-q=US-2868&progress-status=invalid"), parks);
    expect(view).toEqual({ ...defaults, query: "Colt" });
  });

  it("normalizes invalid sort, county, and day choices and deduplicates only known park references", () => {
    const parsed = readPlanningView(url("?sort=popular&timeline=2026-09-99&county=Unknown&expanded=us-2872,US-9999,%20us-2868%20,US-2872"), parks);

    expect(parsed).toEqual({ ...defaults, expanded: ["US-2868", "US-2872"] });
  });

  it.each(["soft-start", "main", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"])("retains valid timeline %s", (timeline) => {
    expect(readPlanningView(url(`?timeline=${timeline}`), parks).timeline).toBe(timeline);
  });

  it("preserves valid modes and bands independently of the current stops", () => {
    const parsed = readPlanningView(url("?mode=%20PSK31%20&band=%201.25m%20"), parks);

    expect(parsed).toMatchObject({ mode: "PSK31", band: "1.25m", moreFilters: true });
    expect(readPlanningView(writePlanningView(url(), parsed), parks)).toEqual(parsed);
  });

  it.each(["", " ", "x".repeat(33), "CW\nSSB", "<script>"])("rejects unsafe or oversized radio filter %j", (value) => {
    const request = url();
    request.searchParams.set("mode", value);
    request.searchParams.set("band", value);
    expect(readPlanningView(request, parks)).toMatchObject({ mode: "all", band: "all", moreFilters: false });
  });

  it("normalizes an explicit activator and gives it precedence over legacy My parks", () => {
    const parsed = readPlanningView(url("?activator=%20n1rwj%2Fp%20&mine=1"), parks);
    expect(parsed).toMatchObject({ activator: "N1RWJ/P", mine: false });

    const result = writePlanningView(url("?mine=1"), { ...parsed, mine: true });
    expect(result.searchParams.get("activator")).toBe("N1RWJ/P");
    expect(result.searchParams.has("mine")).toBe(false);
  });

  it.each(["/N1RWJ", "N1 RWJ", "N1RWJ?", "x".repeat(33)])("rejects malformed activator %s", (activator) => {
    const request = url();
    request.searchParams.set("activator", activator);
    expect(readPlanningView(request, parks).activator).toBe("");
  });

  it("round-trips legacy My parks when no explicit activator is selected", () => {
    const parsed = readPlanningView(url("?mine=1"), parks);
    expect(parsed).toEqual({ ...defaults, mine: true });
    expect(readPlanningView(writePlanningView(url(), parsed), parks)).toEqual(parsed);
  });

  it("writes expanded references once in a deterministic order", () => {
    const result = writePlanningView(url(), { ...defaults, expanded: ["US-2872", "US-2868", "US-2872"] });
    expect(result.searchParams.get("expanded")).toBe("US-2868,US-2872");
  });

  it.each([
    ["all", "all", false, null],
    ["all", "all", true, "1"],
    ["CW", "all", true, null],
    ["CW", "all", false, "0"],
    ["all", "20m", true, null],
    ["all", "20m", false, "0"],
  ] as const)("stores More filters only when it overrides the radio-filter default (%s, %s, %s)", (mode, band, moreFilters, serialized) => {
    const view = { ...defaults, mode, band, moreFilters };
    const result = writePlanningView(url("?more=obsolete"), view);

    expect(result.searchParams.get("more")).toBe(serialized);
    expect(readPlanningView(result, parks)).toEqual(view);
  });

  it("ignores malformed More filters values and uses the active-radio-filter default", () => {
    expect(readPlanningView(url("?more=maybe"), parks).moreFilters).toBe(false);
    expect(readPlanningView(url("?mode=CW&more=maybe"), parks).moreFilters).toBe(true);
  });
});
