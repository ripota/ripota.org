const timeBlockRanges = [
  { startTime: "00:00", endTime: "03:00" },
  { startTime: "03:00", endTime: "06:00" },
  { startTime: "06:00", endTime: "09:00" },
  { startTime: "09:00", endTime: "12:00" },
  { startTime: "12:00", endTime: "15:00" },
  { startTime: "15:00", endTime: "18:00" },
  { startTime: "18:00", endTime: "21:00" },
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
