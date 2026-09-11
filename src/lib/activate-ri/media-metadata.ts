import { mediaMetadataLimits } from "./media";
import { validateMediaParkReference } from "./media-parks";

export type MediaMetadataPatch = {
  parkReference?: string | null;
  title?: string | null;
  description?: string | null;
};

type ParseResult = { patch: MediaMetadataPatch; error: null } | { patch: null; error: string };

export function parseMediaMetadataPatch(value: unknown): ParseResult {
  const invalid = (error: string): ParseResult => ({ patch: null, error });
  if (!isRecord(value)) return invalid("Enter the file details to update.");
  const keys = Object.keys(value);
  if (keys.length === 0 || keys.some((key) => !["parkReference", "title", "description"].includes(key))) {
    return invalid("Only park, title, and description can be updated.");
  }
  const patch: MediaMetadataPatch = {};
  if ("parkReference" in value) {
    if (!validateMediaParkReference(value.parkReference)) return invalid("Choose a Rhode Island park from the list, or General — no park.");
    patch.parkReference = value.parkReference;
  }
  for (const key of ["title", "description"] as const) {
    if (!(key in value)) continue;
    const text = value[key];
    if (text !== null && typeof text !== "string") return invalid(`Enter a ${key}, or leave it blank.`);
    const normalized = text?.replace(/\r\n?/g, "\n").trim() || null;
    const controls = key === "title" ? /[\u0000-\u001f\u007f]/ : /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
    if (normalized !== null && (normalized.length > mediaMetadataLimits[key] || controls.test(normalized))) {
      return invalid(`Use a ${key} of ${mediaMetadataLimits[key]} characters or fewer without unsupported control characters.`);
    }
    patch[key] = normalized;
  }
  return { patch, error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
