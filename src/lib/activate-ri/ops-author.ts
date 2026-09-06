export function opsActivatorAuthorLabel(callsign: string, name: string): string {
  const normalizedCallsign = callsign.trim().toUpperCase();
  const firstName = name.trim().split(/\s+/u)[0] ?? "";

  if (!firstName || firstName.toUpperCase() === normalizedCallsign) {
    return normalizedCallsign;
  }

  return `${normalizedCallsign} - ${firstName}`;
}
