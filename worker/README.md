# Pace Bros private-media Worker

This Worker is the authenticated upload bridge and public media streamer for the private
`pace-bros-media` R2 bucket. It uses the direct `MEDIA_BUCKET` R2 binding; it does not need or
accept R2 S3 access keys.

## Routes

- `POST /upload/video` — authenticated administrator MP4 upload.
- `POST /upload/poster` — authenticated administrator JPG, PNG, or WebP upload.
- `GET /media/<object-key>` — public streaming, including a single HTTP byte range.
- `HEAD /media/<object-key>` — public media metadata.
- `DELETE /media/<object-key>` — authenticated administrator cleanup.
- `OPTIONS` — restricted CORS preflight.

Full and ranged GET bodies pass through Cloudflare's `FixedLengthStream`, so the runtime emits an
accurate `Content-Length` without buffering the media. HEAD is metadata-only; it intentionally
does not download the object just to manufacture a response length.

Uploads use the raw file as the request body, not multipart form data. Send these headers:

```text
Authorization: Bearer <current Supabase access token>
Content-Type: video/mp4 | image/jpeg | image/png | image/webp
X-Film-Id: <film UUID>
```

A successful upload returns HTTP `201`:

```json
{
  "key": "films/<film-uuid>/video/<random-uuid>.mp4",
  "contentType": "video/mp4",
  "size": 123456,
  "etag": "..."
}
```

Errors return `{ "error": { "code": "...", "message": "..." } }`. Delete is idempotent and
returns HTTP `204` after authorization.

## Authorization boundary

For every upload or delete, the Worker:

1. validates the Bearer token with the configured Supabase `/auth/v1/user` endpoint;
2. queries `public.admin_users` with that same token and the browser-safe publishable key;
3. requires a row whose `user_id` equals the UUID returned by Supabase Auth.

The Worker never trusts a browser-supplied user ID or email and contains no Supabase secret,
`service_role` key, database password, or R2 credential. The existing `admin_users` RLS policy
must continue to let an authenticated administrator select their own authorization row.

## Upload limit

`MAX_UPLOAD_BYTES` defaults to `95000000` (95 MB). The browser should reject a larger `File`
before uploading so the administrator receives an immediate message. The Worker also checks the
declared request size and the stored object size, deleting an oversized object if necessary.

This stays just below Cloudflare's 100 MB request-body limit on Free and Pro account plans.
Multipart upload and transcoding are intentionally deferred. Raise this value only when the
Cloudflare account's request-body limit can support it.

## Deploy

From this directory:

```powershell
npm install
npx wrangler login
npm run deploy
```

Wrangler will deploy the Worker named `pace-bros-media` and bind `MEDIA_BUCKET` directly to the
already-created `pace-bros-media` bucket. Confirm the deployment output reports that binding.
No S3 API token should be created.

Copy the resulting `workers.dev` origin without a trailing slash. Then open `../js/config.js` and
replace the placeholder value inside the existing frozen config object:

```js
workerBaseUrl: "https://pace-bros-media.<your-workers-subdomain>.workers.dev",
```

The committed CORS origin is the GitHub Pages origin `https://dohnnyj3pp.github.io`, which covers
the `/pace-bros-visuals/` project path. For local browser testing, serve the site over HTTP and
temporarily add its exact origin to the comma-separated `ALLOWED_ORIGINS` value; do not add `*`.

The public media route intentionally serves a valid object when its unpredictable key is known.
Only published film keys are returned by the public database query. Per-object authorization for
draft media can be added in a later privacy pass if required.
