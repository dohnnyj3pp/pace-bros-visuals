# Supabase setup

The repository migration creates `public.films`, its `updated_at` trigger, the public-catalogue
index, grants, Row Level Security, and the two required access policies.

Apply it once before using the Film Library:

1. Open the existing `pace-bros-visuals` project in the Supabase dashboard.
2. Open **SQL Editor** and create a new query.
3. Paste the complete contents of
   `migrations/202608310001_create_films.sql` into the editor.
4. Select **Run** once and confirm the query completes without an error.
5. In **Table Editor**, confirm `public.films` exists and Row Level Security is enabled.

The migration assumes the existing `public.admin_users(user_id)` table and its self-read policy
from Phase 1 are already present. Do not add a `service_role` key or another secret to the static
site or Worker.

## Clips Library migration

Apply `migrations/202609050001_create_clips_library.sql` once after the films migration. It creates
the admin-only `public.clips` and `public.clip_captions` tables, indexes, timestamp triggers, and
Row Level Security policies. Its restrictive film foreign key prevents a parent film from being
deleted while promotional clips still belong to it.

The migration is intentionally not run automatically by this static-site repository. Paste its
complete contents into the Supabase SQL Editor and run it once before using **Admin → Clips**.

## Social Connections migration

Apply `migrations/202609050002_create_social_connections.sql` once after the earlier migrations.
It creates generic `public.social_connections` storage for one selected external account per row,
including an AES-GCM ciphertext envelope, token expiry, scopes, sanitized provider metadata, and
connection timestamps. The Meta implementation stores a Facebook Page row and keeps the linked
Instagram Professional identity in its non-secret metadata.

Only authenticated UUIDs present in `public.admin_users` receive access through Row Level
Security; anonymous roles receive none. Admin browser code does not query this table. The Worker
uses the current administrator's Supabase token for RLS-protected persistence and returns only a
sanitized projection. Run the migration once before using **Admin → Social Media**.
