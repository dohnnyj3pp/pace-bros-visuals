# Pace Bros Visuals

Vanilla HTML, CSS, and JavaScript for the Pace Bros Visuals public site and protected film administration workspace.

## Phase 2 architecture

- `index.html`, `css/main.css`, `js/main.js` — cinematic public site, dynamic Selected Works catalogue, and native HTML5 film player.
- `admin/` — existing Supabase-authenticated administration plus the film library and add/edit workflow.
- `js/config.js` — the single browser-side Cloudflare Worker base URL setting.
- `js/supabase-client.js`, `js/auth.js` — shared browser-safe Supabase client and existing administrator authorization flow.
- `supabase/migrations/202608310001_create_films.sql` — `public.films`, update trigger, grants, indexes, and Row Level Security policies.
- `worker/` — Cloudflare Worker for authenticated uploads/deletes and public streaming from the private `pace-bros-media` R2 bucket.

The public site and admin remain static GitHub Pages files. Supabase stores film metadata; the private R2 bucket stores poster and MP4 objects; the Worker is the only media bridge.

## One-time production setup

1. In the Pace Bros Supabase SQL editor, run `supabase/migrations/202608310001_create_films.sql` once.
2. From `worker/`, install dependencies, authenticate Wrangler, and deploy:

   ```powershell
   npm install
   npx wrangler login
   npm run deploy
   ```

3. Copy the deployed Worker origin into the `workerBaseUrl` value in `js/config.js`, without a trailing slash.
4. Commit and push the static-site changes so GitHub Pages publishes them.

The Worker configuration already binds `MEDIA_BUCKET` to the existing private `pace-bros-media` bucket and contains only the browser-safe Supabase project URL and publishable key. Do not add a Supabase secret/service-role key, database password, R2 S3 key, or other private credential.

## Run locally

Serve the repository with any static HTTP server; no public-site build step is required. If local admin upload testing is needed, add the exact local HTTP origin temporarily to the Worker's comma-separated `ALLOWED_ORIGINS` value. Do not use `*`.

## MVP media boundary

Uploads are single-request files capped at 95 MB. Only published rows are queried by the public catalogue, and generated R2 object names are unpredictable. Anyone who already knows an exact media key can use its public Worker URL; per-object draft authorization, multipart upload, and transcoding are intentionally deferred.
