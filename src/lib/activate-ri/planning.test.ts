import { describe, expect, it } from "vitest";
import { deriveParkPlans, myScheduledParkReferences } from "./planning";
import type { PublicActivationStop, PublicParkSummary } from "./types";

const parks: PublicParkSummary[] = [
  { reference: "US-2868", name: "Beavertail State Park", counties: ["Newport County"] },
  { reference: "US-2872", name: "Colt State Park", counties: ["Bristol County"] },
  { reference: "US-2874", name: "Fort Adams State Park", counties: ["Newport County"] },
];

function stop(id: string, values: Partial<PublicActivationStop> = {}): PublicActivationStop {
  return {
    id,
    parkReference: "US-2868",
    plannedDate: "2026-09-12",
    startTime: "09:00",
    endTime: "12:00",
    activatorCallsign: "N1RWJ",
    bands: ["20m"],
    modes: ["SSB"],
    publicNotes: "",
    status: "scheduled",
    ...values,
  };
}

describe("deriveParkPlans", () => {
  it("counts distinct normalized callsigns and exact date, start, and end windows", () => {
    const [plan] = deriveParkPlans([parks[0]], [
      stop("morning"),
      stop("shared-window", { activatorCallsign: "K1ABC" }),
      stop("same-operator", { activatorCallsign: " n1rwj ", bands: ["40m"], modes: ["CW"] }),
      stop("different-start", { startTime: "10:00" }),
      stop("different-end", { endTime: "13:00" }),
      stop("different-date", { plannedDate: "2026-09-13" }),
    ]);

    expect(plan.activatorCount).toBe(2);
    expect(plan.timeSlotCount).toBe(4);
    expect(plan.stops).toHaveLength(6);
  });

  it("counts scheduled and delayed stops while excluding cancelled, completed, pending, and sample stops", () => {
    const [plan] = deriveParkPlans([parks[0]], [
      stop("scheduled"),
      stop("delayed", { status: "delayed", activatorCallsign: "K1ABC", startTime: "13:00" }),
      stop("cancelled", { status: "cancelled", activatorCallsign: "K1CAN" }),
      stop("completed", { status: "completed", activatorCallsign: "K1DONE" }),
      stop("pending", { status: "pending-review", activatorCallsign: "K1PEND" }),
      stop("sample-example", { activatorCallsign: "K1SAMP" }),
    ]);

    expect(plan.activatorCount).toBe(2);
    expect(plan.timeSlotCount).toBe(2);
    expect(plan.stops.map((entry) => entry.id)).toEqual(["scheduled", "delayed"]);
  });

  it.each([
    ["2026-09-10", ["soft"]],
    ["soft-start", ["soft"]],
    ["main", ["friday", "saturday", "sunday"]],
    ["2026-09-12", ["saturday"]],
    ["all", ["soft", "friday", "saturday", "sunday"]],
  ])("scopes counts to %s while retaining and prioritizing parks with no matching stops", (timeline, ids) => {
    const plans = deriveParkPlans(parks, [
      stop("sunday", { plannedDate: "2026-09-13" }),
      stop("soft", { plannedDate: "2026-09-10" }),
      stop("saturday", { plannedDate: "2026-09-12" }),
      stop("friday", { plannedDate: "2026-09-11" }),
    ], { timeline });

    expect(plans.map((plan) => plan.reference)).toEqual(["US-2872", "US-2874", "US-2868"]);
    expect(plans[0]).toMatchObject({ activatorCount: 0, timeSlotCount: 0, stops: [] });
    expect(plans[1]).toMatchObject({ activatorCount: 0, timeSlotCount: 0, stops: [] });
    expect(plans[2]).toMatchObject({ activatorCount: 1, timeSlotCount: ids.length });
    expect(plans[2].stops.map((entry) => entry.id)).toEqual(ids);
  });

  it("uses the supplied planned date for day membership, including late-night windows", () => {
    const [plan] = deriveParkPlans([parks[0]], [
      stop("late", { plannedDate: "2026-09-11", startTime: "23:00", endTime: "23:59" }),
    ], { timeline: "2026-09-11" });

    expect(plan.activatorCount).toBe(1);
    expect(plan.timeSlotCount).toBe(1);
  });

  it("orders detail windows chronologically across UTC midnight within the event day", () => {
    const [plan] = deriveParkPlans([parks[0]], [
      stop("late-evening", { startTime: "01:00", endTime: "02:00" }),
      stop("evening-long", { startTime: "23:00", endTime: "01:00" }),
      stop("following-day", { plannedDate: "2026-09-13", startTime: "05:00", endTime: "06:00" }),
      stop("morning", { startTime: "10:00", endTime: "12:00" }),
      stop("evening-short", { startTime: "23:00", endTime: "23:59" }),
      stop("afternoon", { startTime: "17:00", endTime: "19:00" }),
    ]);

    expect(plan.stops.map((entry) => entry.id)).toEqual([
      "morning", "afternoon", "evening-short", "evening-long", "late-evening", "following-day",
    ]);
  });

  it("filters parks by county, including parks without plans and parks spanning counties", () => {
    const spanningCountyPark = { ...parks[1], counties: ["Bristol County", "Newport County"] };
    const plans = deriveParkPlans([parks[0], spanningCountyPark, parks[2]], [], { county: "Newport County" });

    expect(plans.map((plan) => plan.reference)).toEqual(["US-2868", "US-2872", "US-2874"]);
    expect(deriveParkPlans(parks, [], { county: "Bristol County" }).map((plan) => plan.reference)).toEqual(["US-2872"]);
    expect(deriveParkPlans(parks, [], { county: "all" })).toHaveLength(3);
  });

  it("keeps all activators at my parks and retains my parks on days when I am not scheduled", () => {
    const stops = [
      stop("mine-friday", { plannedDate: "2026-09-11" }),
      stop("other-saturday", { activatorCallsign: "K1ABC" }),
      stop("third-saturday", { activatorCallsign: "W1XYZ" }),
      stop("mine-other-park-friday", { parkReference: "US-2872", plannedDate: "2026-09-11" }),
    ];
    const plans = deriveParkPlans(parks, stops, {
      timeline: "2026-09-12",
      myParkReferences: myScheduledParkReferences(stops, "N1RWJ"),
    });

    expect(plans.map((plan) => plan.reference)).toEqual(["US-2872", "US-2868"]);
    expect(plans[0]).toMatchObject({ activatorCount: 0, timeSlotCount: 0 });
    expect(plans[1]).toMatchObject({ activatorCount: 2, timeSlotCount: 1 });
    expect(deriveParkPlans(parks, stops, { myParkReferences: new Set() })).toEqual([]);
  });

  it("defaults to fewest activators, breaking ties by time slots then park name and reference", () => {
    const sameNameParks = [
      { ...parks[0], reference: "US-3002" },
      { ...parks[0], reference: "US-3001" },
    ];
    const plans = deriveParkPlans([...parks, ...sameNameParks], [
      stop("beavertail-morning"),
      stop("beavertail-afternoon", { startTime: "13:00", endTime: "16:00" }),
      stop("colt-first", { parkReference: "US-2872" }),
      stop("colt-second", { parkReference: "US-2872", activatorCallsign: "K1ABC" }),
      stop("fort-adams", { parkReference: "US-2874" }),
    ]);

    expect(plans.map((plan) => plan.reference)).toEqual([
      "US-3001", "US-3002", "US-2874", "US-2868", "US-2872",
    ]);
  });

  it("sorts fewest time slots first, breaking ties by activators then park name and reference", () => {
    const plans = deriveParkPlans(parks, [
      stop("beavertail-morning"),
      stop("beavertail-afternoon", { startTime: "13:00", endTime: "16:00" }),
      stop("colt-first", { parkReference: "US-2872" }),
      stop("colt-second", { parkReference: "US-2872", activatorCallsign: "K1ABC" }),
      stop("fort-adams", { parkReference: "US-2874" }),
    ], { sort: "slots" });

    expect(plans.map((plan) => plan.reference)).toEqual(["US-2874", "US-2872", "US-2868"]);
  });

  it("offers alphabetical order independent of coverage, with reference as a stable tie-breaker", () => {
    const duplicateName = { ...parks[0], reference: "US-2867" };
    const plans = deriveParkPlans([parks[2], parks[1], parks[0], duplicateName], [stop("scheduled")], { sort: "name" });

    expect(plans.map((plan) => plan.reference)).toEqual(["US-2867", "US-2868", "US-2872", "US-2874"]);
  });
});

describe("myScheduledParkReferences", () => {
  it("returns distinct parks for the normalized callsign across the event", () => {
    const references = myScheduledParkReferences([
      stop("first", { activatorCallsign: " n1rwj ", plannedDate: "2026-09-10" }),
      stop("repeat", { plannedDate: "2026-09-13" }),
      stop("delayed", { parkReference: "US-2872", status: "delayed" }),
      stop("another-operator", { parkReference: "US-2874", activatorCallsign: "K1ABC" }),
    ], " n1Rwj ");

    expect([...references]).toEqual(["US-2868", "US-2872"]);
  });

  it("excludes inactive and sample stops and does not match an empty callsign", () => {
    const stops = [
      stop("cancelled", { status: "cancelled" }),
      stop("completed", { status: "completed" }),
      stop("pending", { status: "pending-review" }),
      stop("sample-example"),
      stop("empty-callsign", { activatorCallsign: "" }),
    ];

    expect([...myScheduledParkReferences(stops, "N1RWJ")]).toEqual([]);
    expect([...myScheduledParkReferences(stops, " ")]).toEqual([]);
  });
});
