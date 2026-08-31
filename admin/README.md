# Pace Bros Visuals admin foundation

This directory is intentionally isolated from the public landing page. The first increment is a static, unlinked admin shell that can review a draft locally. It does not save data, upload files, call an AI service, or publish content.

## Security boundary

Hiding `/admin/` is not authentication. Every future write endpoint must authenticate the current user and authorize Adam or Craig on the server. Do not add client-side passwords, API keys, AI credentials, storage credentials, or an editor allowlist to these files.

Keep the public landing page available to everyone. Keep admin routes, draft records, upload requests, AI jobs, and publish actions private.

## Target flow

1. The server confirms an authorized editor session.
2. The editor saves a private film draft.
3. The server issues short-lived signed upload instructions.
4. The browser uploads the asset directly to object storage.
5. The server validates the asset and records its metadata.
6. Requested AI jobs create suggestions attached to the draft.
7. Adam or Craig reviews those suggestions and explicitly publishes a version.
8. The public site reads only published film records.

AI output must remain a suggestion. It must never publish automatically.

## API boundary prepared by `js/api.js`

- `GET /api/admin/session`
- `GET /api/admin/films`
- `POST /api/admin/films`
- `POST /api/admin/uploads`
- `POST /api/admin/films/:filmId/automations`
- `POST /api/admin/films/:filmId/publish`

The client always sends same-origin credentials. The server must enforce authorization, validate every field and file, rate-limit sensitive actions, and return safe JSON errors.

## Minimum server-side records

- `Film`: title, slug, logline, year, runtime, format, status, sort order, version, timestamps.
- `Asset`: film owner, storage key, original name, verified MIME type, byte size, kind, processing status, timestamps.
- `AutomationJob`: film owner, requested task, status, model/prompt version, output, cost metadata, timestamps.
- `AuditEvent`: actor, action, record, prior version, resulting version, timestamp.

Store structured metadata in a database and video/image bytes in object storage. Never put uploaded media in Git or store authoritative draft data in `localStorage`.

## Next increment

Choose the production host, then implement only `GET /api/admin/session` and server-side authorization first. After that, connect private film drafts and audit logging before adding signed uploads or AI jobs.

The landing page should keep its current hard-coded film array as a fallback until the published-content feed is proven stable. Before accepting admin-authored copy in the public renderer, replace template-string `innerHTML` insertion with validated DOM creation and `textContent`.
