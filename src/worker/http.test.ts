import { describe, expect, it } from "vitest";
import { json } from "./http";

describe("json responses", () => {
  it("preserves Headers instances and multiple cookies", () => {
    const headers = new Headers();
    headers.append("set-cookie", "first=one; Path=/");
    headers.append("set-cookie", "second=two; Path=/");
    headers.set("x-test", "present");

    const response = json({ ok: true }, { headers });

    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("x-test")).toBe("present");
    expect(response.headers.get("set-cookie")).toContain("first=one");
    expect(response.headers.get("set-cookie")).toContain("second=two");
  });
});
