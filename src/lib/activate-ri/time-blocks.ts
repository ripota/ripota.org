const timeBlockRanges = [
  { startTime: "04:00", endTime: "07:00", easternLabel: "00:00 - 03:00 EDT" },
  { startTime: "07:00", endTime: "10:00", easternLabel: "03:00 - 06:00 EDT" },
  { startTime: "10:00", endTime: "13:00", easternLabel: "06:00 - 09:00 EDT" },
  { startTime: "13:00", endTime: "16:00", easternLabel: "09:00 - 12:00 EDT" },
  { startTime: "16:00", endTime: "19:00", easternLabel: "12:00 - 15:00 EDT" },
  { startTime: "19:00", endTime: "22:00", easternLabel: "15:00 - 18:00 EDT" },
  { startTime: "22:00", endTime: "01:00", easternLabel: "18:00 - 21:00 EDT" },
] as const;

export const activateRiTimeBlocks = timeBlockRanges.map((block) => ({
  ...block,
  value: `${block.startTime}-${block.endTime}`,
  label: `${block.startTime} - ${block.endTime}`,
}));

export type ActivateRiTimeBlock = (typeof activateRiTimeBlocks)[number]["value"];

export const activateRiTimeBlockValues = activateRiTimeBlocks.map(
  (block) => block.value,
);

export function timeBlockToRange(
  value: string,
): { startTime: string; endTime: string } | null {
  const block = activateRiTimeBlocks.find((candidate) => candidate.value === value);

  return block ? { startTime: block.startTime, endTime: block.endTime } : null;
}

export function allowedTimeBlockMessage(label: string): string {
  return `${label} time block must be one of ${activateRiTimeBlockValues.join(", ")}.`;
}
