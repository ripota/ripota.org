import { describe, expect, it } from "vitest";
import { defaultPasskeyLabel } from "./passkey-label";

describe("default passkey labels", () => {
  it.each([
    ["bada5566-a7aa-401f-bd96-45619a55120d", "1Password"],
    ["FBFC3007-154E-4ECC-8C0B-6E020557D7BD", "Apple Passwords"],
    ["ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4", "Google Password Manager"],
  ])("names recognized provider %s", (aaguid, expected) => {
    expect(defaultPasskeyLabel({
      aaguid,
      deviceType: "multiDevice",
      backedUp: true,
    })).toBe(expected);
  });

  it("uses a synced-passkey fallback for an unknown multi-device credential", () => {
    expect(defaultPasskeyLabel({
      aaguid: "00000000-0000-0000-0000-000000000000",
      deviceType: "multiDevice",
      backedUp: false,
    })).toBe("Synced passkey");
  });

  it("uses a security-key fallback for an unknown roaming authenticator", () => {
    expect(defaultPasskeyLabel({
      aaguid: "00000000-0000-0000-0000-000000000000",
      deviceType: "singleDevice",
      backedUp: false,
      transports: ["usb", "nfc"],
    })).toBe("Security key");
  });

  it("uses a device-passkey fallback when no more specific signal is available", () => {
    expect(defaultPasskeyLabel({
      aaguid: "00000000-0000-0000-0000-000000000000",
      deviceType: "singleDevice",
      backedUp: false,
      transports: ["internal"],
    })).toBe("Device passkey");
  });
});
