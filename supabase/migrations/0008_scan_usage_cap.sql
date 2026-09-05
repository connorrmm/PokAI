-- A durable per-user daily cap on scans.
--
-- Every scan spends real money: about $0.0078 to Anthropic plus a card
-- lookup. `/api/identify` required no authentication at all and its only
-- control was an in-memory per-IP counter, which on Vercel means per
-- serverless instance and resets on every cold start. It raised the cost of
-- casual abuse and was never a quota -- lib/rate-limit.ts says so itself.
--
-- Enabling anonymous sign-ins did not create that exposure, but it does make
-- it scriptable, which is exactly why Supabase recommends CAPTCHA alongside
-- it. This is the half that belongs in our code: a cap that actually holds
-- because it lives in the database, shared by every instance.
--
-- Counting rather than rate-limiting, deliberately. A burst is normal -- a
-- collector photographing a binder scans fast for ten minutes. What must be
-- bounded is the DAY's total, because that is what maps to a bill.

create table if not exists scan_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  scans integer not null default 0,
  primary key (user_id, day)
);

alter table scan_usage enable row level security;

create policy "own usage read"   on scan_usage
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "own usage insert" on scan_usage
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "own usage update" on scan_usage
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Returns today's total AFTER counting this attempt. Atomic, so parallel
-- requests cannot both read the same number and each decide they are under
-- the cap. security invoker, so row-level security applies exactly as it
-- would to a direct write -- this must never become a way around it.
create or replace function bump_scan_usage()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare v_scans integer;
begin
  insert into public.scan_usage (user_id, day, scans)
  values ((select auth.uid()), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update
    set scans = public.scan_usage.scans + 1
  returning scans into v_scans;
  return v_scans;
end
$$;
