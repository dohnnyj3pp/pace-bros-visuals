# Supabase Phase 2 setup

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
