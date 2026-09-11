# Activator photos and videos

Implementation status: September 11, 2026. This describes the code and local
workflow, not a production deployment verification.

## Experience and access

The private activator portal has a **Photos & videos** page at
`/activate-ri-2026/activator/media/`. Activators can choose multiple files or
drop them into the selection, review their selection, and upload sequentially.
Each file has progress, cancellation, and retry controls. The saved gallery
supports photos, native video controls, original downloads, and confirmed deletion.
Park tagging is optional. **General — no park** is the default; choosing a park
sets the initial choice for newly selected files, and each queued file can be
assigned a different park before uploading. The gallery shows the park name and
reference or General, and both the uploader and organizers can correct or clear
a saved file's park. Any park in the pinned Rhode Island reference index is
available, including parks outside the activator's submitted plan.

The displayed date is explicitly labeled **Uploaded**. The park is an explicit
association supplied by the uploader or organizer; it is not inferred from
upload time, a planned stop, GPS, or embedded camera metadata. Changing the park
preserves the original upload timestamp and stored file.

If the upload rate limit is reached, the batch pauses and preserves the remaining
selection so the activator can resume after the displayed wait.
The organizer dashboard has a **Photos & Videos** tab with all event uploads,
uploader callsigns, pagination, downloads, and deletion.

Uploads are visible only to their owner and authenticated organizers. They are
not published to the public site or shared in the Ops Room. Existing unified
and legacy activator authentication modes apply; an account without an event
registration has no upload access. Pending, approved, and withdrawn activators
can upload. Rejected activators can read and delete their own existing files,
but cannot add more. Session revocation applies to every file request as well
as the page and metadata requests.

Supported photos: JPEG, PNG, GIF, WebP, HEIC, HEIF, and AVIF. Supported videos:
MP4, MOV (QuickTime), and WebM. Limits per activator and event:

| Limit | Value |
| --- | --- |
| Each photo | 20 MiB |
| Each video | 80 MiB |
| Saved and in-flight files combined | 50 |
| Saved and in-flight storage combined | 500 MiB |
| Upload attempts | 10 per minute |

The interface uses MB labels for binary megabytes. Originals are retained,
including embedded location and camera metadata. There is no transcoding,
thumbnail generation, metadata stripping, or public publishing consent workflow.
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
Migration `0032_media_park_reference.sql` adds a nullable `park_reference` column;
existing uploads remain general until explicitly associated with a park.

`POST /api/activate-ri-2026/activator/media` accepts a raw file body, its
`Content-Type`, a required `Content-Length`, and an URI-encoded
`X-Media-Filename`. The browser supplies the length when XHR sends a File.
The optional `X-Media-Park-Reference` header associates a known Rhode Island park;
an absent or empty header keeps the upload general.
Authentication and the trusted Origin are checked before writes. A single SQL
statement reserves both count and byte quotas, including concurrent uploads.
The Worker inspects at most 4 KiB of header data and pipes bytes through a
`FixedLengthStream` to R2. It marks the record ready only after storage succeeds.

`GET /api/activate-ri-2026/activator/media` lists the caller's ready uploads and
usage. The corresponding `/admin/media` route returns up to 50 records and an
opaque `nextCursor` for the next page. `GET` and `HEAD` on either audience's
`/media/{id}/file` route authorize that audience before reading R2. Video seeking
uses single byte ranges with `206`/`416` responses; `If-Range` falls back to the
complete representation. `?download=1` sets attachment disposition. All file,
metadata, and error responses have private/no-store and nosniff headers.

`PATCH /api/activate-ri-2026/{activator|admin}/media/{id}` accepts JSON
`{ "parkReference": "US-2868" }`, or `{ "parkReference": null }` to clear the park.
Ownership/organizer authorization and trusted Origin checks apply. Requests are
limited to 1 KiB, and only ready records can change. This updates D1 metadata
without rewriting the R2 object. Responses and gallery records include
`parkReference`.

`DELETE /media/{id}` checks the trusted Origin and ownership or organizer role.
It first hides the row, then deletes the object, then removes metadata. A failed
object deletion retains the row and key for retry. Upload failures similarly
release their reservation when cleanup succeeds. The daily 05:17 UTC job
retries up to 50 unfinished/deleting records older than 24 hours. A terminated
upload may count toward usage until this cleanup runs. Ready uploads are kept
until the owner or an organizer deletes them; they are not part of the existing
Ops Room purge or event evidence archive.

If the response to an upload is lost, refresh the saved gallery before retrying:
the upload may have completed. The browser does not persist selected file
contents or private upload metadata across page reloads.

## Local development and deployment

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
Worker. The bucket binding and `MEDIA_UPLOAD_RATE_LIMIT` are configured in
all environments. Keep bucket access private. D1 backup/Time Travel covers
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
- `src/worker/media.acceptance.test.ts`: SQLite migrations, authorization,
  quotas, ownership, failure recovery, and range responses.
- `e2e/activate-ri-media.spec.ts`: browser workflows against local Wrangler/R2.

Implementation references: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
and [Workers streams](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/).
