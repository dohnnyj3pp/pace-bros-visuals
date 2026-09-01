# Pace Bros Visuals film administration

The protected admin workspace is a vanilla HTML/CSS/JavaScript film CMS. It preserves the existing Supabase email/password login, persistent session, `admin_users` authorization check, and Logout flow.

## Film workflow

Authorized administrators can:

- list every row in `public.films`;
- add or edit a film's title, description, poster, MP4, publication state, and sort order;
- save a film as a draft or publish it;
- return a published film to draft status;
- replace media while retaining existing object keys when no replacement is selected.

New poster and video files are sent directly to the Cloudflare Worker as raw request bodies. The browser includes the current Supabase access token and a generated film UUID. After both required uploads succeed, their returned R2 object keys are saved in the Supabase film row. Publishing is blocked until both a poster key and video key exist.

The production-pass request limit is 95 MB per file. MP4 is accepted for video; JPEG, PNG, and WebP are accepted for posters.

## Browser-safe configuration

The shared `../js/config.js` file exposes `window.PaceBrosConfig.workerBaseUrl`. Replace its placeholder with the deployed Worker origin before testing uploads. Do not add a trailing slash.

The Supabase project URL and browser-safe publishable key remain in `../js/supabase-client.js`. Never add a secret key, `service_role` key, database password, R2 S3 credential, user password, or other private credential to this repository.

## Security boundary

The admin page is revealed only after the existing authenticated user's UUID has a matching `public.admin_users` row. Database writes are additionally protected by the `films` Row Level Security policies. The Worker independently validates the Bearer token and administrator membership before uploads or deletes. Frontend checks are workflow safeguards, not the authorization boundary.

## GitHub Pages paths

All scripts, styles, links, and redirects remain document-relative so the project prefix is preserved:

- public site: `https://dohnnyj3pp.github.io/pace-bros-visuals/`
- login: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/login.html`
- protected admin: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/`
