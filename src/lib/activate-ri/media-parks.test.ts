import { describe, expect, it } from "vitest";
import { mediaParkName, mediaParks, validateMediaParkReference } from "./media-parks";

describe("optional media park tags", () => {
  it("keeps general uploads available without a park", () => {
    expect(validateMediaParkReference(null)).toBe(true);
    expect(mediaParkName(null)).toBe("General — no park");
  });

  it("accepts Rhode Island park references and exposes readable park names", () => {
    expect(validateMediaParkReference("US-2868")).toBe(true);
    expect(validateMediaParkReference("US-0514")).toBe(true);
    expect(mediaParks).toEqual(expect.arrayContaining([
      expect.objectContaining({ reference: "US-2868", name: expect.any(String) }),
      expect.objectContaining({ reference: "US-0514", name: expect.any(String) }),
    ]));
    expect(mediaParkName("US-2868")).toMatch(/Beavertail/);
    expect(mediaParkName("US-0514")).toMatch(/Chafee/);
  });

  it.each([undefined, "", " ", "US-0001", "US-999999", "us-2868", " US-2868 ", 2868, false, {}, ["US-2868"]])(
    "rejects an invalid park tag %j", (value) => {
      expect(validateMediaParkReference(value)).toBe(false);
    },
  );

  it("keeps an unknown stored reference readable without treating it as a valid selection", () => {
    expect(mediaParkName("US-999999")).toBe("US-999999");
    expect(validateMediaParkReference("US-999999")).toBe(false);
  });
});
