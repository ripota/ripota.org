export type ActivationTimeZoneValue =
  | "utc"
  | "eastern"
  | "central"
  | "mountain"
  | "pacific";

export type ActivationTimeZoneOption = {
  value: ActivationTimeZoneValue;
  label: string;
  timeZone: string;
};

export type ActivationTimeInput = {
  plannedDate: string;
  startTime: string;
  endTime?: string;
};

export const activationTimeZoneOptions: ActivationTimeZoneOption[] = [
  { value: "eastern", label: "Eastern", timeZone: "America/New_York" },
  { value: "utc", label: "UTC", timeZone: "UTC" },
  { value: "central", label: "Central", timeZone: "America/Chicago" },
  { value: "mountain", label: "Mountain", timeZone: "America/Denver" },
  { value: "pacific", label: "Pacific", timeZone: "America/Los_Angeles" },
];

export function timeZoneOptionForValue(
  value: string | null | undefined,
): ActivationTimeZoneOption {
  return (
    activationTimeZoneOptions.find((option) => option.value === value) ??
    activationTimeZoneOptions[0]
  );
}

export function formatActivationDate(
  input: Pick<ActivationTimeInput, "plannedDate" | "startTime">,
  option = activationTimeZoneOptions[0],
): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: option.timeZone,
  }).format(eventUtcDate(input.plannedDate, input.startTime));
}

export function formatActivationTimeRange(
  input: Required<ActivationTimeInput>,
  option = activationTimeZoneOptions[0],
): string {
  const startDate = eventUtcDate(input.plannedDate, input.startTime);
  const start = formatTime(startDate, option);
  const end = formatTime(
    endDateFromStart(startDate, input.startTime, input.endTime),
    option,
  );
  const zone = formatTimeZone(startDate, option);

  return `${start}-${end} ${zone}`;
}

export function stopTimeToInstant(plannedDate: string, time: string): string {
  return utcDate(plannedDate, time).toISOString();
}

export function stopTimeRangeToInstants(
  plannedDate: string,
  startTime: string,
  endTime: string,
  options: { utcDateOffset?: number } = {},
): { startAt: string; endAt: string } {
  const startDate = utcDate(
    addUtcDays(plannedDate, options.utcDateOffset ?? 0),
    startTime,
  );

  return {
    startAt: startDate.toISOString(),
    endAt: endDateFromStart(startDate, startTime, endTime).toISOString(),
  };
}

export function instantToPlannedDate(instant: string): string {
  return instant.slice(0, 10);
}

export function instantToEventDate(instant: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "America/New_York",
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

export function instantToTime(instant: string): string {
  return instant.slice(11, 16);
}

function utcDate(plannedDate: string, time: string): Date {
  return new Date(`${plannedDate}T${time}:00Z`);
}

function eventUtcDate(plannedDate: string, time: string): Date {
  return utcDate(addUtcDays(plannedDate, time < "04:00" ? 1 : 0), time);
}

function endDateFromStart(startDate: Date, startTime: string, endTime: string): Date {
  const date = new Date(startDate);
  const [hours, minutes] = endTime.split(":").map(Number);
  date.setUTCHours(hours, minutes, 0, 0);
  if (endTime <= startTime) {
    date.setUTCDate(date.getUTCDate() + 1);
  }

  return date;
}

function addUtcDays(date: string, days: number): string {
  if (days === 0) {
    return date;
  }

  const utc = new Date(`${date}T00:00:00Z`);
  utc.setUTCDate(utc.getUTCDate() + days);

  return utc.toISOString().slice(0, 10);
}

function formatTime(date: Date, option: ActivationTimeZoneOption): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: option.timeZone,
  }).format(date);
}

function formatTimeZone(date: Date, option: ActivationTimeZoneOption): string {
  const zone = new Intl.DateTimeFormat("en-US", {
    timeZone: option.timeZone,
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((part) => part.type === "timeZoneName")?.value;

  return zone ?? option.label;
}
