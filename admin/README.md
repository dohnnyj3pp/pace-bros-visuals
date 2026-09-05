# Pace Bros Visuals studio administration

The protected admin workspace is a vanilla HTML/CSS/JavaScript film CMS and promotional Clips Library. It preserves the existing Supabase email/password login, persistent session, `admin_users` authorization check, and Logout flow.

## Film workflow

Authorized administrators can:

- list every row in `public.films`;
- add or edit a film's title, description, poster, MP4, publication state, and sort order;
- save a film as a draft or publish it;
- return a published film to draft status;
- replace media while retaining existing object keys when no replacement is selected.

New poster and video files are sent directly to the Cloudflare Worker as raw request bodies. The browser includes the current Supabase access token and a generated film UUID. After both required uploads succeed, their returned R2 object keys are saved in the Supabase film row. Publishing is blocked until both a poster key and video key exist.

The production-pass request limit is 95 MB per file. MP4 is accepted for video; JPEG, PNG, and WebP are accepted for posters.

## Clips Library workflow

Authorized administrators can load all films into the parent-film selector, upload a finished MP4 clip, capture lightweight browser metadata, and save internal notes, active/archived status, tags, and an ordered bank of reusable captions. Existing clips can be edited, activated or archived, and deleted with explicit confirmation.

Clip MP4s use authenticated `POST /upload/clip` and are stored in private R2 at `films/<film-id>/clips/<random-uuid>.mp4`. Deletion removes the R2 object first, then deletes the Supabase clip row; its captions cascade in the database. The parent film is locked after clip creation so its enforced storage path remains consistent. Clips use the bounded single-request route and must be no larger than 95 MB; master-film multipart behavior is unchanged.

Run `../supabase/migrations/202609050001_create_clips_library.sql` once and redeploy the Worker before using this workspace.

## Analytics workspace

The permanent **Insights → Analytics** view requests `GET /admin/analytics` from the configured Worker only when an administrator opens it or selects **Refresh**. The request carries the current Supabase access token as a Bearer token; the Worker remains responsible for validating the session and `admin_users` membership before contacting Google Analytics. The client consumes the Worker's normalized realtime, historical, top-content, and traffic-source response without mock values or aggressive polling. Loading, unconfigured, authorization, and temporary API failures stay contained inside the Analytics view so the Films workflow remains usable. No Google property ID, OAuth secret, service-account credential, or private Google configuration belongs in Admin HTML or JavaScript.

## Browser-safe configuration

The shared `../js/config.js` file exposes `window.PaceBrosConfig.workerBaseUrl`. Replace its placeholder with the deployed Worker origin before testing uploads. Do not add a trailing slash.

The Supabase project URL and browser-safe publishable key remain in `../js/supabase-client.js`. Never add a secret key, `service_role` key, database password, R2 S3 credential, user password, or other private credential to this repository.

## Security boundary

The admin page is revealed only after the existing authenticated user's UUID has a matching `public.admin_users` row. Database writes are additionally protected by the `films`, `clips`, and `clip_captions` Row Level Security policies. The Worker independently validates the Bearer token and administrator membership before uploads or deletes. Frontend checks are workflow safeguards, not the authorization boundary.

## GitHub Pages paths

All scripts, styles, links, and redirects remain document-relative so the project prefix is preserved:

- public site: `https://dohnnyj3pp.github.io/pace-bros-visuals/`
- login: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/login.html`
- protected admin: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/`
