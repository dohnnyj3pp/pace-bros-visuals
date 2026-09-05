-- Pace Bros Visuals server-managed social account connections.
-- Apply once with the Supabase SQL editor or the Supabase CLI.

create table public.social_connections (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  platform text not null,
  external_account_id text not null,
  display_name text not null,
  username text,
  encrypted_credentials jsonb not null,
  token_expires_at timestamptz,
  scopes text[] not null default '{}'::text[],
  status text not null default 'connected',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_connections_created_by_fkey
    foreign key (created_by)
    references auth.users (id)
    on delete set null,
  constraint social_connections_provider_format
    check (provider ~ '^[a-z][a-z0-9_-]*$'),
  constraint social_connections_platform_format
    check (platform ~ '^[a-z][a-z0-9_-]*$'),
  constraint social_connections_external_account_id_not_blank
    check (length(btrim(external_account_id)) > 0),
  constraint social_connections_display_name_not_blank
    check (length(btrim(display_name)) > 0),
  constraint social_connections_username_not_blank
    check (username is null or length(btrim(username)) > 0),
  constraint social_connections_encrypted_credentials_object
    check (
      jsonb_typeof(encrypted_credentials) = 'object'
      and encrypted_credentials <> '{}'::jsonb
    ),
  constraint social_connections_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint social_connections_status_valid
    check (status in ('connected', 'reconnect_required')),
  constraint social_connections_provider_account_unique
    unique (provider, platform, external_account_id)
);

create index social_connections_provider_status_idx
  on public.social_connections (provider, status, updated_at desc, id);

create or replace function public.set_social_connections_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger social_connections_set_updated_at
before update on public.social_connections
for each row
execute function public.set_social_connections_updated_at();

alter table public.social_connections enable row level security;

revoke all on table public.social_connections from anon, authenticated;
grant insert, update, delete on table public.social_connections to authenticated;
grant select (
  id,
  provider,
  platform,
  external_account_id,
  display_name,
  username,
  token_expires_at,
  scopes,
  status,
  metadata,
  created_by,
  connected_at,
  created_at,
  updated_at
) on table public.social_connections to authenticated;

create policy "Administrators can manage social connections"
on public.social_connections
for all
to authenticated
using (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1
    from public.admin_users
    where admin_users.user_id = (select auth.uid())
  )
);
