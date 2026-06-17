export function activityDetailEntries(details: Record<string, unknown>): [string, string][] {
  const entries: [string, string][] = [];
  const previous = isRecord(details.previous) ? details.previous : null;
  const next = isRecord(details.next) ? details.next : null;

  if (previous || next) {
    for (const key of detailKeys(previous, next)) {
      if (previous && next && (!(key in previous) || !(key in next))) {
        continue;
      }

      const previousValue = previous ? detailValue(previous[key]) : "";
      const nextValue = next ? detailValue(next[key]) : "";
      if (!previousValue && !nextValue) {
        continue;
      }
      if (previous && next && previousValue === nextValue) {
        continue;
      }
      entries.push([
        formatDetailLabel(key),
        previous && next ? `${previousValue || "None"} -> ${nextValue || "None"}` : previousValue || nextValue,
      ]);
    }
    return entries;
  }

  for (const [key, value] of Object.entries(details)) {
    if (isBookkeepingKey(key)) {
      continue;
    }
    const formatted = detailValue(value);
    if (formatted) {
      entries.push([formatDetailLabel(key), formatted]);
    }
  }

  return entries;
}

function detailKeys(previous: Record<string, unknown> | null, next: Record<string, unknown> | null): string[] {
  return [...new Set([...Object.keys(previous ?? {}), ...Object.keys(next ?? {})])]
    .filter((key) => !isBookkeepingKey(key));
}

function detailValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(detailValue).filter(Boolean).join(", ");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([key]) => !isBookkeepingKey(key))
      .map(([key, nested]) => {
        const formatted = detailValue(nested);
        return formatted ? `${formatDetailLabel(key)}: ${formatted}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }

  return "";
}

function formatDetailLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isBookkeepingKey(key: string): boolean {
  return /(^id$|Id$|_id$|operation|created|updated|event)/i.test(key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
