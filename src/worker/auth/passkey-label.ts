type PasskeyLabelInput = {
  aaguid: string;
  deviceType: "singleDevice" | "multiDevice";
  backedUp: boolean;
  transports?: readonly string[];
};

// Provider names are sourced from the community AAGUID registry. Unknown or
// privacy-redacted AAGUIDs deliberately fall through to capability-based names.
// https://github.com/passkeydeveloper/passkey-authenticator-aaguids
const providerByAaguid: Readonly<Record<string, string>> = {
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "Keeper",
  "50726f74-6f6e-5061-7373-50726f746f6e": "Proton Pass",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "b78a0a55-6ef8-d246-a042-ba0f6d55050c": "LastPass",
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "NordPass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Password Manager",
  "f3809540-7f14-49c1-a8b3-8f813b225541": "Enpass",
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "Apple Passwords",
};

export function defaultPasskeyLabel(input: PasskeyLabelInput): string {
  const provider = providerByAaguid[input.aaguid.toLowerCase()];
  if (provider) {
    return provider;
  }
  if (input.backedUp || input.deviceType === "multiDevice") {
    return "Synced passkey";
  }
  if (input.transports?.some((transport) =>
    transport === "usb" || transport === "nfc" || transport === "ble"
  )) {
    return "Security key";
  }
  return "Device passkey";
}
