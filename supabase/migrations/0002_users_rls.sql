-- User-owned data. Every table here is private to its owner.
-- RLS is the only thing between one user's collection and everyone else's.
-- Applied to project yycsgtsvkhguzihyxtur on 2026-08-31, and verified by test
-- (see docs/STATUS.md section 8) -- not assumed.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text, created_at timestamptz not null default now()
);

create table if not exists collections (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null references cards(id),
  quantity integer not null default 1 check (quantity > 0),
  condition text, acquired_at timestamptz, notes text,
  created_at timestamptz not null default now()
);
create index if not exists collections_user_idx on collections (user_id);

-- chosen_card_id is null while a scan is unresolved -- the "never guess" case
-- where the user was shown candidates and has not yet picked. Storing null
-- rather than a guess is the point.
create table if not exists scans (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text, model_output jsonb, confidence numeric(5,2),
  chosen_card_id text references cards(id),
  auto_accepted boolean not null default false,
  error_detail text, created_at timestamptz not null default now()
);
create index if not exists scans_user_idx on scans (user_id, created_at desc);

-- Training signal: a user fixing a misidentification is data about which
-- cards the scanner confuses. Cheap now, unrecoverable later.
create table if not exists corrections (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scan_id bigint references scans(id) on delete cascade,
  predicted_card_id text references cards(id),
  correct_card_id text not null references cards(id),
  created_at timestamptz not null default now()
);
create index if not exists corrections_pair_idx on corrections (predicted_card_id, correct_card_id);

alter table profiles enable row level security;
alter table collections enable row level security;
alter table scans enable row level security;
alter table corrections enable row level security;

create policy "own profile read"   on profiles for select to authenticated using ((select auth.uid()) = id);
create policy "own profile write"  on profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
create policy "own profile insert" on profiles for insert to authenticated with check ((select auth.uid()) = id);

create policy "own collection read"   on collections for select to authenticated using ((select auth.uid()) = user_id);
create policy "own collection insert" on collections for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own collection update" on collections for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own collection delete" on collections for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own scans read"   on scans for select to authenticated using ((select auth.uid()) = user_id);
create policy "own scans insert" on scans for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own scans update" on scans for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own scans delete" on scans for delete to authenticated using ((select auth.uid()) = user_id);

create policy "own corrections read"   on corrections for select to authenticated using ((select auth.uid()) = user_id);
create policy "own corrections insert" on corrections for insert to authenticated with check ((select auth.uid()) = user_id);

create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data->>'display_name')
  on conflict (id) do nothing;
  return new;
end; $$;
-- Signup trigger only: nothing should call it over the REST API.
revoke execute on function public.handle_new_user() from anon, authenticated, public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();
