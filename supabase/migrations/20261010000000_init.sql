-- =====================================================================
-- Souvenir: initial schema
-- Auth = Clerk (native third-party auth). User ids are TEXT (user_xxx),
-- read in policies via auth.jwt()->>'sub'.
-- =====================================================================

create extension if not exists postgis with schema extensions;

create or replace function public.requesting_user_id()
returns text language sql stable as $$ select auth.jwt()->>'sub' $$;

-- ---------- enums ----------
create type souvenir_type   as enum ('poem','essay','playlist','design','other');
create type souvenir_status as enum ('active','paused','expired','removed');
create type report_reason   as enum ('unsafe_location','inappropriate','object_gone','spam','other');

-- ---------- profiles ----------
create table public.profiles (
  id          text primary key default public.requesting_user_id(),
  username    text unique not null check (username ~ '^[a-zA-Z0-9_]{3,20}$'),
  avatar_url  text,
  bio         text check (char_length(bio) <= 160),
  interests   text[] not null default '{}',
  is_adult    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- souvenirs (public discovery data only) ----------
create table public.souvenirs (
  id              uuid primary key default gen_random_uuid(),
  creator_id      text not null references public.profiles(id) on delete cascade,
  type            souvenir_type not null,
  tag             text not null,
  teaser          text not null check (char_length(teaser) <= 140),
  clue_hint       text not null,                       -- vague, tier-1 clue
  approx_location geography(point, 4326) not null,     -- fuzzed 50-200 m
  claim_limit     int check (claim_limit is null or claim_limit > 0), -- null = unlimited
  claims_count    int not null default 0,
  status          souvenir_status not null default 'active',
  created_at      timestamptz not null default now(),
  expires_at      timestamptz
);
create index souvenirs_location_idx on public.souvenirs using gist (approx_location);
create index souvenirs_creator_idx  on public.souvenirs (creator_id);

-- ---------- private data: exact location, object photo, later clues ----------
create table public.souvenir_private (
  souvenir_id       uuid primary key references public.souvenirs(id) on delete cascade,
  location          geography(point, 4326) not null,   -- exact
  object_photo_path text not null,
  clue_position     text,
  clue_landmark     text
);

-- ---------- the actual gift, locked until claimed ----------
create table public.souvenir_contents (
  souvenir_id  uuid primary key references public.souvenirs(id) on delete cascade,
  title        text,
  body         text,          -- poem / essay text
  external_url text,          -- playlist link
  art_path     text           -- storage path for design/art
);

-- ---------- claims ----------
create table public.claims (
  id                      uuid primary key default gen_random_uuid(),
  souvenir_id             uuid not null references public.souvenirs(id) on delete cascade,
  finder_id               text not null references public.profiles(id) on delete cascade,
  verification_photo_path text,
  claimed_at              timestamptz not null default now(),
  unique (souvenir_id, finder_id)
);
create index claims_finder_idx on public.claims (finder_id);

-- ---------- reactions / saved / reports ----------
create table public.reactions (
  souvenir_id uuid not null references public.souvenirs(id) on delete cascade,
  user_id     text not null references public.profiles(id) on delete cascade,
  emoji       text not null default '❤️',
  note        text check (char_length(note) <= 280),
  created_at  timestamptz not null default now(),
  primary key (souvenir_id, user_id)
);

create table public.saved_souvenirs (
  user_id     text not null references public.profiles(id) on delete cascade,
  souvenir_id uuid not null references public.souvenirs(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, souvenir_id)
);

create table public.reports (
  id          uuid primary key default gen_random_uuid(),
  souvenir_id uuid not null references public.souvenirs(id) on delete cascade,
  reporter_id text not null references public.profiles(id) on delete cascade,
  reason      report_reason not null,
  details     text,
  created_at  timestamptz not null default now()
);

-- =====================================================================
-- Row level security
-- =====================================================================
alter table public.profiles          enable row level security;
alter table public.souvenirs         enable row level security;
alter table public.souvenir_private  enable row level security;
alter table public.souvenir_contents enable row level security;
alter table public.claims            enable row level security;
alter table public.reactions         enable row level security;
alter table public.saved_souvenirs   enable row level security;
alter table public.reports           enable row level security;

-- profiles
create policy "profiles readable"   on public.profiles for select to authenticated using (true);
create policy "profiles insert own" on public.profiles for insert to authenticated
  with check (id = public.requesting_user_id());
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = public.requesting_user_id());

-- souvenirs: inserts happen through create_souvenir(); updates limited to a few columns
create policy "souvenirs visible" on public.souvenirs for select to authenticated
  using (status = 'active' or creator_id = public.requesting_user_id());
create policy "souvenirs update own" on public.souvenirs for update to authenticated
  using (creator_id = public.requesting_user_id());
create policy "souvenirs delete own" on public.souvenirs for delete to authenticated
  using (creator_id = public.requesting_user_id());
revoke update on public.souvenirs from authenticated;
grant  update (status, teaser, tag, clue_hint) on public.souvenirs to authenticated;

-- private data: creator only (edge functions use the service role)
create policy "private creator read" on public.souvenir_private for select to authenticated
  using (exists (select 1 from public.souvenirs s
                 where s.id = souvenir_id and s.creator_id = public.requesting_user_id()));

-- contents: creator or someone who has claimed it
create policy "contents creator or claimer" on public.souvenir_contents for select to authenticated
  using (
    exists (select 1 from public.souvenirs s
            where s.id = souvenir_contents.souvenir_id and s.creator_id = public.requesting_user_id())
    or exists (select 1 from public.claims c
            where c.souvenir_id = souvenir_contents.souvenir_id and c.finder_id = public.requesting_user_id())
  );

-- claims: no insert policy on purpose, only claim_souvenir() (service role) writes
create policy "claims finder or creator read" on public.claims for select to authenticated
  using (
    finder_id = public.requesting_user_id()
    or exists (select 1 from public.souvenirs s
               where s.id = claims.souvenir_id and s.creator_id = public.requesting_user_id())
  );

-- reactions: only people who claimed can react
create policy "reactions read" on public.reactions for select to authenticated
  using (
    user_id = public.requesting_user_id()
    or exists (select 1 from public.souvenirs s
               where s.id = reactions.souvenir_id and s.creator_id = public.requesting_user_id())
  );
create policy "reactions insert claimer" on public.reactions for insert to authenticated
  with check (
    user_id = public.requesting_user_id()
    and exists (select 1 from public.claims c
                where c.souvenir_id = reactions.souvenir_id and c.finder_id = public.requesting_user_id())
  );
create policy "reactions update own" on public.reactions for update to authenticated
  using (user_id = public.requesting_user_id());
create policy "reactions delete own" on public.reactions for delete to authenticated
  using (user_id = public.requesting_user_id());

-- saved
create policy "saved own all" on public.saved_souvenirs for all to authenticated
  using (user_id = public.requesting_user_id())
  with check (user_id = public.requesting_user_id());

-- reports
create policy "reports insert own" on public.reports for insert to authenticated
  with check (reporter_id = public.requesting_user_id());
create policy "reports read own" on public.reports for select to authenticated
  using (reporter_id = public.requesting_user_id());

-- =====================================================================
-- Functions
-- =====================================================================

-- Create a souvenir (3 tables at once). Fuzzes the public location server-side.
create or replace function public.create_souvenir(
  p_type souvenir_type, p_tag text, p_teaser text, p_clue_hint text,
  p_clue_position text, p_clue_landmark text,
  p_lat double precision, p_lng double precision,
  p_claim_limit int, p_object_photo_path text,
  p_title text, p_body text, p_external_url text, p_art_path text
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid   text := public.requesting_user_id();
  v_id    uuid;
  v_exact geography;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  v_exact := st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography;

  insert into public.souvenirs (creator_id, type, tag, teaser, clue_hint, approx_location, claim_limit)
  values (v_uid, p_type, p_tag, p_teaser, p_clue_hint,
          st_project(v_exact, 50 + random() * 150, radians(random() * 360)),
          p_claim_limit)
  returning id into v_id;

  insert into public.souvenir_private (souvenir_id, location, object_photo_path, clue_position, clue_landmark)
  values (v_id, v_exact, p_object_photo_path, p_clue_position, p_clue_landmark);

  insert into public.souvenir_contents (souvenir_id, title, body, external_url, art_path)
  values (v_id, p_title, p_body, p_external_url, p_art_path);

  return v_id;
end $$;

-- Souvenirs within a radius (max 5 km), nearest first
create or replace function public.nearby_souvenirs(
  p_lat double precision, p_lng double precision, p_radius_m int default 5000
) returns table (
  id uuid, creator_id text, type souvenir_type, tag text, teaser text, clue_hint text,
  claim_limit int, claims_count int, distance_m double precision,
  lat double precision, lng double precision, claimed boolean
)
language sql stable set search_path = public, extensions as $$
  select s.id, s.creator_id, s.type, s.tag, s.teaser, s.clue_hint,
         s.claim_limit, s.claims_count,
         st_distance(s.approx_location, me.g),
         st_y(s.approx_location::geometry),
         st_x(s.approx_location::geometry),
         exists (select 1 from public.claims c
                 where c.souvenir_id = s.id and c.finder_id = public.requesting_user_id())
  from public.souvenirs s,
       (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g) me
  where s.status = 'active'
    and st_dwithin(s.approx_location, me.g, least(p_radius_m, 5000))
  order by st_distance(s.approx_location, me.g)
$$;

-- Atomic claim. Called ONLY by the edge function (service role) after it has
-- checked the 1-minute window and the photo match.
create or replace function public.claim_souvenir(
  p_souvenir uuid, p_finder text, p_lat double precision, p_lng double precision, p_photo_path text
) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  s     public.souvenirs%rowtype;
  v_loc geography;
begin
  select * into s from public.souvenirs where id = p_souvenir for update;  -- row lock = no race
  if not found or s.status <> 'active' then return 'not_active'; end if;
  if s.creator_id = p_finder then return 'own_souvenir'; end if;
  if exists (select 1 from public.claims where souvenir_id = p_souvenir and finder_id = p_finder) then
    return 'already_claimed';
  end if;
  if s.claim_limit is not null and s.claims_count >= s.claim_limit then return 'full'; end if;

  select location into v_loc from public.souvenir_private where souvenir_id = p_souvenir;
  if not st_dwithin(v_loc, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography, 50) then
    return 'too_far';
  end if;

  insert into public.claims (souvenir_id, finder_id, verification_photo_path)
  values (p_souvenir, p_finder, p_photo_path);
  update public.souvenirs set claims_count = claims_count + 1 where id = p_souvenir;
  return 'ok';
end $$;

revoke all on function public.claim_souvenir(uuid, text, double precision, double precision, text)
  from public, anon, authenticated;
grant execute on function public.claim_souvenir(uuid, text, double precision, double precision, text)
  to service_role;

revoke all on function public.create_souvenir(souvenir_type, text, text, text, text, text,
  double precision, double precision, int, text, text, text, text, text) from public, anon;
grant execute on function public.create_souvenir(souvenir_type, text, text, text, text, text,
  double precision, double precision, int, text, text, text, text, text) to authenticated;

-- =====================================================================
-- Storage buckets + policies. Path convention: {user_id}/{souvenir_id}/{file}
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('avatars',       'avatars',       true),
  ('object-photos', 'object-photos', false),   -- creator's reference photo
  ('souvenir-art',  'souvenir-art',  false),   -- locked until claimed
  ('claim-photos',  'claim-photos',  false)    -- written by edge function only
on conflict (id) do nothing;

create policy "avatars write own" on storage.objects for all to authenticated
  using      (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.requesting_user_id())
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = public.requesting_user_id());

create policy "object photos own" on storage.objects for all to authenticated
  using      (bucket_id = 'object-photos' and (storage.foldername(name))[1] = public.requesting_user_id())
  with check (bucket_id = 'object-photos' and (storage.foldername(name))[1] = public.requesting_user_id());

create policy "art upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'souvenir-art' and (storage.foldername(name))[1] = public.requesting_user_id());

create policy "art read creator or claimer" on storage.objects for select to authenticated
  using (
    bucket_id = 'souvenir-art' and (
      (storage.foldername(name))[1] = public.requesting_user_id()
      or exists (select 1 from public.claims c
                 where c.souvenir_id::text = (storage.foldername(name))[2]
                   and c.finder_id = public.requesting_user_id())
    )
  );
