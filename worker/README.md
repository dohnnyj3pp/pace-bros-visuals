# Pace Bros media and analytics Worker

This Worker is the authenticated upload bridge and public media streamer for the private
`pace-bros-media` R2 bucket. It also provides the protected Admin analytics API backed by the
official Google Analytics Data API v1beta. It uses the direct `MEDIA_BUCKET` R2 binding; it does
not need or accept R2 S3 access keys.

## Routes

- `POST /upload/video` — authenticated administrator MP4 upload.
- `POST /upload/poster` — authenticated administrator JPG, PNG, or WebP upload.
- `POST /upload/video/multipart/create` — authenticated multipart video start.
- `PUT /upload/video/multipart/part` — authenticated multipart video part upload.
- `POST /upload/video/multipart/complete` — authenticated multipart video completion.
- `DELETE /upload/video/multipart/abort` — authenticated multipart video cancellation.
- `GET /media/<object-key>` — public streaming, including a single HTTP byte range.
- `HEAD /media/<object-key>` — public media metadata.
- `DELETE /media/<object-key>` — authenticated administrator cleanup.
- `GET /admin/analytics` — authenticated, normalized GA4 realtime and historical analytics.
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

For every upload, delete, multipart operation, or analytics request, the Worker:

1. validates the Bearer token with the configured Supabase `/auth/v1/user` endpoint;
2. queries `public.admin_users` with that same token and the browser-safe publishable key;
3. requires a row whose `user_id` equals the UUID returned by Supabase Auth.

The Worker never trusts a browser-supplied user ID or email and contains no Supabase secret,
`service_role` key, database password, or R2 credential. The existing `admin_users` RLS policy
must continue to let an authenticated administrator select their own authorization row.

Authorization happens before the analytics cache is read, so cached analytics can never bypass
the administrator boundary. Analytics responses sent to the browser use `private, no-store`.

## Admin analytics contract

Send the current Supabase session access token:

```text
GET /admin/analytics
Authorization: Bearer <current Supabase access token>
```

A successful response contains only the normalized fields the Admin and future internal tools
need:

```json
{
  "generatedAt": "2026-09-04T12:00:00.000Z",
  "realtime": {
    "activeUsers": 0,
    "views": 0,
    "eventCount": 0
  },
  "today": {
    "totalUsers": 0,
    "newUsers": 0,
    "sessions": 0,
    "views": 0,
    "averageEngagementTimeSeconds": 0,
    "eventCount": 0
  },
  "last7Days": {
    "totalUsers": 0,
    "newUsers": 0,
    "sessions": 0,
    "views": 0,
    "averageEngagementTimeSeconds": 0,
    "eventCount": 0
  },
  "last30Days": {
    "totalUsers": 0,
    "newUsers": 0,
    "sessions": 0,
    "views": 0,
    "averageEngagementTimeSeconds": 0,
    "eventCount": 0
  },
  "topContent": [
    {
      "title": "Page title from GA4",
      "path": "/page-path",
      "views": 0
    }
  ],
  "trafficSources": [
    {
      "source": "Source from GA4",
      "medium": "Medium from GA4",
      "sessions": 0,
      "users": 0,
      "percentage": 0
    }
  ]
}
```

The zeros above document types only; the Worker never substitutes demo or fallback counts. GA4's
`runRealtimeReport` supplies the default last-30-minute realtime window. Historical summaries use
inclusive Today, Last 7 Days (`6daysAgo` through `today`), and Last 30 Days (`29daysAgo` through
`today`) date ranges in the GA4 property's reporting timezone. Top content and session traffic
sources cover the last 30 days. `averageEngagementTimeSeconds` is calculated using Google's
definition: `userEngagementDuration / activeUsers`.

The Worker uses one `batchRunReports` request for all five historical tables and one
`runRealtimeReport` request. Realtime data is cached for 60 seconds and historical data for 300
seconds. Both an isolate-memory cache/request deduplication layer and Cloudflare's Cache API are
used, so correct rate limiting does not depend on one cache mechanism. A Refresh action does not
bypass these server-side minimums. Change the bounded TTLs with
`ANALYTICS_REALTIME_CACHE_SECONDS` (30–120) and `ANALYTICS_HISTORICAL_CACHE_SECONDS` (120–1800).

Failures retain the standard Worker error shape:

```json
{
  "error": {
    "code": "analytics_unavailable",
    "message": "Analytics is temporarily unavailable."
  }
}
```

Analytics-specific codes are `analytics_not_configured`, `analytics_authentication_failed`, and
`analytics_unavailable`. They intentionally contain no Google credential, property, or upstream
response details.

## Google Analytics setup

No Google credential is committed or placed in browser JavaScript. Complete these one-time steps:

From this `worker` directory, install the pinned dependencies and authenticate Wrangler first:

```powershell
npm install
npx wrangler login
```

1. In Google Analytics, select the GA4 property receiving production traffic and copy its numeric
   **Property ID** from Admin. This is not the public Measurement ID beginning with `G-`.
2. Select or create a Google Cloud project and enable **Google Analytics Data API v1**.
3. Create a dedicated service account in that Cloud project. Create and download a JSON key for it.
4. In Google Analytics, open Admin > Property access management > Add users. Add the service
   account's `client_email` from the JSON key with the minimum **Viewer** role.
5. From this `worker` directory, add the numeric property ID and the complete service-account JSON
   as encrypted Worker secrets:

   ```powershell
   npx wrangler secret put GA4_PROPERTY_ID
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
   ```

   At the first prompt paste only the numeric Property ID. At the second prompt paste the complete
   JSON as one line. A safe PowerShell alternative, with the downloaded key kept outside this
   repository, is:

   ```powershell
   Get-Content -Raw C:\secure\pace-bros-ga4.json | ConvertFrom-Json | ConvertTo-Json -Compress | npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON
   ```

   Replace that example path with the real key location. Securely remove the downloaded key after
   confirming the Worker secret is present; Cloudflare retains the encrypted value. If the key is
   ever exposed or copied into an unsafe location, revoke that key in Google Cloud, create a new
   one, and replace the Worker secret.

The Worker signs a short-lived RS256 service-account JWT with Web Crypto, exchanges it at Google's
OAuth token endpoint for the `analytics.readonly` scope, and reuses that access token only until
shortly before expiry. It calls only the current GA4 Data API v1beta endpoints. See Google's
[Data API quickstart](https://developers.google.com/analytics/devguides/reporting/data/v1/quickstart),
[server-to-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/service-account),
[realtime method](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/runRealtimeReport),
and [batch report method](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/properties/batchRunReports).

## Upload limit

`MAX_UPLOAD_BYTES` defaults to `95000000` (95 MB). The browser should reject a larger `File`
before uploading so the administrator receives an immediate message. The Worker also checks the
declared request size and the stored object size, deleting an oversized object if necessary.

This stays just below Cloudflare's 100 MB request-body limit on Free and Pro account plans for a
single request. The existing multipart route divides larger MP4 files into independently bounded
parts. Transcoding remains out of scope. Raise the per-request value only when the Cloudflare
account's request-body limit can support it.

## Deploy

From this directory:

```powershell
npm test
npm run check
npm run deploy
```

Wrangler will deploy the Worker named `pace-bros-media` and bind `MEDIA_BUCKET` directly to the
already-created `pace-bros-media` bucket. Confirm the deployment output reports that binding.
No S3 API token should be created.

The browser config currently targets the existing production Worker:

```js
workerBaseUrl: "https://pace-bros-media.pace-bros-visuals.workers.dev",
```

Confirm Wrangler reports that same origin. Change `../js/config.js` only if Cloudflare deploys this
Worker at a different origin, and keep the value free of a trailing slash.

The committed CORS allowlist includes `https://pacebrosvisuals.ca`,
`https://www.pacebrosvisuals.ca`, and the prior GitHub Pages origin
`https://dohnnyj3pp.github.io`. For local browser testing, serve the site over HTTP and temporarily
add its exact origin to the comma-separated `ALLOWED_ORIGINS` value; do not add `*`.

The public media route intentionally serves a valid object when its unpredictable key is known.
Only published film keys are returned by the public database query. Per-object authorization for
draft media can be added in a later privacy pass if required.
