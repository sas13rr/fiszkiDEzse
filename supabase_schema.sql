-- ============================================================================
-- FISZKI – NAUKA NIEMIECKIEGO: KOMPLETNY SKRYPT SQL DLA SUPABASE
-- ============================================================================
-- Instrukcja uruchomienia:
-- 1. Otwórz Supabase -> SQL Editor -> New query
-- 2. Wklej CAŁĄ zawartość tego pliku i kliknij "Run"
-- 3. (Zalecane dla logowania samym loginem bez klikania linku w mailu):
--    Wejdź w Authentication -> Providers -> Email i wyłącz "Confirm email"
-- ============================================================================

-- 1. TABELA PROFILI UCZNIÓW (powiązana 1:1 z auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_lower text not null unique,
  class_name text not null default 'Klasa',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(trim(username)) between 2 and 24),
  constraint profiles_class_length check (char_length(trim(class_name)) between 1 and 20)
);

-- 2. TABELA POSTĘPÓW UŻYTKOWNIKA (prywatne dane synchronizowane między urządzeniami)
create table if not exists public.user_progress (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  mastered integer[] not null default '{}',
  hard integer[] not null default '{}',
  xp integer not null default 0 check (xp >= 0),
  level integer not null default 1 check (level >= 1),
  streak integer not null default 0 check (streak >= 0),
  best_streak integer not null default 0 check (best_streak >= 0),
  last_study_date date,
  badges text[] not null default '{}',
  records jsonb not null default '{"matchBestSec": null, "articleBest": 0, "speedBest": 0, "scrambleTotal": 0, "quizBestPct": null, "typingBest": 0, "memoryBestSec": null, "listenBest": 0}'::jsonb,
  preferences jsonb not null default '{"soundEnabled": true, "autoSpeak": false, "plToDe": true, "collapsedChapters": []}'::jsonb,
  sync_version integer not null default 1 check (sync_version >= 1),
  last_reset_at timestamptz,
  updated_at timestamptz not null default now()
);

-- 3. PUBLICZNA TABELA RANKINGU KLASY (aktualizowana wyłącznie przez triggery DB!)
create table if not exists public.leaderboard_entries (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  username text not null,
  class_name text not null default 'Klasa',
  xp integer not null default 0,
  level integer not null default 1,
  streak integer not null default 0,
  best_streak integer not null default 0,
  mastered_count integer not null default 0,
  badges_count integer not null default 0,
  match_best_sec integer,
  article_best integer not null default 0,
  speed_best integer not null default 0,
  scramble_total integer not null default 0,
  quiz_best_pct integer,
  typing_best integer not null default 0,
  memory_best_sec integer,
  listen_best integer not null default 0,
  updated_at timestamptz not null default now()
);

-- Bezpieczne dodanie nowych kolumn, jeśli tabela była już wcześniej utworzona
alter table public.leaderboard_entries add column if not exists typing_best integer not null default 0;
alter table public.leaderboard_entries add column if not exists memory_best_sec integer;
alter table public.leaderboard_entries add column if not exists listen_best integer not null default 0;

-- Indeksy przyspieszające sortowanie rankingu klasy
create index if not exists idx_leaderboard_xp on public.leaderboard_entries (xp desc, mastered_count desc);
create index if not exists idx_leaderboard_streak on public.leaderboard_entries (streak desc, best_streak desc);
create index if not exists idx_leaderboard_mastered on public.leaderboard_entries (mastered_count desc, xp desc);
create index if not exists idx_leaderboard_class on public.leaderboard_entries (class_name, xp desc);

-- ============================================================================
-- 4. FUNKCJE I TRIGGERY AUTOMATYCZNE
-- ============================================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_user_progress_updated_at on public.user_progress;
create trigger trg_user_progress_updated_at
  before update on public.user_progress
  for each row execute function public.set_updated_at();

create or replace function public.sync_leaderboard_entry(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_prog public.user_progress%rowtype;
  v_match_sec integer;
  v_article integer;
  v_speed integer;
  v_scramble integer;
  v_quiz integer;
  v_typing integer;
  v_memory_sec integer;
  v_listen integer;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    return;
  end if;

  select * into v_prog from public.user_progress where user_id = p_user_id;

  v_match_sec  := nullif(v_prog.records->>'matchBestSec', '')::integer;
  v_article    := coalesce(nullif(v_prog.records->>'articleBest', '')::integer, 0);
  v_speed      := coalesce(nullif(v_prog.records->>'speedBest', '')::integer, 0);
  v_scramble   := coalesce(nullif(v_prog.records->>'scrambleTotal', '')::integer, 0);
  v_quiz       := nullif(v_prog.records->>'quizBestPct', '')::integer;
  v_typing     := coalesce(nullif(v_prog.records->>'typingBest', '')::integer, 0);
  v_memory_sec := nullif(v_prog.records->>'memoryBestSec', '')::integer;
  v_listen     := coalesce(nullif(v_prog.records->>'listenBest', '')::integer, 0);

  insert into public.leaderboard_entries (
    user_id, username, class_name, xp, level, streak, best_streak,
    mastered_count, badges_count, match_best_sec, article_best,
    speed_best, scramble_total, quiz_best_pct, typing_best,
    memory_best_sec, listen_best, updated_at
  ) values (
    v_profile.id, v_profile.username, v_profile.class_name,
    coalesce(v_prog.xp, 0), coalesce(v_prog.level, 1),
    coalesce(v_prog.streak, 0), coalesce(v_prog.best_streak, 0),
    coalesce(array_length(v_prog.mastered, 1), 0),
    coalesce(array_length(v_prog.badges, 1), 0),
    v_match_sec, v_article, v_speed, v_scramble, v_quiz,
    v_typing, v_memory_sec, v_listen, now()
  )
  on conflict (user_id) do update set
    username        = excluded.username,
    class_name      = excluded.class_name,
    xp              = excluded.xp,
    level           = excluded.level,
    streak          = excluded.streak,
    best_streak     = excluded.best_streak,
    mastered_count  = excluded.mastered_count,
    badges_count    = excluded.badges_count,
    match_best_sec  = excluded.match_best_sec,
    article_best    = excluded.article_best,
    speed_best      = excluded.speed_best,
    scramble_total  = excluded.scramble_total,
    quiz_best_pct   = excluded.quiz_best_pct,
    typing_best     = excluded.typing_best,
    memory_best_sec = excluded.memory_best_sec,
    listen_best     = excluded.listen_best,
    updated_at      = now();
end;
$$;

create or replace function public.trg_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_leaderboard_entry(new.id);
  return new;
end;
$$;

create or replace function public.trg_after_progress_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_leaderboard_entry(new.user_id);
  return new;
end;
$$;

drop trigger if exists trg_profiles_sync_lb on public.profiles;
create trigger trg_profiles_sync_lb
  after insert or update on public.profiles
  for each row execute function public.trg_after_profile_change();

drop trigger if exists trg_progress_sync_lb on public.user_progress;
create trigger trg_progress_sync_lb
  after insert or update on public.user_progress
  for each row execute function public.trg_after_progress_change();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw_name text;
  v_base_name text;
  v_final_name text;
  v_class text;
  v_suffix integer := 0;
begin
  v_raw_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Uczen'
  );
  v_base_name := left(regexp_replace(v_raw_name, '[^a-zA-Z0-9ąćęłńóśźżĄĆĘŁŃÓŚŹŻ _.-]', '', 'g'), 20);
  if char_length(trim(v_base_name)) < 2 then
    v_base_name := 'Uczen';
  end if;

  v_final_name := v_base_name;
  while exists (select 1 from public.profiles where username_lower = lower(v_final_name)) loop
    v_suffix := v_suffix + 1;
    v_final_name := left(v_base_name, 16) || '_' || v_suffix::text;
  end loop;

  v_class := coalesce(nullif(left(trim(new.raw_user_meta_data->>'class_name'), 20), ''), 'Klasa');

  insert into public.profiles (id, username, username_lower, class_name)
  values (new.id, v_final_name, lower(v_final_name), v_class)
  on conflict (id) do nothing;

  insert into public.user_progress (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  perform public.sync_leaderboard_entry(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_username_available(p_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from public.profiles where username_lower = lower(trim(p_username))
  );
$$;

grant execute on function public.is_username_available(text) to anon, authenticated;

-- Pozwala logować się samym loginem (nickiem) nawet jeśli konto założono z prawdziwym adresem e-mail
create or replace function public.resolve_login_email(p_identifier text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username_lower = lower(trim(p_identifier))
  limit 1;
$$;

grant execute on function public.resolve_login_email(text) to anon, authenticated;

-- ============================================================================
-- 5. UPRAWNIENIA ROW LEVEL SECURITY (RLS)
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.user_progress enable row level security;
alter table public.leaderboard_entries enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select to authenticated
  using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "progress_select_own" on public.user_progress;
create policy "progress_select_own"
  on public.user_progress for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "progress_insert_own" on public.user_progress;
create policy "progress_insert_own"
  on public.user_progress for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "progress_update_own" on public.user_progress;
create policy "progress_update_own"
  on public.user_progress for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "progress_delete_own" on public.user_progress;
create policy "progress_delete_own"
  on public.user_progress for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "leaderboard_select_all" on public.leaderboard_entries;
create policy "leaderboard_select_all"
  on public.leaderboard_entries for select to anon, authenticated
  using (true);

-- ============================================================================
-- 6. REALTIME (aktualizacje rankingu i postępów na żywo)
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leaderboard_entries'
  ) then
    alter publication supabase_realtime add table public.leaderboard_entries;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'user_progress'
  ) then
    alter publication supabase_realtime add table public.user_progress;
  end if;
end $$;
