-- ingest_vendor_status_snapshots() is SECURITY DEFINER and only meant for the
-- vendor-status-ingest-6h pg_cron job (runs as postgres). The earlier
-- REVOKE ... FROM PUBLIC left Supabase's direct anon/authenticated grants in
-- place, so anon could trigger ingestion early. Applied live 2026-09-25.
REVOKE EXECUTE ON FUNCTION public.ingest_vendor_status_snapshots() FROM anon, authenticated, PUBLIC;
