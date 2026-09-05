# Pace Bros Visuals

Vanilla HTML, CSS, and JavaScript for the Pace Bros Visuals public site and protected film, promotional-clip, analytics, and social-account administration workspace.

## Production architecture

- `index.html`, `css/main.css`, `js/main.js` — cinematic public site, dynamic Selected Works catalogue, native HTML5 film player, and the BEGIN / ENTER experience.
- `js/ga4.js` — optional public GA4 collection. It stays inert until a browser-safe `G-...` Measurement ID is set in `js/config.js`.
- `admin/` — Supabase-authenticated Films, Clips, Analytics, and Meta connection workspaces.
- `js/config.js` — browser-safe Worker base URL and public GA4 Measurement ID settings. Never put Google service-account credentials here.
- `js/supabase-client.js`, `js/auth.js` — shared browser-safe Supabase client and existing administrator authorization flow.
- `supabase/migrations/202608310001_create_films.sql` — `public.films`, update trigger, grants, indexes, and Row Level Security policies.
- `supabase/migrations/202609050001_create_clips_library.sql` — admin-only `public.clips` and `public.clip_captions`, metadata, caption ordering, film deletion protection, indexes, triggers, and Row Level Security.
- `supabase/migrations/202609050002_create_social_connections.sql` — generic, admin-only encrypted social connection storage and Row Level Security.
- `worker/` — Cloudflare Worker for media, GA4 Analytics, and the server-side Meta OAuth/token boundary.

The public site and Admin remain static GitHub Pages files. Supabase stores film, clip, caption, and encrypted social-connection records; the private R2 bucket stores poster and MP4 objects; the Worker is the server-side boundary for media operations, Google Analytics credentials, and Meta credentials.

## One-time production setup

Apply any unapplied repository migrations in filename order. The Clips and Social migrations both assume the films migration and `public.admin_users` security model are already present.

1. Apply the Clips Library and Social Connections migrations in the Supabase SQL Editor (or with the Supabase CLI).
2. From `worker/`, install dependencies and authenticate Wrangler:

   ```powershell
   npm install
   npx wrangler login
   ```

3. Complete any outstanding Google Analytics setup and the Meta app/Worker-secret setup in `worker/README.md`.
4. Redeploy the Worker with `npm run deploy` so the clip and protected social routes are available.
5. Confirm the deployed Worker origin matches the existing `workerBaseUrl` value in `js/config.js`, without a trailing slash.
6. Commit and push the static-site changes so GitHub Pages publishes them at `https://pacebrosvisuals.ca`.

The Worker configuration already binds `MEDIA_BUCKET` to the existing private `pace-bros-media` bucket and contains only browser-safe/static values. Google and Meta privileged values must be added with Wrangler as encrypted Worker secrets. Do not add a Supabase service-role key, database password, R2 S3 key, Google private key, Meta token, or OAuth secret to tracked files or browser code.

## Run locally

Serve the repository with any static HTTP server; no public-site build step is required. If local admin upload testing is needed, add the exact local HTTP origin temporarily to the Worker's comma-separated `ALLOWED_ORIGINS` value. Do not use `*`.

## MVP media boundary

Single-request uploads, including promotional clips, are capped at 95 MB; the existing multipart route continues to handle larger master-film MP4 files in independently bounded parts. Only published film rows are queried by the public catalogue, and generated R2 object names are unpredictable. Anyone who already knows an exact media key can use its public Worker URL; per-object draft authorization and transcoding remain intentionally deferred.
