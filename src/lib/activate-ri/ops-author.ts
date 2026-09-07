export function opsActivatorDisplayName(
  callsign: string,
  name: string,
  chatDisplayName: string | null = null,
): string {
  if (chatDisplayName !== null) return chatDisplayName.trim();

  const normalizedCallsign = callsign.trim().toUpperCase();
  const firstName = name.trim().split(/\s+/u)[0] ?? "";
  return firstName.toUpperCase() === normalizedCallsign ? "" : firstName;
}

export function opsActivatorAuthorLabel(
  callsign: string,
  name: string,
  chatDisplayName: string | null = null,
): string {
  const normalizedCallsign = callsign.trim().toUpperCase();
  const displayName = opsActivatorDisplayName(callsign, name, chatDisplayName);

  if (!displayName || displayName.toUpperCase() === normalizedCallsign) {
    return normalizedCallsign;
  }

  return `${normalizedCallsign} - ${displayName}`;
}
