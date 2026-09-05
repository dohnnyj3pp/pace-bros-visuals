# Pace Bros media, analytics, and social Worker

This Worker is the authenticated upload bridge and public media streamer for the private
`pace-bros-media` R2 bucket. It also provides the protected Admin analytics API backed by the
official Google Analytics Data API v1beta and the server-side Meta account-connection boundary.
It uses the direct `MEDIA_BUCKET` R2 binding; it does not need or accept R2 S3 access keys.

## Routes

- `POST /upload/video` — authenticated administrator MP4 upload.
- `POST /upload/poster` — authenticated administrator JPG, PNG, or WebP upload.
- `POST /upload/clip` — authenticated administrator promotional-clip MP4 upload.
- `POST /upload/video/multipart/create` — authenticated multipart video start.
- `PUT /upload/video/multipart/part` — authenticated multipart video part upload.
- `POST /upload/video/multipart/complete` — authenticated multipart video completion.
- `DELETE /upload/video/multipart/abort` — authenticated multipart video cancellation.
- `GET /media/<object-key>` — public streaming, including a single HTTP byte range.
- `HEAD /media/<object-key>` — public media metadata.
- `DELETE /media/<object-key>` — authenticated administrator cleanup.
- `GET /admin/analytics` — authenticated, normalized GA4 realtime and historical analytics.
- `POST /admin/social/meta/connect` — creates a signed Facebook Login for Business authorization URL.
- `POST /admin/social/meta/complete` — validates state, exchanges the code, and discovers Pages.
- `POST /admin/social/meta/select` — completes a multiple-Page selection using an encrypted token.
- `GET /admin/social/connections` — returns sanitized connection metadata only.
- `DELETE /admin/social/connections/<connection-uuid>` — removes locally stored credentials.
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

Clip uploads use the same headers and response contract, with keys shaped as
`films/<film-uuid>/clips/<random-uuid>.mp4`. They intentionally use the normal bounded upload
route; the existing master-film multipart routes remain unchanged.

Errors return `{ "error": { "code": "...", "message": "..." } }`. Delete is idempotent and
returns HTTP `204` after authorization.

## Authorization boundary

For every upload, delete, multipart, analytics, or social-account request, the Worker:

1. validates the Bearer token with the configured Supabase `/auth/v1/user` endpoint;
2. queries `public.admin_users` with that same token and the browser-safe publishable key;
3. requires a row whose `user_id` equals the UUID returned by Supabase Auth.

The Worker never trusts a browser-supplied user ID or email and contains no Supabase secret,
`service_role` key, database password, or R2 credential. The existing `admin_users` RLS policy
must continue to let an authenticated administrator select their own authorization row.

Authorization happens before the analytics cache is read, so cached analytics can never bypass
the administrator boundary. Analytics responses sent to the browser use `private, no-store`.
Social responses are also `private, no-store`; access tokens, ciphertext, app secrets, signing
secrets, and encryption keys are never returned.

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

## Meta account connection

The Social Media workspace uses Facebook Login for Business with an authorization-code flow.
The Worker creates a ten-minute HMAC-signed state bound to the current Supabase administrator.
After Meta redirects to `https://pacebrosvisuals.ca/admin/`, Admin immediately removes the OAuth
parameters from the visible URL and submits the code and state to the Worker with its Supabase
Bearer token. The Worker exchanges the code and short-lived user token server-side, verifies the
granted permissions, discovers managed Pages, and looks up a linked Instagram Professional
account for the selected Page.

If Meta returns multiple Pages, the Worker returns names and IDs plus a short-lived opaque Page
selection token. Page access tokens remain inside its AES-256-GCM ciphertext and are never
exposed as plaintext to browser JavaScript. Only the selected Page token is encrypted again with
a fresh nonce before the connection is stored in Supabase; the broader user token is not retained.

The normalized browser response contains only connection IDs, Facebook/Instagram identity,
status, granted scopes, and timestamps. Disconnect deletes the local row and encrypted token
material. Full Meta app deauthorization is intentionally deferred because it would revoke the
whole Meta grant rather than only the selected Page.

### Meta developer setup

1. Create a **Business** app in Meta for Developers and add **Facebook Login for Business**.
2. Create a Facebook Login for Business configuration that returns a **User access token**. Add:
   `pages_show_list`, `pages_read_engagement`, `instagram_basic`, and `business_management`.
   `public_profile` is implicit. The Worker requires the three Page/business permissions;
   `instagram_basic` enables optional linked-account discovery and does not block Facebook when
   unavailable. Do not add publishing permissions for this connection-only phase.
3. Register this exact Valid OAuth Redirect URI, including the trailing slash:

   ```text
   https://pacebrosvisuals.ca/admin/
   ```

4. Add `pacebrosvisuals.ca` as the app domain/site where Meta requests it. Copy the Meta **App
   ID**, **App Secret**, and the Facebook Login for Business **Configuration ID**.
5. While the app is in Development Mode, add the Facebook identity used by Pace Bros as an app
   Administrator, Developer, or Tester. That identity must also have access to the Pace Bros
   Visuals Facebook Page. To discover Instagram, link a Business or Creator Instagram account to
   that Page.

The committed Worker variables pin Graph API `v26.0`, the production redirect URI, the required
permission set, and a 600-second state lifetime. Store all account-specific values through
Wrangler so none enter Git history:

```powershell
npx wrangler secret put META_APP_ID
npx wrangler secret put META_LOGIN_CONFIG_ID
npx wrangler secret put META_APP_SECRET
npx wrangler secret put META_OAUTH_STATE_SECRET
npx wrangler secret put META_TOKEN_ENCRYPTION_KEY
```

For the first three commands, paste the matching Meta dashboard value. Generate independent
random values for the last two. `META_TOKEN_ENCRYPTION_KEY` must decode to exactly 32 bytes. In
PowerShell 7, these commands generate and set suitable values without writing them to a file:

```powershell
$metaStateBytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Fill($metaStateBytes)
[Convert]::ToBase64String($metaStateBytes) | npx wrangler secret put META_OAUTH_STATE_SECRET

$metaEncryptionBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Fill($metaEncryptionBytes)
[Convert]::ToBase64String($metaEncryptionBytes) | npx wrangler secret put META_TOKEN_ENCRYPTION_KEY
```

Use different random bytes for the signing and encryption secrets. Rotating the encryption key
without first reconnecting will make existing ciphertext unreadable to a future publishing phase.

Development/Standard Access is sufficient only for Facebook users assigned an app role. Live
access for people outside app roles requires Advanced Access/App Review for the requested
permissions and generally business verification. The next publishing phase will additionally
need `pages_manage_posts` and `instagram_content_publish`; request their Advanced Access only
when a real publishing interface exists and can be demonstrated during review.

Current Meta references: [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/),
[manual login flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/),
[long-lived tokens](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/),
[Pages getting started](https://developers.facebook.com/docs/pages-api/getting-started/), and
[Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/get-started).

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
