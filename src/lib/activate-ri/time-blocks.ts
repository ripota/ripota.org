const timeBlockRanges = [
  {
    value: "00:00-03:00",
    startTime: "04:00",
    endTime: "07:00",
    easternLabel: "00:00 - 03:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "03:00-06:00",
    startTime: "07:00",
    endTime: "10:00",
    easternLabel: "03:00 - 06:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "06:00-09:00",
    startTime: "10:00",
    endTime: "13:00",
    easternLabel: "06:00 - 09:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "09:00-12:00",
    startTime: "13:00",
    endTime: "16:00",
    easternLabel: "09:00 - 12:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "12:00-15:00",
    startTime: "16:00",
    endTime: "19:00",
    easternLabel: "12:00 - 15:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "15:00-18:00",
    startTime: "19:00",
    endTime: "22:00",
    easternLabel: "15:00 - 18:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "18:00-21:00",
    startTime: "22:00",
    endTime: "01:00",
    easternLabel: "18:00 - 21:00 EDT",
    utcDateOffset: 0,
  },
  {
    value: "21:00-24:00",
    startTime: "01:00",
    endTime: "04:00",
    easternLabel: "21:00 - 24:00 EDT",
    utcDateOffset: 1,
  },
] as const;

export const activateRiTimeBlocks = timeBlockRanges.map((block) => ({
  ...block,
  label: block.easternLabel,
}));

export type ActivateRiTimeBlock = (typeof activateRiTimeBlocks)[number]["value"];

export const activateRiTimeBlockValues = activateRiTimeBlocks.map(
  (block) => block.value,
);

export function timeBlockToRange(
  value: string,
): { startTime: string; endTime: string; utcDateOffset: number } | null {
  const block = activateRiTimeBlocks.find((candidate) => candidate.value === value);

  return block
    ? {
        startTime: block.startTime,
        endTime: block.endTime,
        utcDateOffset: block.utcDateOffset,
      }
    : null;
}

export function timeBlockUtcDateOffset(value: string | undefined): number {
  if (!value) {
    return 0;
  }

  return timeBlockToRange(value)?.utcDateOffset ?? 0;
}

export function utcRangeToTimeBlockValue(
  startTime: string,
  endTime: string,
): ActivateRiTimeBlock | "" {
  return (
    activateRiTimeBlocks.find(
      (block) => block.startTime === startTime && block.endTime === endTime,
    )?.value ?? ""
  );
}

export function allowedTimeBlockMessage(label: string): string {
  return `${label} time block must be one of ${activateRiTimeBlockValues.join(", ")} EDT.`;
}
