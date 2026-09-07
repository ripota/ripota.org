import type { OpsMessageDto } from "./ops-types";

type GroupableOpsMessage = Pick<OpsMessageDto,
  "kind" | "authorType" | "authorActivatorId" | "authorLabel" |
  "parkReference" | "stopId" | "createdAt" | "removed"
>;

const timeZone = "America/New_York";
const calendarFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone, year: "numeric", month: "2-digit", day: "2-digit",
});
const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone, hour: "numeric", minute: "2-digit",
});
const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});
const yearDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

// The previous rendered message is newer because the room displays newest first.
export function continuesOpsMessageGroup(
  message: GroupableOpsMessage,
  previous?: GroupableOpsMessage,
): boolean {
  if (!previous || message.removed || previous.removed ||
      message.kind !== "chat" || previous.kind !== "chat" ||
      message.authorType !== "activator" || previous.authorType !== "activator" ||
      !message.authorActivatorId?.trim() || !message.authorLabel.trim() ||
      message.authorActivatorId !== previous.authorActivatorId ||
      message.authorLabel !== previous.authorLabel ||
      message.parkReference !== previous.parkReference || message.stopId !== previous.stopId) {
    return false;
  }

  const createdAt = new Date(message.createdAt);
  const previousCreatedAt = new Date(previous.createdAt);
  const ageDifference = previousCreatedAt.getTime() - createdAt.getTime();
  return Number.isFinite(ageDifference) && ageDifference >= 0 && ageDifference <= 5 * 60_000 &&
    calendarFormatter.format(createdAt) === calendarFormatter.format(previousCreatedAt);
}

export function opsMessageTimeLabel(value: string, now = new Date()): string {
  const createdAt = new Date(value);
  if (!Number.isFinite(createdAt.getTime())) return "Time unavailable";

  if (calendarFormatter.format(createdAt) === calendarFormatter.format(now)) {
    return timeFormatter.format(createdAt);
  }
  const year = (date: Date) => calendarFormatter.formatToParts(date)
    .find((part) => part.type === "year")?.value;
  return year(createdAt) === year(now)
    ? dateTimeFormatter.format(createdAt)
    : yearDateTimeFormatter.format(createdAt);
}
