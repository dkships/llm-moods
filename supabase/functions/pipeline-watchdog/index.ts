import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import { corsHeaders, logToErrorLog } from "../_shared/utils.ts";

// Hourly watchdog. Reports queue backlog, scraper staleness, and aggregation
// lag to error_log so operators see alerts without polling dashboards.

const SOURCE = "pipeline-watchdog";

const QUEUE_BACKLOG_WARN = 500;
const QUEUE_OLDEST_WARN_MIN = 60;
const AGGREGATION_LAG_WARN_MIN = 90;
const RECENT_FAILED_WARN = 20;
// scraper_runs.source holds the function slug (see createRunRecord callers),
// not a short name. Thresholds are per-source: reddit runs 2×/day (0 4,16 UTC,
// max happy-path age ~11h17m at the :17 check), the rest 3×/day (max gap ~8h15m).
const SCRAPER_STALE_HOURS_BY_SOURCE: Record<string, number> = {
  "scrape-reddit-apify": 14,
  "scrape-hackernews": 11,
  "scrape-bluesky": 11,
  "scrape-twitter": 11,
  "scrape-mastodon": 11,
};
// A scraper that runs on schedule but fails/skips every run never trips the
// started_at check, so also alert when the last success/partial is older than
// this (2+ fully missed reddit windows; single failures can't spam).
const SCRAPER_NO_SUCCESS_HOURS = 30;
// Runs-query lookback must comfortably exceed the 30h success window or a
// success row ages out while today's run is still in flight (false alert).
const RUNS_LOOKBACK_HOURS = 72;

interface Alert { level: "warn" | "error"; message: string; context: Record<string, unknown>; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !isSchedulerRequest(body, "pipeline-watchdog")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const alerts: Alert[] = [];
  const now = Date.now();

  try {
    // 1. Classification queue health
    const { data: queueHealth, error: queueErr } = await supabase.rpc("get_classification_queue_health");
    if (queueErr) throw new Error(`queue_health: ${queueErr.message}`);
    const queueRow = Array.isArray(queueHealth) ? queueHealth[0] : queueHealth;
    const queued = Number(queueRow?.queued ?? 0);
    const retrying = Number(queueRow?.retrying ?? 0);
    const failed = Number(queueRow?.failed ?? 0);
    const oldestQueuedAt = queueRow?.oldest_queued_at ? new Date(queueRow.oldest_queued_at).getTime() : null;
    const oldestAgeMin = oldestQueuedAt ? Math.round((now - oldestQueuedAt) / 60000) : 0;

    if (queued + retrying >= QUEUE_BACKLOG_WARN) {
      alerts.push({
        level: "warn",
        message: `Classification queue backlog: ${queued + retrying} (queued=${queued}, retrying=${retrying})`,
        context: { queued, retrying, failed, oldest_age_min: oldestAgeMin },
      });
    }
    if (oldestAgeMin >= QUEUE_OLDEST_WARN_MIN) {
      alerts.push({
        level: "warn",
        message: `Oldest queued post is ${oldestAgeMin} min old (drain may be stuck)`,
        context: { oldest_queued_at: queueRow?.oldest_queued_at, queued, retrying },
      });
    }
    if (failed >= 50) {
      alerts.push({
        level: "error",
        message: `Classification failures piling up: ${failed} posts in failed state`,
        context: { failed },
      });
    }

    // Recent-failure rate alert: posts fail within ~24h of first attempt due to
    // the 5-attempt × ~24h backoff ceiling. Counting failed posts with
    // posted_at > now()-24h approximates a 24h-delta without a snapshot table.
    const recentFailedSince = new Date(now - 24 * 60 * 60 * 1000).toISOString();
    const { count: recentFailed, error: recentFailedErr } = await supabase
      .from("scraped_posts")
      .select("id", { count: "exact", head: true })
      .eq("classification_status", "failed")
      .gte("posted_at", recentFailedSince);
    if (recentFailedErr) throw new Error(`recent_failed: ${recentFailedErr.message}`);
    if ((recentFailed ?? 0) >= RECENT_FAILED_WARN) {
      alerts.push({
        level: "error",
        message: `Recent classification failures: ${recentFailed} posts (posted in last 24h) hit failed state`,
        context: { recent_failed: recentFailed, threshold: RECENT_FAILED_WARN },
      });
    }

    // 2. Scraper staleness — most recent run + most recent healthy run per source
    const sinceIso = new Date(now - RUNS_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
    const { data: runs, error: runsErr } = await supabase
      .from("scraper_runs")
      .select("source, started_at, status")
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false })
      .limit(500);
    if (runsErr) throw new Error(`scraper_runs: ${runsErr.message}`);

    const lastBySource = new Map<string, { started_at: string; status: string }>();
    const lastHealthyBySource = new Map<string, { started_at: string; status: string }>();
    for (const row of runs ?? []) {
      if (!lastBySource.has(row.source)) lastBySource.set(row.source, row);
      if (!lastHealthyBySource.has(row.source) && (row.status === "success" || row.status === "partial")) {
        lastHealthyBySource.set(row.source, row);
      }
    }
    for (const [source, staleHours] of Object.entries(SCRAPER_STALE_HOURS_BY_SOURCE)) {
      const last = lastBySource.get(source);
      const ageHours = last ? Math.round((now - new Date(last.started_at).getTime()) / 3_600_000) : Infinity;
      if (ageHours >= staleHours) {
        alerts.push({
          level: "warn",
          message: `Scraper '${source}' has not run in ${ageHours === Infinity ? `>${staleHours}` : ageHours}h`,
          context: { source, last_run: last?.started_at ?? null, last_status: last?.status ?? null },
        });
        continue; // no-success alert would be redundant noise on top
      }
      const healthy = lastHealthyBySource.get(source);
      const healthyAgeHours = healthy
        ? Math.round((now - new Date(healthy.started_at).getTime()) / 3_600_000)
        : Infinity;
      if (healthyAgeHours >= SCRAPER_NO_SUCCESS_HOURS) {
        alerts.push({
          level: "error",
          message: `Scraper '${source}' is running but has had no success/partial run in ${healthyAgeHours === Infinity ? `>${RUNS_LOOKBACK_HOURS}` : healthyAgeHours}h`,
          context: { source, last_run: last?.started_at ?? null, last_status: last?.status ?? null, last_healthy_run: healthy?.started_at ?? null },
        });
      }
    }

    // 3. Aggregation lag — newest score_computed_at
    const { data: lastScore, error: scoreErr } = await supabase
      .from("vibes_scores")
      .select("score_computed_at")
      .order("score_computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scoreErr) throw new Error(`vibes_scores: ${scoreErr.message}`);
    const lastComputed = lastScore?.score_computed_at ? new Date(lastScore.score_computed_at).getTime() : null;
    const lagMin = lastComputed ? Math.round((now - lastComputed) / 60000) : Infinity;
    if (lagMin >= AGGREGATION_LAG_WARN_MIN) {
      alerts.push({
        level: "warn",
        message: `aggregate-vibes hasn't run in ${lagMin === Infinity ? "ever" : `${lagMin} min`}`,
        context: { last_score_computed_at: lastScore?.score_computed_at ?? null },
      });
    }

    const summary = {
      checked_at: new Date(now).toISOString(),
      alerts: alerts.length,
      queue: { queued, retrying, failed, recent_failed_24h: recentFailed ?? 0, oldest_age_min: oldestAgeMin },
      aggregation_lag_min: lagMin === Infinity ? null : lagMin,
      scrapers_checked: Object.keys(SCRAPER_STALE_HOURS_BY_SOURCE).length,
    };

    if (alerts.length > 0) {
      for (const a of alerts) {
        // Alert `level` (warn/error) is flattened to severity=critical so
        // get_critical_alerts surfaces everything; the level survives in the
        // message prefix. Post-fix, staleness alerts are rare and genuine.
        await supabase.from("error_log").insert({
          function_name: SOURCE,
          severity: "critical",
          error_message: `[${a.level}] ${a.message}`,
          context: JSON.stringify(a.context),
        });
      }
    }

    return new Response(JSON.stringify({ status: alerts.length > 0 ? "alerts" : "healthy", summary, alerts }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    return new Response(JSON.stringify({ status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});