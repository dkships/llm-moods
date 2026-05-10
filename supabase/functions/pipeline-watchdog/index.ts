import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import { corsHeaders, logToErrorLog } from "../_shared/utils.ts";

const SOURCE = "pipeline-watchdog";

const SCRAPER_SOURCES = ["reddit", "hackernews", "bluesky", "mastodon", "twitter"] as const;
const SCRAPER_STALE_HOURS = 12;
const DRAIN_STALE_MINUTES = 60;
const AGGREGATE_STALE_MINUTES = 90;
const PENDING_QUEUE_ALERT_THRESHOLD = 100;

interface ScraperHealth {
  source: string;
  last_success_at: string | null;
  hours_since: number | null;
  stale: boolean;
}

interface WatchdogReport {
  ok: boolean;
  checked_at: string;
  scrapers: ScraperHealth[];
  drain: {
    last_classified_at: string | null;
    minutes_since: number | null;
    pending_count: number;
    stale: boolean;
  };
  aggregate: {
    last_computed_at: string | null;
    minutes_since: number | null;
    stale: boolean;
  };
  breaches: string[];
}

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
  const now = new Date();

  try {
    const report = await runChecks(supabase, now);

    if (!report.ok) {
      await supabase.from("error_log").insert({
        function_name: SOURCE,
        severity: "critical",
        error_message: `Pipeline staleness detected: ${report.breaches.join("; ")}`,
        context: JSON.stringify(report),
      });
    }

    return new Response(JSON.stringify(report, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logToErrorLog(supabase, SOURCE, message, "watchdog-error");
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function runChecks(supabase: any, now: Date): Promise<WatchdogReport> {
  const scrapers = await checkScrapers(supabase, now);
  const drain = await checkDrain(supabase, now);
  const aggregate = await checkAggregate(supabase, now);

  const breaches: string[] = [];
  for (const s of scrapers) {
    if (s.stale) {
      const hours = s.hours_since === null ? "ever" : `${s.hours_since.toFixed(1)}h`;
      breaches.push(`scraper:${s.source} no success in ${hours}`);
    }
  }
  if (drain.stale) {
    const mins = drain.minutes_since === null ? "ever" : `${drain.minutes_since.toFixed(0)}m`;
    breaches.push(`drain stalled (last classified ${mins}, ${drain.pending_count} pending)`);
  }
  if (aggregate.stale) {
    const mins = aggregate.minutes_since === null ? "ever" : `${aggregate.minutes_since.toFixed(0)}m`;
    breaches.push(`aggregate-vibes stale (last refresh ${mins})`);
  }

  return {
    ok: breaches.length === 0,
    checked_at: now.toISOString(),
    scrapers,
    drain,
    aggregate,
    breaches,
  };
}

async function checkScrapers(supabase: any, now: Date): Promise<ScraperHealth[]> {
  const results: ScraperHealth[] = [];
  for (const source of SCRAPER_SOURCES) {
    const { data } = await supabase
      .from("scraper_runs")
      .select("started_at")
      .eq("source", source)
      .eq("status", "success")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastSuccessAt: string | null = data?.started_at ?? null;
    const hoursSince = lastSuccessAt
      ? (now.getTime() - new Date(lastSuccessAt).getTime()) / 3_600_000
      : null;
    const stale = hoursSince === null || hoursSince > SCRAPER_STALE_HOURS;

    results.push({ source, last_success_at: lastSuccessAt, hours_since: hoursSince, stale });
  }
  return results;
}

async function checkDrain(supabase: any, now: Date) {
  const { data: latest } = await supabase
    .from("scraped_posts")
    .select("classified_at")
    .eq("classification_status", "classified")
    .order("classified_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastClassifiedAt: string | null = latest?.classified_at ?? null;
  const minutesSince = lastClassifiedAt
    ? (now.getTime() - new Date(lastClassifiedAt).getTime()) / 60_000
    : null;

  const { count } = await supabase
    .from("scraped_posts")
    .select("id", { count: "exact", head: true })
    .in("classification_status", ["pending", "retry"]);

  const pendingCount = count ?? 0;
  // Drain is "stale" only if both signals fire: nothing classified recently AND
  // there's a real backlog. A long quiet period with zero pending posts is fine.
  const stale =
    pendingCount > PENDING_QUEUE_ALERT_THRESHOLD
    && (minutesSince === null || minutesSince > DRAIN_STALE_MINUTES);

  return { last_classified_at: lastClassifiedAt, minutes_since: minutesSince, pending_count: pendingCount, stale };
}

async function checkAggregate(supabase: any, now: Date) {
  const { data } = await supabase
    .from("vibes_scores")
    .select("score_computed_at")
    .order("score_computed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastComputedAt: string | null = data?.score_computed_at ?? null;
  const minutesSince = lastComputedAt
    ? (now.getTime() - new Date(lastComputedAt).getTime()) / 60_000
    : null;
  const stale = minutesSince === null || minutesSince > AGGREGATE_STALE_MINUTES;

  return { last_computed_at: lastComputedAt, minutes_since: minutesSince, stale };
}
