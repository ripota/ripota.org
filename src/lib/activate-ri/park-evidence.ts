import type { PublicParkPotaStatus } from "./pota-status-client";

/** Text evidence shared by the park list, separate from organizer activation plans. */
export function createParkEvidence(park: PublicParkPotaStatus): HTMLElement {
  const container = document.createElement("div");
  container.className = "park-evidence";
  container.dataset.status = park.status;

  const badge = document.createElement("span");
  badge.className = "pota-status-badge";
  badge.dataset.status = park.status;
  badge.textContent = statusLabel(park);
  container.appendChild(badge);

  if (park.live) {
    container.appendChild(paragraph(
      "On air now — a current spot is activity evidence, not confirmation.",
      "park-evidence__live",
    ));
  }
  if (park.confirmation) {
    container.appendChild(paragraph(
      `${park.confirmation.activeCallsign} · ${formatQsoDate(park.confirmation.qsoDate)} UTC · ${park.confirmation.totalQsos} QSOs`,
    ));
  } else if (park.lastObservation) {
    const evidence = park.lastObservation.evidenceKind === "declared_nfer"
      ? `Declared N-fer via ${park.lastObservation.declaredByReference ?? "another park"}`
      : "Last spotted";
    container.appendChild(paragraph(
      `${evidence} ${formatUtcTimestamp(park.lastObservation.lastObservedAt)} · ${park.lastObservation.activeCallsign}`,
    ));
  } else if (park.attempts[0]) {
    container.appendChild(paragraph(
      `Attempt recorded: ${park.attempts[0].activeCallsign} · ${park.attempts[0].totalQsos} QSOs; not confirmed.`,
    ));
  } else {
    container.appendChild(paragraph(park.scheduled
      ? "Scheduled event coverage; no POTA confirmation yet."
      : "No event POTA evidence yet."));
  }

  const allEvidence = [...park.confirmations, ...park.attempts];
  if (allEvidence.length > 1) {
    const details = document.createElement("details");
    details.dataset.liveKey = `${park.reference}-evidence`;
    const summary = document.createElement("summary");
    summary.dataset.liveKey = `${park.reference}-evidence-summary`;
    summary.textContent = `All POTA event activation rows (${allEvidence.length})`;
    details.appendChild(summary);
    const list = document.createElement("ul");
    for (const evidence of allEvidence) {
      const item = document.createElement("li");
      item.textContent = `${evidence.activeCallsign} · ${formatQsoDate(evidence.qsoDate)} UTC · ${evidence.totalQsos} QSOs${evidence.totalQsos >= 10 ? " · confirmed" : " · attempt"}`;
      list.appendChild(item);
    }
    details.appendChild(list);
    container.appendChild(details);
  }

  return container;
}

function paragraph(value: string, className = ""): HTMLParagraphElement {
  const element = document.createElement("p");
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

function statusLabel(park: PublicParkPotaStatus): string {
  if (park.status === "confirmed") return "POTA confirmed";
  if (park.observed) return "Spotted";
  if (park.attemptRecorded) return "Attempt recorded";
  return park.status === "scheduled" ? "Scheduled" : "Still needed";
}

function formatQsoDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6)}` : value;
}

function formatUtcTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.valueOf())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date)
    : value;
}
