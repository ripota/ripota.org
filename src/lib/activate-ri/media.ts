export const mediaLimits = {
  photoBytes: 20 * 1024 * 1024,
  videoBytes: 80 * 1024 * 1024,
  totalBytes: 500 * 1024 * 1024,
  files: 50,
} as const;

const mediaTypes: Record<string, { type: string; kind: "photo" | "video" }> = {
  jpg: { type: "image/jpeg", kind: "photo" },
  jpeg: { type: "image/jpeg", kind: "photo" },
  png: { type: "image/png", kind: "photo" },
  gif: { type: "image/gif", kind: "photo" },
  webp: { type: "image/webp", kind: "photo" },
  heic: { type: "image/heic", kind: "photo" },
  heif: { type: "image/heif", kind: "photo" },
  avif: { type: "image/avif", kind: "photo" },
  mp4: { type: "video/mp4", kind: "video" },
  mov: { type: "video/quicktime", kind: "video" },
  webm: { type: "video/webm", kind: "video" },
};

export const mediaAccept = [
  ...Object.keys(mediaTypes).map((extension) => `.${extension}`),
  ...new Set(Object.values(mediaTypes).map(({ type }) => type)),
].join(",");

export type ActivatorMedia = {
  id: string;
  filename: string;
  contentType: string;
  kind: "photo" | "video";
  size: number;
  createdAt: string;
  callsign: string;
  parkReference: string | null;
  url: string;
};

export function mediaContentType(filename: string, type: string): string {
  const declared = type.toLowerCase().trim();
  const extension = filename.split(".").at(-1)?.toLowerCase() ?? "";
  return !declared || declared === "application/octet-stream"
    ? mediaTypes[extension]?.type ?? ""
    : declared;
}

export function validateMediaFile(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.trim() || file.name.length > 180 || /[\u0000-\u001f\u007f/\\]/.test(file.name)) {
    return "Use a filename of 180 characters or fewer without slashes or control characters.";
  }
  const extension = file.name.split(".").at(-1)?.toLowerCase() ?? "";
  const format = mediaTypes[extension];
  const type = mediaContentType(file.name, file.type);
  if (!format || format.type !== type) {
    return "Choose a JPEG, PNG, GIF, WebP, HEIC, HEIF, or AVIF photo, or an MP4, MOV, or WebM video.";
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "Choose a file that is not empty.";
  const max = format.kind === "photo" ? mediaLimits.photoBytes : mediaLimits.videoBytes;
  return file.size > max ? `${format.kind === "photo" ? "Photos" : "Videos"} must be ${formatMediaBytes(max)} or smaller.` : null;
}

export function formatMediaBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Number((bytes / (1024 * 1024)).toFixed(1))} MB`;
}
