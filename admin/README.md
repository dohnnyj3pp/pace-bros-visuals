# Pace Bros Visuals admin — Phase 1 authentication

The existing admin workspace remains a static, unlinked planning shell. Phase 1 adds Supabase email/password authentication and an `admin_users` authorization check before the workspace is revealed or initialized.

Uploads, storage, AI assistance, social integrations, scheduling, publishing, and analytics are intentionally not connected.

## Browser-safe configuration

The shared client uses only:

- the Pace Bros Visuals Supabase project URL;
- the browser-safe `sb_publishable_...` API key;
- Supabase JS v2, exact-pinned to `2.112.4` with Subresource Integrity.

The publishable key is expected to be visible in this static site. Security comes from Supabase Auth, the matching UUID authorization row, database grants, and Row Level Security. Never add a secret key, `service_role` key, database password, user password, or private backend credential to this repository.

## Authentication and authorization flow

1. `admin/login.html` calls `supabase.auth.signInWithPassword()` with the submitted email and password.
2. The authenticated user's UUID is read from the validated Supabase user.
3. The browser queries `public.admin_users` for that exact `user_id` and selects only `user_id` and `display_name`.
4. Row Level Security must allow an authenticated user to read only their own authorization row.
5. A matching row allows navigation to `/admin/`.
6. The admin page repeats the session and authorization check on every load before revealing or initializing the existing workspace.
7. A missing authorization row signs the user out locally and denies access.
8. A network or authorization-query error keeps the workspace hidden and offers a retry.

There is no Sign Up or self-promotion flow. The browser never inserts, updates, deletes, or upserts `admin_users` records.

## GitHub Pages paths

All site links and redirects are document-relative so the repository prefix is preserved:

- public site: `https://dohnnyj3pp.github.io/pace-bros-visuals/`
- login: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/login.html`
- protected admin: `https://dohnnyj3pp.github.io/pace-bros-visuals/admin/`

The older `js/api.js` file is deliberately not loaded in Phase 1. Its root-relative `/api/admin` placeholder is not compatible with GitHub Pages and belongs to a future backend phase.

## Static-host security boundary

The HTML, CSS, JavaScript, and publishable key are public. Hiding the admin shell prevents a UI flash and blocks local initialization before authorization, but it is not the data-security boundary. Every future database or storage operation must have its own least-privilege RLS policy.

Supabase sessions persist in browser storage so refreshes can restore a valid session. Because GitHub Pages projects under the same `dohnnyj3pp.github.io` host share an origin, a dedicated custom domain would provide stronger session isolation in a future infrastructure phase.
