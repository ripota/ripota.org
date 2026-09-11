# Activator photos and videos

Implementation status: September 11, 2026. This describes the code and local
workflow, not a production deployment verification.

## Experience and access

The public **Photos & videos** gallery at `/activate-ri-2026/media/` is linked
from event navigation and the Hunter page. Everyone can browse existing and
new uploads. The activator portal's **My media** page at
`/activate-ri-2026/activator/media/` shows only the caller's own uploads, with
a link to the public gallery and
a prominent **Upload photos & videos** button. The upload dialog accepts
multiple files or dropped files, lets the activator review the selection, and
uploads sequentially. Each file has progress, cancellation, and retry controls.
Successful batches return to the gallery; incomplete batches remain available
for retry. A short note beside the upload action explains sharing and reuse:

> By uploading, you’re letting RI POTA share these photos and videos on this
> website, in articles, on social media, and in other publicity.

Uploading is the action; there is no checkbox or separate permission flow.
New uploads record notice version `ri-pota-media-v1` with the file's existing
uploader identity and upload timestamp. The wording clarifies the same sharing
and publicity scope; existing uploads do not need a new permission action.

The public gallery shows shared uploads from all activators
with the same uploader byline as chat. The shared author utility combines the
callsign with the first name or the customized Ops Room display name; an
explicitly blank display name stays hidden. Public filters select a park
(including General) and All/Photos/Videos through `mediaPark` and `mediaKind`
URL parameters. Defaults are omitted. Reload, Back/Forward, clearing filters,
and background refresh preserve the choice. My media always requests the
caller's files; the old `mediaScope` parameter is removed from that page.
All galleries paginate newest uploads first. Compact tiles show a thumbnail, uploader byline, optional
title, and an overlaid park reference. Opening a tile shows a larger photo or
playable original video, its details, and an original download. Signed-in owners
see **Yours** on their public tiles. Owners and authenticated organizers can
edit or delete in the same viewer; everyone else sees read-only details.
Signing out or losing editing access leaves public browsing available.
Dialogs lock background scrolling and restore focus on close.
Opening media adds `mediaId` to the current URL; reload and Back/Forward restore
the viewer while preserving gallery filters and unrelated URL state. **Copy URL**
and **Share** always use `/activate-ri-2026/media/?mediaId={id}`, including when
sharing from My media or the organizer dashboard. These public permalinks open
the requested photo or video without signing in, independently of pagination
and active filters. Share uses the browser's share sheet when available and
otherwise copies the URL. If copying is blocked, a selected URL is shown for
manual copying. Invalid or deleted links leave the gallery usable with a message.
Filenames remain available for original downloads but are not gallery titles.
Park tagging is optional. **General — no park** is the default; choosing a park
sets the initial choice for newly selected files, and each queued file can be
assigned a different park before uploading. Park badges reveal the full name
on hover or keyboard focus, and the details dialog also shows the full park name.
Both the uploader and organizers can correct or clear
a saved file's park in **Edit details**. A title (up to 120 characters) and
description (up to 2,000 characters) are optional in the same dialog. Blank titles
stay untitled; descriptions are displayed as plain text. Uploading
does not require filling out these fields. Any park in the pinned Rhode Island
reference index is available, including parks outside the activator's submitted plan.

The displayed date is explicitly labeled **Uploaded**. The park is an explicit
association supplied by the uploader or organizer; it is not inferred from
upload time, a planned stop, GPS, or embedded camera metadata. Changing the park
preserves the original upload timestamp and stored file.

If the upload rate limit is reached, the batch pauses and preserves the remaining
selection so the activator can resume after the displayed wait.
The organizer dashboard has a **Photos & Videos** tab with all event uploads,
uploader callsigns, pagination, downloads, and deletion.

All ready uploads are publicly visible, including originals with any embedded
GPS and capture-time metadata. Activators can edit and delete only their own files;
organizers can edit metadata and delete any event upload. These permissions
are enforced by the API, not just hidden controls.

The upload copy describes website and editorial/publicity use. There is no
separate publishing queue or consent checkbox. Existing unified and legacy activator authentication
modes apply; an account without an event
registration has no upload access. Pending, approved, and withdrawn activators
can upload. Rejected activators can read and delete their own existing files,
but cannot add more. Session revocation removes upload/editing access while
public browsing remains available.

Supported photos: JPEG, PNG, GIF, WebP, HEIC, HEIF, and AVIF. Supported videos:
MP4, MOV (QuickTime), and WebM. There is no per-activator total file count or
storage cap. Individual upload limits remain:

| Limit | Value |
| --- | --- |
| Each photo | 20 MiB |
| Each video | 80 MiB |
| Upload attempts | 10 per minute |

The interface uses MB labels for binary megabytes. Originals are retained,
including embedded location and camera metadata. Originals are never rewritten
or transcoded. Separate small thumbnails are used for photo tiles; original
bytes are requested only when the viewer opens or a file is downloaded.
HEIC/HEIF and unsupported video codecs have an original-download fallback;
playback depends on the browser. Files are checked by extension, MIME type,
bounded container signatures, and actual byte length. Container checks are not
a full media decoder or malware scanner. Active formats such as HTML and SVG,
audio file types, and arbitrary attachments are not accepted.

## Storage and request flow

`ACTIVATOR_MEDIA` is a dedicated private R2 bucket,
`ripota-org-activator-media`. Do not enable an R2 public development URL or
attach a public custom domain. There are no presigned public URLs. D1 migration
`0031_activator_media.sql` stores metadata in `activate_ri_media`; object keys
contain event and random IDs, never the filename or an activator's email.
Uploads with identical filenames are separate objects and cannot overwrite one another.
Migration `0032_media_park_reference.sql` adds a nullable `park_reference` column;
null means a general upload without a park association.
Migration `0033_media_sharing_and_details.sql` adds optional title/description,
and the upload notice version. The existing gallery index supports both audiences.

`POST /api/activate-ri-2026/activator/media` accepts a raw file body, its
`Content-Type`, a required `Content-Length`, and an URI-encoded
`X-Media-Filename`. The browser supplies the length when XHR sends a File.
The optional `X-Media-Park-Reference` header associates a known Rhode Island park;
an absent or empty header keeps the upload general.
Titles and descriptions start empty and can be added later. No permission
header or separate acceptance request is required.
Authentication and the trusted Origin are checked before writes. A database
record tracks each in-flight upload independently, including concurrent uploads.
The Worker inspects at most 4 KiB of header data and pipes bytes through a
`FixedLengthStream` to R2. It marks the record ready only after storage succeeds.

`GET /api/activate-ri-2026/activator/media` lists all ready event uploads.
`?scope=mine` lists only the caller's own files;
usage always counts only the caller's files, including in-flight uploads, and is
informational rather than an upload gate.
The corresponding `/admin/media` route includes all ready event uploads.
Both return up to 50 records and an opaque `nextCursor` for the next page.
`GET` and `HEAD` on either audience's `/media/{id}/file` route authorize access
before reading R2: the owner, an organizer, or another signed-in event activator.
Video seeking uses single byte ranges with `206`/`416` responses; `If-Range` falls back to the
complete representation. `?download=1` sets attachment disposition. All file,
metadata, and error responses have private/no-store and nosniff headers.

`PATCH /api/activate-ri-2026/{activator|admin}/media/{id}` accepts a partial JSON
object with `parkReference`, `title`, and/or `description`. Null clears a field;
blank titles/descriptions normalize to null. Unknown fields, unsupported control
characters, and oversized text are rejected. Editors send only changed fields
to preserve unrelated metadata edits made by another editor.
Ownership/organizer authorization and trusted Origin checks apply. Requests are
limited to 16 KiB, and only ready records can change. This updates D1 metadata
without rewriting the R2 object or changing the original upload date. Responses
include `parkReference`, `title`, `description`, the current `authorLabel`, and server-computed `canEdit`;
clients cannot grant themselves editing rights.

`DELETE /media/{id}` checks the trusted Origin and ownership or organizer role.
It first hides the row, then deletes the object, then removes metadata. A failed
object deletion retains the row and key for retry. Upload failures similarly
remove their tracking record when cleanup succeeds. The daily 05:17 UTC job
retries up to 50 unfinished/deleting records older than 24 hours. A terminated
upload may count toward usage until this cleanup runs. Ready uploads are kept
until the owner or an organizer deletes them; they are not part of the existing
Ops Room purge or event evidence archive.

If the response to an upload is lost, refresh the saved gallery before retrying:
the upload may have completed. The browser does not persist selected file
contents or private upload metadata across page reloads.

## Public reads and thumbnails

`GET /api/activate-ri-2026/public/media` lists ready event uploads with cursor
pagination. Optional `park` (a known reference or `general`) and `kind` (`photo`
or `video`) filter before pagination. The public response includes display
metadata and content URLs, without internal owner IDs, storage keys, original
filenames, usage totals, or limits. Optional existing authentication adds
server-computed `isOwn`, `canEdit`, and `editUrl`; anonymous and expired sessions
can still browse. Personalized lists use private/no-store headers and vary on
credentials. Public file reads support GET/HEAD and video byte ranges through
`/public/media/{id}/file`. Public routes never accept file or metadata mutations.
They omit the private API's noindex directive. The R2 bucket stays private.

`GET /api/activate-ri-2026/public/media/{id}` resolves one ready upload with the
same public metadata, optional editing rights, and private/no-store headers as
the listing. It does not read R2 or expose original filenames or storage keys.
Authenticated `/activator/media/{id}` and `/admin/media/{id}` metadata reads
support restoring their viewers with owner/organizer authorization.

Photo tiles request `/public/media/{id}/thumbnail`. After checking the live
ready record, the route reads `{original-object-key}/thumbnail-v1.webp` from R2.
On a cache miss, the `IMAGES` binding receives the original R2 stream and makes
a still WebP fitting within 640×640 pixels at quality 75. Output is bounded to
2 MiB and stored once for reuse. Existing uploads get thumbnails on their first
request without changing their original or migrating metadata.

Unsupported inputs and transient decoder failures show a small tile fallback;
the grid never substitutes the original. Failures back off for 15 minutes,
using a conditional marker that cannot replace a concurrent successful result.
Explicit Refresh retries failed previews. Video tiles use a lightweight Video
placeholder and request video bytes only when the viewer opens.

R2 stores reusable derivatives; HTTP responses use no-store so each request
checks visibility. Deletion and cleanup remove both objects. Generation checks
the row before and after storage to remove derivatives created during deletion.
The production-data local environment reads existing thumbnails but cannot
generate them or write anything to the bucket.

Cloudflare's decoder supports fewer inputs than original uploads: AVIF input
requires Enterprise, and input dimensions/size limits can reject an otherwise
valid upload. These affect previews only. Originals and their metadata remain
available. No new subscription was enabled; the existing account's remote
Images binding was verified with a public sample.

## Future AI descriptions

The optional title and description fields are implemented; automatic image
analysis is not. A future processor should propose separate drafts for review
and preserve human edits. It should not infer uploader identity, park reference,
or capture time as facts from an image. The original file and filename remain
available independently of its editorial title and description.

## Local development and deployment

The public gallery has a dedicated 1200×630 social preview, built from the
repository-owned coastal photo and community branding. Run
`mise run assets:media-share-card` to regenerate it. The image URL includes a
content fingerprint so a new design gets a new social-image URL. It does not
copy live uploads into the repository or retain photos removed from the gallery.

The local Wrangler environment simulates the bucket and D1. Apply migrations
with `mise run activate-ri-2026:d1-apply-local`, then use
`npx wrangler dev --env local` for the Worker-backed application. The
`production-data` environment reads the remote
bucket alongside remote D1 and rejects media mutations and cleanup.

Before the first production deployment, create the bucket once:

```bash
npx wrangler r2 bucket create ripota-org-activator-media
```

Then use `mise run deploy`, which applies D1 migrations before deploying the
Worker. The bucket binding, `IMAGES`, and `MEDIA_UPLOAD_RATE_LIMIT` are configured
in all environments. Local tests use the local Images implementation.
Keep bucket access private. D1 backup/Time Travel covers
metadata only; it cannot restore deleted R2 originals. Any independent original
backup must retain the same restricted access.

Before a full registration/database reset, remove uploads through the organizer
gallery and let unfinished/deletion cleanup complete. The production reset task
checks that `activate_ri_media` is empty before deleting authentication or owner
records. Do not bypass this by deleting metadata rows, which would orphan R2
objects. Restoring an old D1 backup may restore metadata pointing at objects
that have since been deleted; verify media access after restoration.

## Verification and references

- `src/lib/activate-ri/media.test.ts`: shared input validation and limits.
- `src/lib/activate-ri/media-parks.test.ts`: optional park references and labels.
- `src/worker/media.test.ts`: signatures, streaming, cancellation, exact lengths.
- `src/worker/media-thumbnails.test.ts`: reuse, original preservation, bounded
  output, read-only mode, failure backoff, and deletion races.
- `src/worker/media.acceptance.test.ts`: SQLite migrations, authorization,
  upload counts and sizes above the former caps, duplicate filenames, customized
  bylines, public visibility, ownership, filters, failure recovery, and ranges.
- `e2e/activate-ri-media.spec.ts`: public/personal browser workflows against
  local Wrangler/R2, thumbnail-only tile requests, ownership, and URL filters.

Implementation references: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [Workers streams](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/).
Thumbnail references: [Images binding](https://developers.cloudflare.com/images/optimization/binding/)
and [supported formats and limits](https://developers.cloudflare.com/images/get-started/limits/).
