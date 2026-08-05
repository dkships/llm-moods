-- Scheduler token auth for pg_cron -> edge function calls.
--
-- Problem: every gated edge function runs with verify_jwt = false, and
-- isSchedulerRequest() only inspected the request body. The accepted body shape
-- is documented in this public repo, so any unauthenticated caller could POST
-- {"scheduler":"pg_cron","pipeline":"scrape-twitter"} and trigger the scrapers
-- (Apify spend), drain-classification-queue (Anthropic spend), or
-- cleanup-old-posts. Verified reachable without an Authorization header.
--
-- Fix: pg_cron additionally sends a secret token that only the database and the
-- service role can read. The token is generated here at apply time, so no
-- secret ever lands in this public repo.
--
-- ORDERING: apply this migration BEFORE redeploying the edge functions.
-- The currently-deployed functions ignore an unknown "token" field, so this is
-- backward compatible and lands with zero downtime. Shipping the token check
-- first would 403 every scheduled job.

create table if not exists public.scheduler_tokens (
  id          integer primary key,
  token       text not null,
  created_at  timestamptz not null default now(),
  rotated_at  timestamptz not null default now()
);

alter table public.scheduler_tokens enable row level security;

-- No policies at all: RLS with zero policies denies anon and authenticated
-- outright. service_role has BYPASSRLS, which is how the edge functions read it.
revoke all on public.scheduler_tokens from anon, authenticated;
grant select on public.scheduler_tokens to service_role;

-- gen_random_uuid() is core Postgres 13+, so this needs no pgcrypto.
-- Two v4 UUIDs with dashes stripped = 64 hex chars.
insert into public.scheduler_tokens (id, token)
values (
  1,
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (id) do nothing;

-- Patch the LIVE cron jobs in place.
--
-- Deliberately NOT re-declaring jobs with cron.schedule: live cron has diverged
-- from this migration history, so re-declaring would overwrite the real
-- schedule with stale definitions.
--
-- Idempotent and re-runnable: strips any existing token before injecting the
-- current one, so re-running this block after updating the token row is also
-- the rotation procedure.
do $$
declare
  tok     text;
  job     record;
  new_cmd text;
  patched integer := 0;
  scanned integer := 0;
begin
  select token into tok from public.scheduler_tokens where id = 1;
  if tok is null or length(tok) < 16 then
    raise exception 'scheduler_tokens row id=1 missing or too short; aborting';
  end if;

  for job in
    select jobid, jobname, command
    from cron.job
    where command like '%"scheduler":"pg_cron"%'
  loop
    scanned := scanned + 1;

    new_cmd := regexp_replace(job.command, ',\s*"token"\s*:\s*"[^"]*"', '', 'g');
    new_cmd := replace(
      new_cmd,
      '"scheduler":"pg_cron"',
      '"scheduler":"pg_cron","token":"' || tok || '"'
    );

    if new_cmd is distinct from job.command then
      perform cron.alter_job(job_id := job.jobid, command := new_cmd);
      patched := patched + 1;
    end if;
  end loop;

  raise notice 'scheduler token: scanned % job(s), patched %', scanned, patched;

  if scanned = 0 then
    raise exception 'no pg_cron scheduler jobs found; refusing to leave the pipeline unauthenticated';
  end if;
end
$$;

-- The edge functions read this table over PostgREST, which caches the schema.
-- Without this the first read 404s and the gate fails closed on every job.
notify pgrst, 'reload schema';

-- Verify after applying:
--   select jobname, command like '%"token":"%' as has_token
--   from cron.job where command like '%"scheduler":"pg_cron"%' order by jobname;
