import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { internalOnlyResponse, isInternalServiceRequest, readJsonBody } from "../_shared/runtime.ts";
import {
  claimServiceLock,
  refreshScores,
  releaseServiceLock,
  type ModelRow,
  type ScoreUpsertRow,
} from "../_shared/score-refresh.ts";

// Cron currently calls this function with the public anon JWT. Keep handler
// auth compatible with pg_cron and use service-role credentials only from env.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExistingDailyScoreRow {
  model_id: string;
  period_start: string;
  score: number | null;
  total_posts: number | null;
  eligible_posts: number | null;
  score_basis_status: string | null;
  queued_posts?: number | null;
  unclassified_posts?: number | null;
}

interface BackfillDiffQueryBuilder {
  select: (columns: string) => BackfillDiffQueryBuilder;
  eq: (column: string, value: string) => BackfillDiffQueryBuilder;
  gte: (column: string, value: string) => BackfillDiffQueryBuilder;
  order: (
    column: string,
    options?: { ascending?: boolean },
  ) => Promise<{ data: unknown[] | null; error: { message: string } | null }>;
}

interface BackfillDiffClient {
  from: (table: "vibes_scores") => BackfillDiffQueryBuilder;
}

function scoreKey(modelId: string, periodStart: string): string {
  return `${modelId}|${periodStart}`;
}

async function buildBackfillDiffReport(
  supabase: BackfillDiffClient,
  rows: ScoreUpsertRow[],
  daysBack: number,
) {
  const fromIso = new Date(Date.now() - (daysBack + 1) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("vibes_scores")
    .select("model_id, period_start, score, total_posts, eligible_posts, score_basis_status, queued_posts, unclassified_posts")
    .eq("period", "daily")
    .gte("period_start", fromIso)
    .order("period_start", { ascending: true });
  if (error) throw new Error(`Failed to fetch existing score diff rows: ${error.message}`);

  const oldByKey = new Map<string, ExistingDailyScoreRow>();
  for (const row of (data ?? []) as ExistingDailyScoreRow[]) {
    oldByKey.set(scoreKey(row.model_id, row.period_start), row);
  }

  const newRows = rows.filter((row) => row.period === "daily");
  const newByKey = new Map<string, ScoreUpsertRow>();
  for (const row of newRows) {
    newByKey.set(scoreKey(row.model_id, row.period_start), row);
  }

  const keys = Array.from(new Set([...oldByKey.keys(), ...newByKey.keys()])).sort();
  return keys.map((key) => {
    const oldRow = oldByKey.get(key);
    const newRow = newByKey.get(key);
    const [modelId, periodStart] = key.split("|");
    return {
      model_id: modelId,
      period_start: newRow?.period_start ?? oldRow?.period_start ?? periodStart,
      old_score: oldRow?.score ?? null,
      new_score: newRow?.score ?? null,
      old_basis: oldRow?.score_basis_status ?? null,
      new_basis: newRow?.score_basis_status ?? null,
      eligible_posts: newRow?.eligible_posts ?? 0,
      pending_count: newRow?.queued_posts ?? 0,
      old_total_posts: oldRow?.total_posts ?? null,
      new_total_posts: newRow?.total_posts ?? null,
      stale_carry_forward_removed: oldRow?.score_basis_status === "carried_forward" && !newRow,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let lockOwner: string | null = null;

  try {
    const body = await readJsonBody(req);
    const daysBack = Math.max(0, Math.min(Number(body.days_back ?? 2), 90));
    const minPosts = Math.max(1, Number(body.min_posts ?? 5));
    const dryRun = body.dry_run === true;
    const includeDiffReport = body.diff_report === true || body.backfill_diff_report === true;

    const { data: models, error: modelsError } = await supabase
      .from("models")
      .select("id, name, slug");
    if (modelsError) throw new Error(`Failed to fetch models: ${modelsError.message}`);
    if (!models || models.length === 0) {
      return new Response(JSON.stringify({ error: "No models found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lock = await claimServiceLock(supabase, "vibes-score-refresh", 900);
    lockOwner = lock.owner;
    if (!lock.claimed) {
      return new Response(JSON.stringify({ status: "skipped", reason: "score_refresh_already_running" }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const summary = await refreshScores(supabase, models as ModelRow[], {
      daysBack,
      includeHourly: daysBack <= 2,
      minPosts,
      dryRun,
      replaceRange: true,
      includeRows: includeDiffReport,
    });
    const diffReport = includeDiffReport
      ? await buildBackfillDiffReport(supabase, summary.rows ?? [], daysBack)
      : null;
    delete summary.rows;

    await supabase.from("error_log").insert({
      function_name: "reaggregate-vibes",
      error_message: `Score reaggregate complete: days_back=${daysBack}, dry_run=${dryRun}`,
      context: JSON.stringify({
        daily_rows: summary.daily_rows,
        hourly_rows: summary.hourly_rows,
        posts_scanned: summary.posts_scanned,
        skipped_days: summary.skipped_days,
      }),
    });

    return new Response(JSON.stringify({
      status: "complete",
      dry_run: dryRun,
      days_back: daysBack,
      summary,
      diff_report: diffReport,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown";
    try {
      await supabase.from("error_log").insert({
        function_name: "reaggregate-vibes",
        error_message: message,
        context: "top-level error",
      });
    } catch {}
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (lockOwner) {
      try {
        await releaseServiceLock(supabase, "vibes-score-refresh", lockOwner);
      } catch (e) {
        console.error("Failed to release score lock", e);
      }
    }
  }
});
