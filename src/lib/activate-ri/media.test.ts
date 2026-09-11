import { describe, expect, it } from "vitest";
import { mediaAccept, mediaContentType, mediaLimits, validateMediaFile } from "./media";

describe("photo and video upload validation", () => {
  it.each([
    ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["png", "image/png"],
    ["gif", "image/gif"], ["webp", "image/webp"], ["heic", "image/heic"],
    ["heif", "image/heif"], ["avif", "image/avif"], ["mp4", "video/mp4"],
    ["mov", "video/quicktime"], ["webm", "video/webm"],
  ])("accepts supported .%s files, including browsers without a MIME type", (extension, type) => {
    const name = `Activation.${extension.toUpperCase()}`;
    expect(validateMediaFile({ name, type, size: 1024 })).toBeNull();
    expect(validateMediaFile({ name, type: "", size: 1024 })).toBeNull();
    expect(validateMediaFile({ name, type: "application/octet-stream", size: 1024 })).toBeNull();
    expect(mediaContentType(name, "")).toBe(type);
    expect(mediaAccept.split(",")).toContain(`.${extension}`);
  });

  it.each([
    ["photo.svg", "image/svg+xml"], ["page.html", "text/html"],
    ["log.adi", "application/octet-stream"], ["audio.mp3", "audio/mpeg"],
    ["photo.jpg", "text/html"], ["photo.png", "image/jpeg"],
    ["program.exe", "image/jpeg"], ["photo", "image/jpeg"],
  ])("rejects unsupported or mismatched %s (%s)", (name, type) => {
    expect(validateMediaFile({ name, type, size: 1024 })).not.toBeNull();
  });

  it.each(["", " ", "../photo.jpg", "folder/photo.jpg", "folder\\photo.jpg", "bad\r\nname.jpg", "nul\0.jpg", `${"x".repeat(180)}.jpg`])(
    "rejects unsafe filename %j", (name) => {
      expect(validateMediaFile({ name, type: "image/jpeg", size: 10 })).not.toBeNull();
    },
  );

  it("accepts ordinary Unicode filenames", () => {
    expect(validateMediaFile({ name: "Rhode Island — café 📷.jpg", type: "image/jpeg", size: 10 })).toBeNull();
  });

  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid byte count %s", (size) => {
    expect(validateMediaFile({ name: "photo.jpg", type: "image/jpeg", size })).not.toBeNull();
  });

  it("enforces separate photo and video size boundaries", () => {
    for (const [name, type, limit] of [
      ["photo.jpg", "image/jpeg", mediaLimits.photoBytes],
      ["video.mp4", "video/mp4", mediaLimits.videoBytes],
    ] as const) {
      expect(validateMediaFile({ name, type, size: limit })).toBeNull();
      expect(validateMediaFile({ name, type, size: limit + 1 })).not.toBeNull();
    }
  });
});
