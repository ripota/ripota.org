import {
  formatMediaBytes,
  mediaContentType,
  mediaLimits,
  validateMediaFile,
  type ActivatorMedia,
} from "./media";

type QueueState = "ready" | "uploading" | "saved" | "error" | "cancelled" | "invalid";
type QueuedFile = {
  file: File;
  state: QueueState;
  message: string;
  row: HTMLLIElement;
  status: HTMLParagraphElement;
  progress: HTMLProgressElement;
  actions: HTMLDivElement;
};
type MediaUsage = { files: number; bytes: number };

class MediaRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Uploads use XHR so the browser can report progress without buffering a second copy of a video. */
export function setupMediaWorkspace(root: HTMLElement): void {
  const organizer = root.dataset.mediaScope === "admin";
  const endpoint = `/api/activate-ri-2026/${organizer ? "admin" : "activator"}/media`;
  const gallery = root.querySelector<HTMLElement>("[data-media-gallery]")!;
  const galleryStatus = root.querySelector<HTMLElement>("[data-media-status]")!;
  const empty = root.querySelector<HTMLElement>("[data-media-empty]")!;
  const refresh = root.querySelector<HTMLButtonElement>("[data-media-refresh]")!;
  const more = root.querySelector<HTMLButtonElement>("[data-media-more]");
  const usageText = root.querySelector<HTMLElement>("[data-media-usage]");
  const picker = root.querySelector<HTMLInputElement>("[data-media-input]");
  const dropzone = root.querySelector<HTMLElement>("[data-media-dropzone]");
  const queueSection = root.querySelector<HTMLElement>("[data-media-queue-section]");
  const queueList = root.querySelector<HTMLElement>("[data-media-queue]");
  const uploadButton = root.querySelector<HTMLButtonElement>("[data-media-upload]");
  const clearButton = root.querySelector<HTMLButtonElement>("[data-media-clear]");
  const uploadStatus = root.querySelector<HTMLElement>("[data-media-upload-status]");
  const deleteDialog = root.querySelector<HTMLDialogElement>("[data-media-delete-dialog]")!;
  const deleteConfirm = root.querySelector<HTMLButtonElement>("[data-media-delete-confirm]")!;
  const deleteCancel = root.querySelector<HTMLButtonElement>("[data-media-delete-cancel]")!;
  const deleteStatus = root.querySelector<HTMLElement>("[data-media-delete-status]")!;
  let files: ActivatorMedia[] = [];
  let queue: QueuedFile[] = [];
  let usage: MediaUsage = { files: 0, bytes: 0 };
  let nextCursor: string | null = null;
  let loaded = false;
  let loading = false;
  let uploading = false;
  let deleting = false;
  let signedOut = false;
  let activeUpload: XMLHttpRequest | null = null;
  let deleteTarget: ActivatorMedia | null = null;
  let deleteTrigger: HTMLButtonElement | null = null;

  refresh.addEventListener("click", () => void loadFiles());
  more?.addEventListener("click", () => void loadFiles(true));
  picker?.addEventListener("change", () => {
    addFiles([...picker.files ?? []]);
    // File objects are kept in the queue; clearing the picker allows selecting the same file again.
    picker.value = "";
  });
  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.dataset.dragging = "true";
  });
  dropzone?.addEventListener("dragleave", (event) => {
    if (!(event.relatedTarget instanceof Node) || !dropzone.contains(event.relatedTarget)) {
      delete dropzone.dataset.dragging;
    }
  });
  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    delete dropzone.dataset.dragging;
    addFiles([...event.dataTransfer?.files ?? []]);
  });
  uploadButton?.addEventListener("click", () => void uploadQueue());
  clearButton?.addEventListener("click", () => {
    const finished = new Set(["saved", "cancelled", "invalid"]);
    queue.filter((item) => finished.has(item.state)).forEach((item) => item.row.remove());
    queue = queue.filter((item) => !finished.has(item.state));
    updateControls();
  });
  deleteConfirm.addEventListener("click", () => void deleteFile());
  deleteDialog.addEventListener("cancel", (event) => {
    if (deleting) event.preventDefault();
  });
  deleteDialog.addEventListener("close", () => {
    deleteTarget = null;
    if (deleteTrigger?.isConnected) deleteTrigger.focus();
  });
  window.addEventListener("beforeunload", (event) => {
    if (uploading) event.preventDefault();
  });
  window.addEventListener("activate-ri:logout", () => {
    signedOut = true;
    activeUpload?.abort();
    files = [];
    queue = [];
    gallery.replaceChildren();
    queueList?.replaceChildren();
    loaded = false;
    deleteDialog.close();
    galleryStatus.textContent = "You have signed out.";
    updateControls();
  });
  void loadFiles();

  async function loadFiles(append = false): Promise<void> {
    if (loading || signedOut || (append && !nextCursor)) return;
    loading = true;
    updateControls();
    galleryStatus.textContent = "Loading photos and videos…";
    try {
      const url = append ? `${endpoint}?cursor=${encodeURIComponent(nextCursor!)}` : endpoint;
      const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || body.ok !== true || !Array.isArray(body.media) || !body.media.every(isMedia)) {
        throw new Error(responseError(body, response.status, "Unable to load files. Try Refresh files again."));
      }
      if (signedOut) return;
      if (!organizer && (!isRecord(body.usage) || typeof body.usage.files !== "number" || typeof body.usage.bytes !== "number")) {
        throw new Error("Unable to read storage usage. Try Refresh files again.");
      }
      const incoming = body.media as ActivatorMedia[];
      files = append ? [...files, ...incoming.filter((item) => !files.some((saved) => saved.id === item.id))] : incoming;
      nextCursor = typeof body.nextCursor === "string" ? body.nextCursor : null;
      if (!organizer) usage = body.usage as MediaUsage;
      loaded = true;
      renderGallery();
      galleryStatus.textContent = files.length
        ? `${files.length} ${files.length === 1 ? "file" : "files"} ${organizer && nextCursor ? "shown" : "saved"}.`
        : "";
    } catch (error) {
      if (!signedOut) galleryStatus.textContent = errorMessage(error, "Unable to load files. Check your connection and try Refresh files again.");
    } finally {
      loading = false;
      updateControls();
    }
  }

  function addFiles(selected: File[]): void {
    if (signedOut) return;
    let added = 0;
    for (const file of selected) {
      if (queue.some((item) => item.file.name === file.name && item.file.size === file.size && item.file.lastModified === file.lastModified)) continue;
      const error = validateMediaFile(file);
      const row = element("li", "media-queue__item");
      const details = element("div");
      const name = element("strong", "media-queue__name", file.name);
      const size = element("p", "media-queue__detail", formatMediaBytes(file.size));
      const status = element("p", "media-queue__status");
      status.setAttribute("role", "status");
      const progress = element("progress", "media-queue__progress");
      progress.max = 100;
      progress.value = 0;
      progress.setAttribute("aria-label", `Upload progress for ${file.name}`);
      const actions = element("div", "media-queue__actions");
      const item: QueuedFile = { file, state: error ? "invalid" : "ready", message: error ?? "Ready to upload", row, status, progress, actions };
      details.appendChild(name);
      details.appendChild(size);
      details.appendChild(status);
      row.appendChild(details);
      row.appendChild(actions);
      row.appendChild(progress);
      queue.push(item);
      queueList?.appendChild(row);
      renderQueueItem(item);
      added++;
    }
    if (uploadStatus) uploadStatus.textContent = added
      ? `${added} ${added === 1 ? "file added" : "files added"}. Review the selection, then upload when ready.`
      : "These files are already in your selection.";
    updateControls();
  }

  function renderQueueItem(item: QueuedFile): void {
    const restoreFocus = item.actions.contains(document.activeElement);
    item.row.dataset.state = item.state;
    item.status.textContent = item.message;
    item.status.dataset.error = String(item.state === "error" || item.state === "invalid");
    item.progress.hidden = item.state !== "uploading";
    item.actions.replaceChildren();
    if (item.state === "uploading") {
      const cancel = actionButton("Cancel", `Cancel upload of ${item.file.name}`);
      cancel.addEventListener("click", () => activeUpload?.abort());
      item.actions.appendChild(cancel);
    } else {
      if (item.state === "error" || item.state === "cancelled") {
        const retry = actionButton("Retry", `Retry upload of ${item.file.name}`);
        retry.disabled = !loaded || loading || uploading;
        retry.addEventListener("click", () => {
          item.state = "ready";
          item.message = "Ready to retry";
          renderQueueItem(item);
          void uploadQueue([item]);
        });
        item.actions.appendChild(retry);
      }
      const remove = actionButton(item.state === "saved" ? "Dismiss" : "Remove", `Remove ${item.file.name} from selection`);
      remove.addEventListener("click", () => {
        const next = item.row.nextElementSibling ?? item.row.previousElementSibling;
        queue = queue.filter((entry) => entry !== item);
        item.row.remove();
        updateControls();
        const nextAction = next?.querySelector<HTMLButtonElement>("button:not(:disabled)");
        if (nextAction) nextAction.focus();
        else picker?.focus();
      });
      item.actions.appendChild(remove);
    }
    if (restoreFocus) item.actions.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }

  async function uploadQueue(selection = queue): Promise<void> {
    if (uploading || loading || !loaded || signedOut) return;
    // Snapshot the batch so selections added during an upload wait for the next explicit upload.
    const batch = selection.filter((item) => item.state === "ready");
    if (batch.length === 0) return;
    uploading = true;
    updateControls();
    if (uploadStatus) uploadStatus.textContent = "Uploading selected files. Keep this page open.";
    let savedCount = 0;
    let rateLimitMessage: string | null = null;
    for (const item of batch) {
      if (signedOut) break;
      if (!queue.includes(item)) continue;
      const error = validateMediaFile(item.file)
        ?? (usage.files >= mediaLimits.files ? `Your ${mediaLimits.files}-file limit is reached. Delete a saved file, then retry.` : null)
        ?? (usage.bytes + item.file.size > mediaLimits.totalBytes ? `This exceeds your ${formatMediaBytes(mediaLimits.totalBytes)} storage limit. Delete saved files, then retry.` : null);
      if (error) {
        item.state = "error";
        item.message = error;
        renderQueueItem(item);
        continue;
      }
      item.state = "uploading";
      item.message = "Uploading · 0%";
      item.progress.value = 0;
      renderQueueItem(item);
      try {
        const saved = await uploadFile(item);
        if (signedOut) break;
        item.state = "saved";
        item.message = "Saved privately";
        if (!files.some((file) => file.id === saved.id)) {
          files.unshift(saved);
          usage.files++;
          usage.bytes += saved.size;
        }
        savedCount++;
        renderGallery();
      } catch (error) {
        item.state = error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "error";
        item.message = item.state === "cancelled"
          ? "Upload cancelled. Check saved files before retrying."
          : errorMessage(error, "Unable to upload. Check your connection and retry.");
        if (error instanceof MediaRequestError && error.status === 429) {
          rateLimitMessage = item.message;
          break;
        }
      } finally {
        activeUpload = null;
        renderQueueItem(item);
      }
    }
    uploading = false;
    updateControls();
    queue.forEach(renderQueueItem);
    if (!signedOut && uploadStatus) {
      const failed = batch.some((item) => item.state === "error" || item.state === "cancelled");
      const waiting = queue.filter((item) => item.state === "ready").length;
      uploadStatus.textContent = `${savedCount} ${savedCount === 1 ? "file" : "files"} saved.${rateLimitMessage
        ? ` ${rateLimitMessage} ${waiting} selected ${waiting === 1 ? "file remains" : "files remain"} ready to upload. The affected file is kept for retry.`
        : failed ? " Some files did not finish; your selection is kept so you can retry." : ""}`;
    }
    if (!signedOut) await loadFiles();
  }

  function uploadFile(item: QueuedFile): Promise<ActivatorMedia> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUpload = xhr;
      xhr.open("POST", endpoint);
      xhr.setRequestHeader("content-type", mediaContentType(item.file.name, item.file.type));
      xhr.setRequestHeader("x-media-filename", encodeURIComponent(item.file.name));
      xhr.setRequestHeader("accept", "application/json");
      xhr.responseType = "json";
      xhr.timeout = 10 * 60 * 1000;
      xhr.upload.addEventListener("progress", (event) => {
        if (!event.lengthComputable) return;
        const percent = Math.min(100, Math.round(event.loaded / event.total * 100));
        item.progress.value = percent;
        item.status.textContent = percent === 100 ? "Upload sent · Saving…" : `Uploading · ${percent}%`;
      });
      xhr.addEventListener("load", () => {
        const body: unknown = xhr.response;
        if (xhr.status >= 200 && xhr.status < 300 && isRecord(body) && body.ok === true && isMedia(body.media)) resolve(body.media);
        else reject(new MediaRequestError(responseError(body, xhr.status, "Unable to upload this file. Please retry."), xhr.status));
      });
      xhr.addEventListener("error", () => reject(new Error("Connection interrupted. Check saved files before retrying.")));
      xhr.addEventListener("timeout", () => reject(new Error("Upload timed out. Check saved files before retrying.")));
      xhr.addEventListener("abort", () => reject(new DOMException("Upload cancelled", "AbortError")));
      xhr.send(item.file);
    });
  }

  function renderGallery(): void {
    const savedIds = new Set(files.map((file) => file.id));
    for (const card of gallery.querySelectorAll<HTMLElement>("[data-media-id]")) {
      if (!savedIds.has(card.dataset.mediaId!)) card.remove();
    }
    // Keep existing previews mounted so new uploads do not interrupt video playback or keyboard focus.
    files.forEach((file, index) => {
      const current = gallery.children[index] as HTMLElement | undefined;
      if (current?.dataset.mediaId === file.id) return;
      const existing = [...gallery.querySelectorAll<HTMLElement>("[data-media-id]")]
        .find((card) => card.dataset.mediaId === file.id);
      gallery.insertBefore(existing ?? mediaCard(file), current ?? null);
    });
    empty.hidden = !loaded || files.length > 0;
    if (usageText) usageText.textContent = `${usage.files} of ${mediaLimits.files} files · ${formatMediaBytes(usage.bytes)} of ${formatMediaBytes(mediaLimits.totalBytes)} used`;
  }

  function mediaCard(file: ActivatorMedia): HTMLElement {
    const card = element("article", "media-card");
    card.dataset.mediaId = file.id;
    const preview = element("div", "media-card__preview");
    const fileUrl = `${endpoint}/${encodeURIComponent(file.id)}/file`;
    const fallback = element("p", "media-card__fallback", "Preview unavailable on this device. Download the original to view it.");
    if (file.kind === "photo" && !["image/heic", "image/heif"].includes(file.contentType)) {
      const image = element("img");
      image.alt = file.filename;
      image.loading = "lazy";
      image.decoding = "async";
      image.src = fileUrl;
      image.addEventListener("error", () => { image.hidden = true; fallback.hidden = false; });
      fallback.hidden = true;
      preview.appendChild(image);
    } else if (file.kind === "video") {
      const video = element("video");
      video.controls = true;
      video.preload = "none";
      video.playsInline = true;
      video.setAttribute("aria-label", file.filename);
      video.src = fileUrl;
      video.addEventListener("error", () => { video.hidden = true; fallback.hidden = false; });
      fallback.hidden = true;
      preview.appendChild(video);
    }
    preview.appendChild(fallback);
    const body = element("div", "media-card__body");
    if (organizer) body.appendChild(element("p", "media-card__byline", file.callsign));
    body.appendChild(element("h3", "", file.filename));
    const date = new Date(file.createdAt);
    body.appendChild(element("p", "media-card__meta", `${file.kind === "photo" ? "Photo" : "Video"} · ${formatMediaBytes(file.size)} · ${Number.isFinite(date.valueOf()) ? date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "Uploaded"}`));
    const actions = element("div", "media-card__actions");
    const download = element("a", "", "Download original");
    download.href = `${fileUrl}?download=1`;
    download.download = file.filename;
    download.setAttribute("aria-label", `Download original ${file.filename}`);
    const remove = actionButton("Delete", `Delete ${file.filename}`);
    remove.addEventListener("click", () => {
      deleteTarget = file;
      deleteTrigger = remove;
      deleteStatus.textContent = "";
      root.querySelector<HTMLElement>("[data-media-delete-description]")!.textContent = organizer
        ? `${file.filename} · ${file.callsign}` : file.filename;
      deleteDialog.showModal();
      deleteCancel.focus();
    });
    actions.appendChild(download);
    actions.appendChild(remove);
    body.appendChild(actions);
    if (file.kind === "video") body.appendChild(element("p", "media-card__playback-help", "If this video will not play, download the original to open it on your device."));
    card.appendChild(preview);
    card.appendChild(body);
    return card;
  }

  async function deleteFile(): Promise<void> {
    if (!deleteTarget || deleting || signedOut) return;
    const target = deleteTarget;
    deleting = true;
    deleteConfirm.disabled = true;
    deleteCancel.disabled = true;
    deleteStatus.textContent = "Deleting file…";
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(target.id)}`, { method: "DELETE", headers: { accept: "application/json" } });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new Error(responseError(body, response.status, "Unable to delete this file. Please try again."));
      }
      if (signedOut) return;
      files = files.filter((file) => file.id !== target.id);
      if (!organizer) {
        usage.files = Math.max(0, usage.files - 1);
        usage.bytes = Math.max(0, usage.bytes - target.size);
      }
      renderGallery();
      deleteDialog.close();
      refresh.focus();
      galleryStatus.textContent = `${target.filename} deleted.`;
    } catch (error) {
      if (!signedOut) deleteStatus.textContent = errorMessage(error, "Unable to delete the file. Check your connection and try again.");
    } finally {
      deleting = false;
      deleteConfirm.disabled = false;
      deleteCancel.disabled = false;
    }
  }

  function updateControls(): void {
    refresh.disabled = loading || uploading || signedOut;
    if (more) { more.hidden = !nextCursor; more.disabled = loading || signedOut; }
    if (queueSection) queueSection.hidden = queue.length === 0;
    const ready = queue.filter((item) => item.state === "ready").length;
    if (uploadButton) {
      uploadButton.disabled = uploading || loading || !loaded || ready === 0 || signedOut;
      uploadButton.textContent = uploading ? "Uploading…" : ready ? `Upload ${ready} ${ready === 1 ? "file" : "files"}` : "Upload selected files";
    }
    if (clearButton) clearButton.disabled = !queue.some((item) => ["saved", "invalid", "cancelled"].includes(item.state));
    for (const item of queue) {
      const retry = item.actions.querySelector<HTMLButtonElement>('button[aria-label^="Retry upload"]');
      if (retry) retry.disabled = !loaded || loading || uploading || signedOut;
    }
  }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function actionButton(label: string, accessibleLabel: string): HTMLButtonElement {
  const button = element("button", "button", label);
  button.type = "button";
  button.dataset.variant = "light";
  button.setAttribute("aria-label", accessibleLabel);
  return button;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMedia(value: unknown): value is ActivatorMedia {
  return isRecord(value) && typeof value.id === "string" && typeof value.filename === "string"
    && typeof value.contentType === "string" && (value.kind === "photo" || value.kind === "video")
    && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    && typeof value.createdAt === "string" && typeof value.callsign === "string" && typeof value.url === "string";
}

function responseError(body: unknown, status: number, fallback: string): string {
  if (status === 401) return "Your access has expired. Sign in again, then return to your photos and videos.";
  return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) ? error.message : fallback;
}
