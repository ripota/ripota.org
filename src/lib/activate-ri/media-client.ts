import {
  formatMediaBytes,
  mediaContentType,
  mediaMetadataLimits,
  validateMediaFile,
  type ActivatorMedia,
} from "./media";
import { mediaParkName, mediaParks, validateMediaParkReference } from "./media-parks";
import { setupMediaDialogs } from "./media-dialogs";

type QueueState = "ready" | "uploading" | "saved" | "error" | "cancelled" | "invalid";
type QueuedFile = {
  file: File;
  state: QueueState;
  message: string;
  parkReference: string | null;
  savedId: string | null;
  row: HTMLLIElement;
  status: HTMLParagraphElement;
  progress: HTMLProgressElement;
  actions: HTMLDivElement;
  parkSelect: HTMLSelectElement;
};

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
  const openUpload = root.querySelector<HTMLButtonElement>("[data-media-open-upload]");
  const uploadDialog = root.querySelector<HTMLDialogElement>("[data-media-upload-dialog]");
  const uploadClose = root.querySelector<HTMLButtonElement>("[data-media-upload-close]");
  const picker = root.querySelector<HTMLInputElement>("[data-media-input]");
  const defaultPark = root.querySelector("[data-media-default-park]") as HTMLSelectElement | null;
  const dropzone = root.querySelector<HTMLElement>("[data-media-dropzone]");
  const queueSection = root.querySelector<HTMLElement>("[data-media-queue-section]");
  const queueList = root.querySelector<HTMLElement>("[data-media-queue]");
  const uploadButton = root.querySelector<HTMLButtonElement>("[data-media-upload]");
  const clearButton = root.querySelector<HTMLButtonElement>("[data-media-clear]");
  const uploadStatus = root.querySelector<HTMLElement>("[data-media-upload-status]");
  const scopeButtons = [...root.querySelectorAll<HTMLButtonElement>("[data-media-view]")];
  const deleteDialog = root.querySelector<HTMLDialogElement>("[data-media-delete-dialog]")!;
  const deleteConfirm = root.querySelector<HTMLButtonElement>("[data-media-delete-confirm]")!;
  const deleteCancel = root.querySelector<HTMLButtonElement>("[data-media-delete-cancel]")!;
  const deleteStatus = root.querySelector<HTMLElement>("[data-media-delete-status]")!;
  const detailsDialog = root.querySelector<HTMLDialogElement>("[data-media-details-dialog]")!;
  const detailsForm = root.querySelector<HTMLFormElement>("[data-media-details-form]")!;
  const editPark = (root.querySelector("[data-media-edit-park]") as HTMLSelectElement | null)!;
  const detailsSave = root.querySelector<HTMLButtonElement>("[data-media-details-save]")!;
  const detailsCancel = root.querySelector<HTMLButtonElement>("[data-media-details-cancel]")!;
  const detailsStatus = root.querySelector<HTMLElement>("[data-media-details-status]")!;
  const editTitle = root.querySelector<HTMLInputElement>("[data-media-edit-title]")!;
  const editDescription = root.querySelector<HTMLTextAreaElement>("[data-media-edit-description]")!;
  const detailsPreview = root.querySelector<HTMLElement>("[data-media-details-preview]")!;
  const detailDelete = root.querySelector<HTMLButtonElement>("[data-media-detail-delete]")!;
  const detailDownload = root.querySelector<HTMLAnchorElement>("[data-media-download]")!;
  const modals = setupMediaDialogs([detailsDialog, deleteDialog, ...(uploadDialog ? [uploadDialog] : [])]);
  let files: ActivatorMedia[] = [];
  let queue: QueuedFile[] = [];
  let nextCursor: string | null = null;
  let loaded = false;
  let loading = false;
  let uploading = false;
  let deleting = false;
  let savingDetails = false;
  let signedOut = false;
  let activeUpload: XMLHttpRequest | null = null;
  let deleteTarget: ActivatorMedia | null = null;
  let detailsTargetId: string | null = null;
  let detailsOriginal: ActivatorMedia | null = null;
  let mediaView: "all" | "mine" = "all";
  let listGeneration = 0;
  let listRequest: AbortController | null = null;
  let deferredRefresh = false;

  if (!organizer) {
    mediaView = readMediaView();
    for (const button of scopeButtons) button.addEventListener("click", () => {
      const next = button.dataset.mediaView === "mine" ? "mine" : "all";
      if (next === mediaView) return;
      const url = new URL(location.href);
      if (next === "mine") url.searchParams.set("mediaScope", "mine");
      else url.searchParams.delete("mediaScope");
      history.pushState(null, "", url);
      changeMediaView(next);
    });
    window.addEventListener("popstate", () => changeMediaView(readMediaView()));
  }
  updateControls();

  refresh.addEventListener("click", () => void loadFiles());
  openUpload?.addEventListener("click", () => {
    if (uploadDialog && !signedOut) modals.open(uploadDialog, openUpload, uploadClose);
  });
  uploadClose?.addEventListener("click", () => { if (!uploading) uploadDialog?.close(); });
  uploadDialog?.addEventListener("cancel", (event) => {
    if (!uploading) return;
    event.preventDefault();
    if (uploadStatus) uploadStatus.textContent = "Uploads are still running. Cancel an individual upload or wait for them to finish.";
  });
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
  detailDelete.addEventListener("click", () => {
    const file = files.find((item) => item.id === detailsTargetId);
    if (!file?.canEdit || signedOut) return;
    deleteTarget = file;
    deleteStatus.textContent = "";
    root.querySelector<HTMLElement>("[data-media-delete-description]")!.textContent = mediaLabel(file);
    modals.open(deleteDialog, detailDelete, deleteCancel);
  });
  deleteDialog.addEventListener("cancel", (event) => {
    if (deleting) event.preventDefault();
  });
  deleteDialog.addEventListener("close", () => {
    if (deleteDialog.open) return;
    deleteTarget = null;
  });
  detailsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDetails();
  });
  detailsCancel.addEventListener("click", () => { if (!savingDetails && !deleting) detailsDialog.close(); });
  detailsDialog.addEventListener("cancel", (event) => {
    if (savingDetails || deleting) event.preventDefault();
  });
  detailsDialog.addEventListener("close", () => {
    if (detailsDialog.open) return;
    detailsTargetId = null;
    detailsOriginal = null;
    detailsPreview.querySelector<HTMLVideoElement>("video")?.pause();
    detailsPreview.replaceChildren();
  });
  window.addEventListener("beforeunload", (event) => {
    if (uploading) event.preventDefault();
  });
  window.addEventListener("activate-ri:logout", () => {
    signedOut = true;
    listGeneration++;
    listRequest?.abort();
    activeUpload?.abort();
    files = [];
    queue = [];
    gallery.replaceChildren();
    queueList?.replaceChildren();
    loaded = false;
    deleteDialog.close();
    detailsDialog.close();
    uploadDialog?.close();
    galleryStatus.textContent = "You have signed out.";
    updateControls();
  });
  void loadFiles();

  function readMediaView(): "all" | "mine" {
    const url = new URL(location.href);
    if (url.searchParams.get("mediaScope") === "mine") return "mine";
    if (url.searchParams.has("mediaScope")) {
      url.searchParams.delete("mediaScope");
      history.replaceState(null, "", url);
    }
    return "all";
  }

  function changeMediaView(next: "all" | "mine"): void {
    if (next === mediaView) return;
    if (!savingDetails) detailsDialog.close();
    if (!deleting) deleteDialog.close();
    mediaView = next;
    listGeneration++;
    listRequest?.abort();
    loading = false;
    loaded = false;
    files = [];
    nextCursor = null;
    gallery.replaceChildren();
    empty.hidden = true;
    updateControls();
    void loadFiles();
  }

  async function loadFiles(append = false): Promise<void> {
    if (signedOut || (append && (loading || !nextCursor))) return;
    if (savingDetails || deleting || uploading) {
      deferredRefresh = true;
      if (uploading) galleryStatus.textContent = "The gallery will refresh when uploads finish.";
      return;
    }
    deferredRefresh = false;
    const generation = ++listGeneration;
    const requestView = mediaView;
    listRequest?.abort();
    const controller = new AbortController();
    listRequest = controller;
    loading = true;
    updateControls();
    galleryStatus.textContent = "Loading photos and videos…";
    try {
      const params = new URLSearchParams();
      if (!organizer && requestView === "mine") params.set("scope", "mine");
      if (append) params.set("cursor", nextCursor!);
      const url = `${endpoint}${params.size ? `?${params}` : ""}`;
      const response = await fetch(url, { headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal });
      const body: unknown = await response.json().catch(() => null);
      if (generation !== listGeneration || signedOut) return;
      if (!response.ok || !isRecord(body) || body.ok !== true || !Array.isArray(body.media) || !body.media.every(isMedia)) {
        throw new Error(responseError(body, response.status, "Unable to load files. Try Refresh files again."));
      }
      if (signedOut) return;
      const incoming = body.media as ActivatorMedia[];
      files = append ? [...files, ...incoming.filter((item) => !files.some((saved) => saved.id === item.id))] : incoming;
      nextCursor = typeof body.nextCursor === "string" ? body.nextCursor : null;
      loaded = true;
      renderGallery();
      galleryStatus.textContent = "";
    } catch (error) {
      if (generation === listGeneration && !signedOut) galleryStatus.textContent = errorMessage(error, "Unable to load files. Check your connection and try Refresh files again.");
    } finally {
      if (generation === listGeneration) { loading = false; updateControls(); }
    }
  }

  function addFiles(selected: File[]): void {
    if (signedOut) return;
    let added = 0;
    for (const file of selected) {
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
      const parkField = element("label", "media-queue__park");
      parkField.appendChild(element("span", "", "Park"));
      const parkSelect = element("select", "media-park-select");
      parkSelect.dataset.mediaQueuePark = "";
      parkSelect.setAttribute("aria-label", `Park for ${file.name}`);
      parkSelect.appendChild(parkOption("", mediaParkName(null)));
      mediaParks.forEach((park) => parkSelect.appendChild(parkOption(park.reference, `${park.reference} — ${park.name}`)));
      const parkReference = defaultPark?.value || null;
      parkSelect.value = parkReference ?? "";
      const item: QueuedFile = {
        file, state: error ? "invalid" : "ready", message: error ?? "Ready to upload",
        parkReference, savedId: null, row, status, progress, actions, parkSelect,
      };
      parkSelect.addEventListener("change", () => { item.parkReference = parkSelect.value || null; });
      parkField.appendChild(parkSelect);
      details.appendChild(name);
      details.appendChild(size);
      details.appendChild(parkField);
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
      : "Choose photos or videos to add to your selection.";
    updateControls();
  }

  function renderQueueItem(item: QueuedFile): void {
    const restoreFocus = item.actions.contains(document.activeElement);
    item.row.dataset.state = item.state;
    item.status.textContent = item.message;
    item.status.dataset.error = String(item.state === "error" || item.state === "invalid");
    item.progress.hidden = item.state !== "uploading";
    item.parkSelect.value = item.parkReference ?? "";
    item.parkSelect.disabled = item.state === "uploading" || item.state === "saved" || item.state === "invalid";
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
        ?? (!validateMediaParkReference(item.parkReference) ? "Choose a Rhode Island park from the list, or leave this file general." : null);
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
        item.message = "Uploaded and shared";
        item.savedId = saved.id;
        item.parkReference = saved.parkReference;
        if (!files.some((file) => file.id === saved.id)) {
          files.unshift(saved);
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
    if (!signedOut) {
      await loadFiles();
      if (batch.every((item) => item.state === "saved") && queue.every((item) => item.state === "saved")) {
        queue = [];
        queueList?.replaceChildren();
        if (uploadStatus) uploadStatus.textContent = "";
        updateControls();
        uploadDialog?.close();
      }
    }
  }

  function uploadFile(item: QueuedFile): Promise<ActivatorMedia> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeUpload = xhr;
      xhr.open("POST", endpoint);
      xhr.setRequestHeader("content-type", mediaContentType(item.file.name, item.file.type));
      xhr.setRequestHeader("x-media-filename", encodeURIComponent(item.file.name));
      if (item.parkReference) xhr.setRequestHeader("x-media-park-reference", item.parkReference);
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
    for (const tile of gallery.querySelectorAll<HTMLElement>("[data-media-id]")) {
      if (!savedIds.has(tile.dataset.mediaId!)) tile.remove();
    }
    files.forEach((file, index) => {
      const current = gallery.children[index] as HTMLElement | undefined;
      const tile = current?.dataset.mediaId === file.id ? current
        : [...gallery.querySelectorAll<HTMLElement>("[data-media-id]")].find((node) => node.dataset.mediaId === file.id) ?? mediaTile(file);
      if (tile !== current) gallery.insertBefore(tile, current ?? null);
      const button = tile.querySelector<HTMLButtonElement>("[data-media-open-detail]")!;
      button.setAttribute("aria-label", `View ${mediaLabel(file)}`);
      const title = tile.querySelector<HTMLElement>("[data-media-title]")!;
      title.textContent = file.title ?? "";
      title.hidden = !file.title;
      tile.querySelector<HTMLElement>("[data-media-author]")!.textContent = file.authorLabel;
      const badge = tile.querySelector<HTMLElement>("[data-media-park-badge]")!;
      const tooltip = tile.querySelector<HTMLElement>("[data-media-park-tooltip]")!;
      badge.textContent = file.parkReference ?? "";
      badge.hidden = !file.parkReference;
      tooltip.textContent = parkLabel(file.parkReference);
      tooltip.hidden = !file.parkReference;
      if (file.parkReference) button.setAttribute("aria-describedby", tooltip.id);
      else button.removeAttribute("aria-describedby");
    });
    empty.hidden = !loaded || files.length > 0;
    root.querySelector<HTMLElement>("[data-media-empty-title]")!.textContent = mediaView === "mine" ? "Your activation belongs here" : "No shared uploads yet";
    root.querySelector<HTMLElement>("[data-media-empty-help]")!.textContent = organizer
      ? "Photos and videos will appear as activators upload them."
      : "Use Upload photos & videos to share a moment from your activation.";
  }

  function mediaTile(file: ActivatorMedia): HTMLElement {
    const tile = element("article", "media-tile");
    tile.dataset.mediaId = file.id;
    const button = element("button", "media-tile__button");
    button.type = "button";
    button.dataset.mediaOpenDetail = "";
    button.setAttribute("aria-label", `View ${mediaLabel(file)}`);
    renderPreview(file, button, false);
    if (file.kind === "video") button.appendChild(element("span", "media-tile__type", "▶ Video"));
    const badge = element("span", "media-tile__park", file.parkReference ?? "");
    badge.dataset.mediaParkBadge = "";
    badge.hidden = !file.parkReference;
    const tooltip = element("span", "media-tile__tooltip", parkLabel(file.parkReference));
    tooltip.dataset.mediaParkTooltip = "";
    tooltip.id = `media-park-${organizer ? "admin" : "activator"}-${file.id}`;
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = !file.parkReference;
    button.appendChild(badge);
    button.appendChild(tooltip);
    button.addEventListener("click", () => {
      const current = files.find((item) => item.id === file.id);
      if (current && !signedOut) openDetails(current, button);
    });
    const caption = element("div", "media-tile__caption");
    const title = element("h3", "", file.title ?? "");
    title.dataset.mediaTitle = "";
    title.hidden = !file.title;
    const author = element("p", "media-tile__author", file.authorLabel);
    author.dataset.mediaAuthor = "";
    caption.appendChild(title);
    caption.appendChild(author);
    tile.appendChild(button);
    tile.appendChild(caption);
    return tile;
  }

  function renderPreview(file: ActivatorMedia, container: HTMLElement, detail: boolean): void {
    container.replaceChildren();
    const fallback = element("span", detail ? "media-detail__fallback" : "media-tile__fallback", detail
      ? "This device cannot preview this original. Download it to view in another app."
      : `${file.kind === "photo" ? "Photo" : "Video"} · Open to view`);
    fallback.hidden = true;
    const source = `${endpoint}/${encodeURIComponent(file.id)}/file`;
    if (file.kind === "photo") {
      // Let browsers with native HEIC/HEIF support preview originals too.
      const image = element("img");
      image.alt = detail ? mediaLabel(file) : "";
      image.loading = detail ? "eager" : "lazy";
      image.decoding = "async";
      image.src = source;
      image.addEventListener("error", () => { image.hidden = true; fallback.hidden = false; });
      container.appendChild(image);
    } else {
      const video = element("video");
      video.controls = detail;
      video.preload = "metadata";
      video.playsInline = true;
      video.muted = !detail;
      if (detail) video.setAttribute("aria-label", mediaLabel(file));
      else { video.tabIndex = -1; video.setAttribute("aria-hidden", "true"); }
      video.src = source;
      video.addEventListener("error", () => { video.hidden = true; fallback.hidden = false; });
      container.appendChild(video);
    }
    container.appendChild(fallback);
  }

  function openDetails(file: ActivatorMedia, trigger: HTMLButtonElement): void {
    detailsTargetId = file.id;
    detailsOriginal = file.canEdit ? { ...file } : null;
    detailsDialog.dataset.mediaId = file.id;
    detailsStatus.textContent = "";
    root.querySelector<HTMLElement>("[data-media-details-author]")!.textContent = file.authorLabel;
    root.querySelector<HTMLElement>("[data-media-details-heading]")!.textContent = file.title || (file.kind === "photo" ? "Photo" : "Video");
    root.querySelector<HTMLElement>("[data-media-details-park]")!.textContent = parkLabel(file.parkReference);
    const uploaded = new Date(file.createdAt);
    root.querySelector<HTMLElement>("[data-media-details-meta]")!.textContent = `${file.kind === "photo" ? "Photo" : "Video"} · ${formatMediaBytes(file.size)} · Uploaded ${Number.isFinite(uploaded.valueOf()) ? uploaded.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "date unavailable"}`;
    root.querySelector<HTMLElement>("[data-media-details-description]")!.textContent = file.description ?? "";
    root.querySelector<HTMLElement>("[data-media-details-readonly]")!.hidden = file.canEdit || !file.description;
    detailsForm.hidden = !file.canEdit;
    detailDelete.hidden = !file.canEdit;
    editPark.value = file.parkReference ?? "";
    editTitle.value = file.title ?? "";
    editDescription.value = file.description ?? "";
    detailDownload.href = `${endpoint}/${encodeURIComponent(file.id)}/file?download=1`;
    detailDownload.download = file.filename;
    renderPreview(file, detailsPreview, true);
    modals.open(detailsDialog, trigger, detailsCancel);
  }

  async function deleteFile(): Promise<void> {
    if (!deleteTarget?.canEdit || deleting || signedOut) return;
    const target = deleteTarget;
    deleting = true;
    listGeneration++;
    listRequest?.abort();
    loading = false;
    updateControls();
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
      renderGallery();
      deleteDialog.close();
      detailsDialog.close();
      refresh.focus({ preventScroll: true });
      galleryStatus.textContent = "Media deleted.";
    } catch (error) {
      if (!signedOut) deleteStatus.textContent = errorMessage(error, "Unable to delete the file. Check your connection and try again.");
    } finally {
      deleting = false;
      deleteConfirm.disabled = false;
      deleteCancel.disabled = false;
      updateControls();
      if (deferredRefresh) { deferredRefresh = false; void loadFiles(); }
    }
  }

  async function saveDetails(): Promise<void> {
    if (!detailsTargetId || !detailsOriginal || savingDetails || loading || signedOut) return;
    const targetId = detailsTargetId;
    const target = files.find((file) => file.id === targetId);
    if (!target?.canEdit) return;
    const original = detailsOriginal;
    const parkReference = editPark.value || null;
    if (!validateMediaParkReference(parkReference)) {
      detailsStatus.textContent = "Choose a Rhode Island park from the list, or leave this file general.";
      editPark.focus();
      return;
    }
    const title = editTitle.value.trim() || null;
    const description = editDescription.value.trim() || null;
    if ((title?.length ?? 0) > mediaMetadataLimits.title || (description?.length ?? 0) > mediaMetadataLimits.description) {
      detailsStatus.textContent = `Keep titles within ${mediaMetadataLimits.title} characters and descriptions within ${mediaMetadataLimits.description}.`;
      return;
    }
    const changes: { parkReference?: string | null; title?: string | null; description?: string | null } = {};
    if (parkReference !== original.parkReference) changes.parkReference = parkReference;
    if (title !== original.title) changes.title = title;
    if (description !== original.description) changes.description = description;
    if (Object.keys(changes).length === 0) {
      detailsDialog.close();
      galleryStatus.textContent = "No changes to this media.";
      return;
    }
    savingDetails = true;
    updateControls();
    detailsSave.disabled = true;
    detailsCancel.disabled = true;
    editPark.disabled = true;
    editTitle.disabled = true;
    editDescription.disabled = true;
    detailsStatus.textContent = "Saving details…";
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(targetId)}`, {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isRecord(body) || body.ok !== true || !isMedia(body.media)) {
        throw new Error(responseError(body, response.status, "Unable to save these details. Please try again."));
      }
      if (signedOut) return;
      const saved = body.media;
      files = files.map((file) => file.id === targetId ? saved : file);
      for (const item of queue) {
        if (item.savedId !== targetId) continue;
        item.parkReference = saved.parkReference;
        renderQueueItem(item);
      }
      renderGallery();
      detailsDialog.close();
      galleryStatus.textContent = "Details saved.";
    } catch (error) {
      if (!signedOut) detailsStatus.textContent = errorMessage(error, "Unable to save these details. Check your connection and try again.");
    } finally {
      savingDetails = false;
      detailsSave.disabled = false;
      detailsCancel.disabled = false;
      editPark.disabled = false;
      editTitle.disabled = false;
      editDescription.disabled = false;
      updateControls();
      if (deferredRefresh) { deferredRefresh = false; void loadFiles(); }
    }
  }

  function updateControls(): void {
    if (uploadClose) uploadClose.disabled = uploading;
    if (openUpload) openUpload.disabled = signedOut;
    refresh.disabled = loading || uploading || savingDetails || signedOut;
    if (more) { more.hidden = !nextCursor; more.disabled = loading || uploading || savingDetails || signedOut; }
    detailsSave.disabled = loading || savingDetails || deleting || signedOut;
    detailDelete.disabled = savingDetails || deleting || signedOut;
    detailsCancel.disabled = savingDetails || deleting;
    for (const button of scopeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.mediaView === mediaView));
      button.disabled = uploading || savingDetails || deleting || signedOut;
    }
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

function parkOption(value: string, label: string): HTMLOptionElement {
  const option = element("option", "", label);
  option.value = value;
  return option;
}

function parkLabel(reference: string | null): string {
  const name = mediaParkName(reference);
  return reference && name !== reference ? `${reference} · ${name}` : name;
}

function mediaLabel(file: ActivatorMedia): string {
  return `${file.title || (file.kind === "photo" ? "Photo" : "Video")} by ${file.authorLabel}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMedia(value: unknown): value is ActivatorMedia {
  return isRecord(value) && typeof value.id === "string" && typeof value.filename === "string"
    && typeof value.contentType === "string" && (value.kind === "photo" || value.kind === "video")
    && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    && typeof value.createdAt === "string" && typeof value.callsign === "string" && typeof value.authorLabel === "string" && typeof value.url === "string"
    && (value.parkReference === null || typeof value.parkReference === "string")
    && (value.title === null || typeof value.title === "string")
    && (value.description === null || typeof value.description === "string")
    && typeof value.canEdit === "boolean";
}

function responseError(body: unknown, status: number, fallback: string): string {
  if (status === 401) return "Your access has expired. Sign in again, then return to your photos and videos.";
  return isRecord(body) && typeof body.error === "string" ? body.error : fallback;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && !(error instanceof TypeError || error instanceof SyntaxError) ? error.message : fallback;
}
