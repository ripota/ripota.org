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
  { value: "utc", label: "UTC", timeZone: "UTC" },
  { value: "eastern", label: "Eastern", timeZone: "America/New_York" },
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
  }).format(utcDate(input.plannedDate, input.startTime));
}

export function formatActivationTimeRange(
  input: Required<ActivationTimeInput>,
  option = activationTimeZoneOptions[0],
): string {
  const start = formatTime(utcDate(input.plannedDate, input.startTime), option);
  const end = formatTime(utcDate(input.plannedDate, input.endTime), option);
  const zone = formatTimeZone(utcDate(input.plannedDate, input.startTime), option);

  return `${start}-${end} ${zone}`;
}

export function stopTimeToInstant(plannedDate: string, time: string): string {
  return utcDate(plannedDate, time).toISOString();
}

export function instantToPlannedDate(instant: string): string {
  return instant.slice(0, 10);
}

export function instantToTime(instant: string): string {
  return instant.slice(11, 16);
}

function utcDate(plannedDate: string, time: string): Date {
  return new Date(`${plannedDate}T${time}:00Z`);
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
