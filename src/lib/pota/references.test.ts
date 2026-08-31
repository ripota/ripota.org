import { describe, expect, it } from "vitest";
import { normalizePotaReference, officialPotaParkUrl } from "./references";

describe("POTA runtime reference helpers", () => {
  it("normalizes submitted references and links official park pages", () => {
    expect(normalizePotaReference(" us-0514 ")).toBe("US-0514");
    expect(officialPotaParkUrl(" us-0514 ")).toBe(
      "https://pota.app/#/park/US-0514",
    );
  });
});
