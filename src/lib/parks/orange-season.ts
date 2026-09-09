const rhodeIslandDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", month: "numeric", day: "numeric",
});

// A planning reminder window, including time to prepare before hunting season.
export function isOrangeNoticeSeason(date = new Date()): boolean {
  const parts = rhodeIslandDate.formatToParts(date);
  const month = Number(parts.find((part) => part.type === "month")!.value);
  const day = Number(parts.find((part) => part.type === "day")!.value);
  return month < 6 || month > 8 || (month === 8 && day >= 15);
}
