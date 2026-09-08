export const OPS_MESSAGE_EDIT_WINDOW_MS = 20 * 60 * 1_000;

export function isOpsMessageWithinEditWindow(
  createdAt: string,
  now = Date.now(),
): boolean {
  const elapsed = now - Date.parse(createdAt);
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed < OPS_MESSAGE_EDIT_WINDOW_MS;
}
