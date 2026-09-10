/** Best-effort, content-free exposure telemetry. Never treats exposure as acknowledgment. */
export function startOpsEngagement(
  room: HTMLElement,
  enabled: () => boolean,
  entrySource: "direct" | "message_link",
): () => void {
  let day = "";
  const reported = new Set<string>();
  const pending = new Set<string>();
  let visibleSince = new Map<string, number>();
  let foregroundSince: number | null = null;
  let lastAttempt = 0;
  let inFlight = false;
  let retryAfter = 0;
  let stopped = false;

  const foreground = (): boolean => !stopped && enabled() && !document.hidden &&
    !room.querySelector("dialog[open]");
  const resetDwell = (): void => { visibleSince.clear(); foregroundSince = null; };
  document.addEventListener("visibilitychange", resetDwell);
  const dialogs = new MutationObserver(() => {
    if (room.querySelector("dialog[open]")) resetDwell();
  });
  dialogs.observe(room, { attributes: true, subtree: true, attributeFilter: ["open"] });

  async function flush(now: number): Promise<void> {
    if (inFlight || now < retryAfter || !foreground()) return;
    inFlight = true;
    lastAttempt = now;
    const messageIds = [...pending].slice(0, 50);
    const requestDay = day;
    try {
      const response = await fetch("/api/activate-ri-2026/ops/engagement", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messageIds, entrySource }),
      });
      if (!response.ok) throw new Error("Engagement unavailable");
      if (requestDay === day) messageIds.forEach((id) => { pending.delete(id); reported.add(id); });
      retryAfter = 0;
    } catch {
      // Keep a bounded in-memory queue; only retry while the room is foreground.
      retryAfter = Date.now() + 30_000;
    } finally {
      inFlight = false;
    }
  }

  const timer = window.setInterval(() => {
    if (!foreground()) { resetDwell(); return; }
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (day !== today) { day = today; reported.clear(); pending.clear(); }
    foregroundSince ??= now;
    const visible = new Map<string, number>();
    const feed = room.querySelector<HTMLElement>("[data-ops-feed]");
    for (const element of room.querySelectorAll<HTMLElement>("[data-message-id], [data-ops-exposure-message-id]")) {
      const id = element.dataset.messageId ?? element.dataset.opsExposureMessageId;
      if (!id || !/^[a-f0-9-]{36}$/i.test(id) || element.hidden) continue;
      const box = element.getBoundingClientRect();
      const container = feed?.contains(element) ? feed.getBoundingClientRect() : null;
      const top = Math.max(0, box.top, container?.top ?? 0);
      const bottom = Math.min(innerHeight, box.bottom, container?.bottom ?? innerHeight);
      const readableHeight = Math.min(box.height, innerHeight, container?.height ?? innerHeight);
      if (readableHeight <= 0 || box.width <= 0 || box.right <= 0 || box.left >= innerWidth || bottom - top < readableHeight * 0.6) continue;
      const since = visibleSince.get(id) ?? now;
      visible.set(id, since);
      if (now - since >= 1000 && !reported.has(id) && pending.size < 100) pending.add(id);
    }
    visibleSince = visible;
    if (now - foregroundSince >= 1000 && (pending.size > 0 || now - lastAttempt >= 30_000)) void flush(now);
  }, 1000);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", resetDwell);
    dialogs.disconnect();
    pending.clear();
  };
}
