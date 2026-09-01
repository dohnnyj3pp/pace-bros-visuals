-- Pace Bros Visuals film catalogue and administrator-only content management.
-- Apply once with the Supabase SQL editor or the Supabase CLI.

create table public.films (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  video_key text,
  poster_key text,
  published boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint films_published_media_required
    check (not published or (video_key is not null and poster_key is not null))
);

create index films_public_catalogue_idx
  on public.films (sort_order asc, created_at asc, id asc)
  where published = true;

create or replace function public.set_films_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger films_set_updated_at
before update on public.films
for each row
execute function public.set_films_updated_at();

alter table public.films enable row level security;

revoke all on table public.films from anon, authenticated;
grant select on table public.films to anon;
grant select, insert, update, delete on table public.films to authenticated;

create policy "Published films are publicly readable"
on public.films
for select
to anon
using (published = true);

create policy "Administrators can manage films"
on public.films
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
