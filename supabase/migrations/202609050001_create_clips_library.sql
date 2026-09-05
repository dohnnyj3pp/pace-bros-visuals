-- Pace Bros Visuals promotional Clips Library.
-- Apply once with the Supabase SQL editor or the Supabase CLI.

create table public.clips (
  id uuid primary key default gen_random_uuid(),
  film_id uuid not null,
  name text not null,
  video_key text not null,
  original_filename text,
  notes text,
  status text not null default 'active',
  duration_seconds numeric,
  width integer,
  height integer,
  aspect_ratio text,
  tags text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clips_film_id_fkey
    foreign key (film_id)
    references public.films (id)
    on delete restrict,
  constraint clips_name_not_blank
    check (length(btrim(name)) > 0),
  constraint clips_video_key_not_blank
    check (length(btrim(video_key)) > 0),
  constraint clips_video_key_matches_film
    check (
      video_key ~ (
        '^films/' || film_id::text ||
        '/clips/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]mp4$'
      )
    ),
  constraint clips_status_valid
    check (status in ('active', 'archived')),
  constraint clips_duration_seconds_positive
    check (duration_seconds is null or duration_seconds > 0),
  constraint clips_width_positive
    check (width is null or width > 0),
  constraint clips_height_positive
    check (height is null or height > 0),
  constraint clips_dimensions_complete
    check ((width is null) = (height is null)),
  constraint clips_aspect_ratio_not_blank
    check (aspect_ratio is null or length(btrim(aspect_ratio)) > 0)
);

create table public.clip_captions (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid not null,
  caption text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clip_captions_clip_id_fkey
    foreign key (clip_id)
    references public.clips (id)
    on delete cascade,
  constraint clip_captions_caption_not_blank
    check (length(btrim(caption)) > 0),
  constraint clip_captions_sort_order_nonnegative
    check (sort_order >= 0)
);

create index clips_film_id_idx
  on public.clips (film_id);

create index clips_status_created_at_idx
  on public.clips (status, created_at desc, id);

create index clip_captions_clip_id_sort_order_idx
  on public.clip_captions (clip_id, sort_order asc, created_at asc, id asc);

create or replace function public.set_clips_library_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger clips_set_updated_at
before update on public.clips
for each row
execute function public.set_clips_library_updated_at();

create trigger clip_captions_set_updated_at
before update on public.clip_captions
for each row
execute function public.set_clips_library_updated_at();

alter table public.clips enable row level security;
alter table public.clip_captions enable row level security;

revoke all on table public.clips from anon, authenticated;
revoke all on table public.clip_captions from anon, authenticated;

grant select, insert, update, delete on table public.clips to authenticated;
grant select, insert, update, delete on table public.clip_captions to authenticated;

create policy "Administrators can manage clips"
on public.clips
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

create policy "Administrators can manage clip captions"
on public.clip_captions
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
