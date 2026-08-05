-- Restore the missing public.error_log.severity column.
--
-- Migration 20260510120100_pipeline_watchdog.sql declared this column, but it
-- is absent from the live database: get_critical_alerts() fails with 42703
-- "column e.severity does not exist", and the freshly regenerated
-- src/integrations/supabase/types.ts lists error_log as
-- (id, function_name, error_message, context, created_at) only. Nothing ever
-- dropped it, so that migration's DDL did not land even though its cron job
-- (pipeline-watchdog-1h) did.
--
-- This broke the watchdog in BOTH directions:
--   - write: pipeline-watchdog inserts severity = 'critical' and discards the
--     result, so every alert it has raised was silently rejected by PostgREST.
--   - read:  get_critical_alerts filters on e.severity and throws.
--
-- Re-applies only the DDL, idempotently. The cron job and the function bodies
-- are already live and are deliberately left alone.

ALTER TABLE public.error_log
  ADD COLUMN IF NOT EXISTS severity text NOT NULL DEFAULT 'info';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'error_log_severity_check'
  ) THEN
    ALTER TABLE public.error_log
      ADD CONSTRAINT error_log_severity_check
      CHECK (severity IN ('info', 'warning', 'critical'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS error_log_severity_created_at_idx
  ON public.error_log (severity, created_at DESC);

-- Without this the column exists in Postgres but not in PostgREST's cached
-- schema, so the watchdog's insert keeps failing for the same reason.
notify pgrst, 'reload schema';

-- Verify after applying:
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'error_log' order by column_name;
--   select * from public.get_critical_alerts(24);
