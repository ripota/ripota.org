import { describe, expect, it } from "vitest";

import {
  chromiumLaunchOptions,
  previewProcessOptions,
  terminationSignalTarget,
} from "../scripts/activate-ri-2026/render-share-card.mjs";

describe("Activate RI share card renderer", () => {
  it("uses the configured Chromium channel when one is provided", () => {
    expect(
      chromiumLaunchOptions({
        PLAYWRIGHT_CHROMIUM_CHANNEL: "chrome",
      }),
    ).toEqual({ channel: "chrome" });
  });

  it("uses Playwright's default browser when no channel is configured", () => {
    expect(chromiumLaunchOptions({})).toEqual({});
  });

  it("starts the preview server in a process group on POSIX platforms", () => {
    expect(previewProcessOptions("linux")).toMatchObject({ detached: true });
    expect(terminationSignalTarget({ pid: 123 }, "linux")).toBe(-123);
  });
});
