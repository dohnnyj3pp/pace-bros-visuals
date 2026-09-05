# Pace Bros Visuals

Vanilla HTML, CSS, and JavaScript for the Pace Bros Visuals public site and protected film administration workspace.

## Production architecture

- `index.html`, `css/main.css`, `js/main.js` — cinematic public site, dynamic Selected Works catalogue, native HTML5 film player, and the BEGIN / ENTER experience.
- `js/ga4.js` — optional public GA4 collection. It stays inert until a browser-safe `G-...` Measurement ID is set in `js/config.js`.
- `admin/` — Supabase-authenticated film administration plus the protected Pace Bros Analytics workspace.
- `js/config.js` — browser-safe Worker base URL and public GA4 Measurement ID settings. Never put Google service-account credentials here.
- `js/supabase-client.js`, `js/auth.js` — shared browser-safe Supabase client and existing administrator authorization flow.
- `supabase/migrations/202608310001_create_films.sql` — `public.films`, update trigger, grants, indexes, and Row Level Security policies.
- `worker/` — Cloudflare Worker for authenticated single/multipart uploads, public streaming from private R2, and the admin-only GA4 Data API bridge.

The public site and Admin remain static GitHub Pages files. Supabase stores film metadata; the private R2 bucket stores poster and MP4 objects; the Worker is the server-side boundary for media operations and Google Analytics credentials.

## One-time production setup

Phase 3 adds no database migration. Keep the already-applied films migration and RLS policies unchanged.

1. From `worker/`, install dependencies and authenticate Wrangler:

   ```powershell
   npm install
   npx wrangler login
   ```

2. Complete the Google Analytics property, service-account access, and encrypted Worker-secret setup in `worker/README.md`.
3. Run `npm test`, `npm run check`, and `npm run deploy` from `worker/`.
4. Confirm the deployed Worker origin matches the existing `workerBaseUrl` value in `js/config.js`, without a trailing slash.
5. Put the public web stream Measurement ID (`G-...`) in `ga4MeasurementId` in `js/config.js`. This is intentionally separate from the numeric GA4 Property ID stored in the Worker.
6. Commit and push the static-site changes so GitHub Pages publishes them at `https://pacebrosvisuals.ca`.

The Worker configuration already binds `MEDIA_BUCKET` to the existing private `pace-bros-media` bucket and contains only browser-safe/static values. Google service-account JSON and the numeric GA4 Property ID must be added with Wrangler as encrypted Worker secrets. Do not add a Supabase service-role key, database password, R2 S3 key, Google private key, or OAuth secret to tracked files or browser code.

## Run locally

Serve the repository with any static HTTP server; no public-site build step is required. If local admin upload testing is needed, add the exact local HTTP origin temporarily to the Worker's comma-separated `ALLOWED_ORIGINS` value. Do not use `*`.

## MVP media boundary

Single-request uploads are capped at 95 MB; the existing multipart route handles larger MP4 files in independently bounded parts. Only published rows are queried by the public catalogue, and generated R2 object names are unpredictable. Anyone who already knows an exact media key can use its public Worker URL; per-object draft authorization and transcoding remain intentionally deferred.
