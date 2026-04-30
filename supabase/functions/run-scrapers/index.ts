import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfiguredWindows,
  internalOnlyResponse,
  isInternalServiceRequest,
  isMaintenanceRequestAllowed,
  isUniqueViolation,
  loadScraperConfig,
  readJsonBody,
  updateRunRecord,
} from "../_shared/runtime.ts";
import { getMatchingWindow } from "../_shared/vibes-scoring.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRAPERS = [
  "scrape-reddit-apify",
  "scrape-hackernews",
  "scrape-bluesky",
  "scrape-twitter",
  "scrape-mastodon",
];

const NIGHTLY_REAGGREGATE_TIME = "02:30";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SOURCE_WINDOW_TIMES: Record<string, string[]> = {
  "scrape-hackernews": ["05:00", "11:00", "17:00", "23:00"],
  "scrape-bluesky": ["05:00", "11:00", "17:00", "23:00"],
  "scrape-mastodon": ["05:00", "11:00", "17:00", "23:00"],
  "scrape-twitter": ["05:00", "14:00", "21:00"],
  "scrape-reddit-apify": ["05:00", "14:00", "21:00"],
};

interface InvocationResult {
  ok: boolean;
  status: number;
  text: string;
  body: any;
}

interface ScraperResult {
  source: string;
  status: string;
  posts_found: number;
  posts_classified: number;
  apify_items_fetched: number;
  filtered_candidates: number;
  net_new_rows: number;
  duplicate_conflicts: number;
  errors: string[];
  started_at: string;
  completed_at: string;
  body: any;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

// Per-scraper wall-clock budget. Recent successful Bluesky / Reddit-Apify /
// HN runs complete in 60-180s; 120s catches genuine hangs while letting normal
// slow runs finish. AbortError throws back to runScraper's catch block, which
// records status="failed" and lets the orchestrator finalize cleanly.
const INVOKE_TIMEOUT_MS = 120_000;
const INVOKE_TIMEOUT_BY_SCRAPER: Record<string, number> = {
  "scrape-reddit-apify": 540_000,
  "scrape-twitter": 420_000,
};

function stableWindowLabel(time: string): string {
  return `window_${time.replace(":", "")}`;
}

function timeoutForScraper(name: string): number {
  return INVOKE_TIMEOUT_BY_SCRAPER[name] ?? INVOKE_TIMEOUT_MS;
}

async function invokeFunction(
  name: string,
  payload: Record<string, unknown>,
  timeoutMs: number = INVOKE_TIMEOUT_MS,
): Promise<InvocationResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text().catch(() => "");
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = {};
    }

    return {
      ok: response.ok,
      status: response.status,
      text,
      body,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runScraper(
  name: string,
  payload: Record<string, unknown>,
): Promise<ScraperResult> {
  const started_at = new Date().toISOString();

  try {
    const result = await invokeFunction(name, payload, timeoutForScraper(name));
    const completed_at = new Date().toISOString();

    if (!result.ok) {
      return {
        source: name,
        status: "failed",
        posts_found: 0,
        posts_classified: 0,
        apify_items_fetched: 0,
        filtered_candidates: 0,
        net_new_rows: 0,
        duplicate_conflicts: 0,
        errors: [`HTTP ${result.status}: ${result.text.slice(0, 500)}`],
        started_at,
        completed_at,
        body: result.body,
      };
    }

    const derived = deriveRunMetrics(result.body ?? {});
    return {
      source: name,
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      apify_items_fetched: derived.apify_items_fetched,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      started_at,
      completed_at,
      body: result.body,
    };
  } catch (error) {
    return {
      source: name,
      status: "failed",
      posts_found: 0,
      posts_classified: 0,
      apify_items_fetched: 0,
      filtered_candidates: 0,
      net_new_rows: 0,
      duplicate_conflicts: 0,
      errors: [error instanceof Error ? error.message : String(error)],
      started_at,
      completed_at: new Date().toISOString(),
      body: {},
    };
  }
}

async function findExistingRun(
  supabase: any,
  source: string,
  windowLabel: string,
  windowLocalDate: string,
) {
  const { data } = await supabase
    .from("scraper_runs")
    .select("id, status, started_at, metadata")
    .eq("source", source)
    .eq("window_label", windowLabel)
    .eq("window_local_date", windowLocalDate)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function findActiveRun(supabase: any, source = "run-scrapers") {
  const { data } = await supabase
    .from("scraper_runs")
    .select("id, status, started_at, window_label, window_local_date")
    .eq("source", source)
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function finalizeOrchestratorRun(
  supabase: any,
  runId: string,
  status: string,
  results: ScraperResult[],
  metadata: Record<string, unknown>,
) {
  const errors = results
    .flatMap((result) => result.errors.map((error) => `${result.source}: ${error}`))
    .slice(0, 50);

  await updateRunRecord(supabase, runId, {
    status,
    posts_found: results.reduce((sum, result) => sum + result.posts_found, 0),
    posts_classified: results.reduce((sum, result) => sum + result.posts_classified, 0),
    apify_items_fetched: results.reduce((sum, result) => sum + result.apify_items_fetched, 0),
    filtered_candidates: results.reduce((sum, result) => sum + result.filtered_candidates, 0),
    net_new_rows: results.reduce((sum, result) => sum + result.net_new_rows, 0),
    duplicate_conflicts: results.reduce((sum, result) => sum + result.duplicate_conflicts, 0),
    errors,
    metadata,
    completed_at: new Date().toISOString(),
  });
}

async function findExistingSourceWindow(
  supabase: any,
  source: string,
  windowLabel: string,
  windowLocalDate: string,
) {
  const { data } = await supabase
    .from("scraper_runs")
    .select("id, status, started_at, completed_at")
    .eq("source", source)
    .eq("run_kind", "scraper")
    .eq("window_label", windowLabel)
    .eq("window_local_date", windowLocalDate)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

async function handleNightlyReaggregate(
  supabase: any,
  timeZone: string,
) {
  const nightlyWindow = getMatchingWindow(new Date(), timeZone, [NIGHTLY_REAGGREGATE_TIME]);
  if (!nightlyWindow) {
    return {
      status: "skipped",
      reason: "outside_reaggregate_window",
      timeZone,
      expected_time: NIGHTLY_REAGGREGATE_TIME,
    };
  }

  const { data: startedRun, error: startError } = await createRunRecord(supabase, {
    source: "run-scrapers",
    run_kind: "orchestrator",
    status: "running",
    triggered_by: "scheduler",
    window_label: "nightly",
    window_local_date: nightlyWindow.localDate,
    timezone: timeZone,
    started_at: new Date().toISOString(),
    metadata: { mode: "nightly_reaggregate" },
  });

  if (startError) {
    if (isUniqueViolation(startError)) {
      const activeRun = await findActiveRun(supabase);
      if (activeRun) {
        return {
          status: "skipped",
          reason: "overlap_blocked",
          active_run: activeRun,
        };
      }

      const existingRun = await findExistingRun(supabase, "run-scrapers", "nightly", nightlyWindow.localDate);
      if (existingRun) {
        return {
          status: "skipped",
          reason: "already_ran",
          existing_run: existingRun,
        };
      }
    }
    throw startError;
  }

  // Reaggregate over 30 days — much heavier than aggregate-vibes; allow up
  // to 6 minutes before aborting.
  const result = await invokeFunction("reaggregate-vibes", {
    days_back: 30,
    min_posts: 5,
    dry_run: false,
    source: "run-scrapers",
  }, 360_000);

  const status = result.ok ? "success" : "failed";
  await updateRunRecord(supabase, startedRun!.id, {
    status,
    errors: result.ok ? [] : [`HTTP ${result.status}: ${result.text.slice(0, 500)}`],
    metadata: {
      mode: "nightly_reaggregate",
      response: result.body,
    },
    completed_at: new Date().toISOString(),
  });

  return {
    status,
    window_label: "nightly",
    window_local_date: nightlyWindow.localDate,
    timeZone,
    response: result.body,
    error: result.ok ? null : result.text,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  const isInternal = isInternalServiceRequest(req);

  if (!isMaintenanceRequestAllowed(body.maintenance, isInternal)) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const config = await loadScraperConfig(supabase, "run-scrapers");
  const { timeZone, windows } = getConfiguredWindows(config);

  if (body.maintenance === "reaggregate-vibes") {
    const summary = await handleNightlyReaggregate(supabase, timeZone);
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const requestedSource = typeof body.source === "string" ? body.source : null;
  if (requestedSource && !SCRAPERS.includes(requestedSource)) {
    return new Response(JSON.stringify({
      status: "failed",
      error: "Unsupported scraper source",
      source: requestedSource,
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!isInternal && !requestedSource) {
    return new Response(JSON.stringify({
      status: "failed",
      error: "Public scraper dispatch requires a supported source",
    }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const orchestratorSource = requestedSource ? `run-scrapers:${requestedSource}` : "run-scrapers";

  const requestedWindowTimes = isInternal ? asStringArray(body.window_times) : [];
  const defaultWindowTimes = requestedSource
    ? SOURCE_WINDOW_TIMES[requestedSource]
    : windows.map((window) => window.time);
  const allowedWindowTimes = requestedWindowTimes.length > 0 ? requestedWindowTimes : defaultWindowTimes;
  const graceMinutes = isInternal && Number.isFinite(Number(body.grace_minutes))
    ? Math.max(0, Math.min(Number(body.grace_minutes), 30))
    : 30;
  const activeWindow = getMatchingWindow(
    new Date(),
    timeZone,
    allowedWindowTimes,
    graceMinutes,
  );

  if (!activeWindow) {
    return new Response(JSON.stringify({
      status: "skipped",
      reason: "outside_window",
      timeZone,
      allowed_windows: allowedWindowTimes,
      grace_minutes: graceMinutes,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const windowLabel = stableWindowLabel(activeWindow.time);

  const { data: startedRun, error: startError } = await createRunRecord(supabase, {
    source: orchestratorSource,
    run_kind: "orchestrator",
    status: "running",
    triggered_by: "scheduler",
    window_label: windowLabel,
    window_local_date: activeWindow.localDate,
    timezone: timeZone,
    started_at: new Date().toISOString(),
    metadata: {
      mode: requestedSource ? "single_scraper_window" : "scrape_window",
      window_time: activeWindow.time,
      legacy_window_label: activeWindow.label,
      requested_source: requestedSource,
    },
  });

  if (startError) {
    if (isUniqueViolation(startError)) {
      const activeRun = await findActiveRun(supabase, orchestratorSource);
      if (activeRun) {
        return new Response(JSON.stringify({
          status: "skipped",
          reason: "overlap_blocked",
          active_run: activeRun,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const existingRun = await findExistingRun(supabase, orchestratorSource, windowLabel, activeWindow.localDate);
      if (existingRun) {
        return new Response(JSON.stringify({
          status: "skipped",
          reason: "already_ran",
          existing_run: existingRun,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({
      status: "failed",
      error: startError.message ?? "Failed to create orchestrator run",
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const scraperPayload = {
    orchestrated: true,
    parent_run_id: startedRun!.id,
    window_label: windowLabel,
    window_local_date: activeWindow.localDate,
    timezone: timeZone,
  };

  const scrapersToRun = requestedSource ? [requestedSource] : SCRAPERS;
  const results: ScraperResult[] = [];
  for (const scraper of scrapersToRun) {
    const existingRun = await findExistingSourceWindow(supabase, scraper, windowLabel, activeWindow.localDate);
    if (existingRun && ["running", "success", "partial"].includes(existingRun.status)) {
      results.push({
        source: scraper,
        status: "skipped",
        posts_found: 0,
        posts_classified: 0,
        apify_items_fetched: 0,
        filtered_candidates: 0,
        net_new_rows: 0,
        duplicate_conflicts: 0,
        errors: [],
        started_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        body: { reason: "source_window_already_ran", existing_run: existingRun },
      });
      continue;
    }
    results.push(await runScraper(scraper, scraperPayload));
  }

  const hasUsableResults = results.some((result) => result.status === "success" || result.status === "partial");

  const summaryCounts = {
    total_scrapers: scrapersToRun.length,
    succeeded: results.filter((result) => result.status === "success").length,
    partial: results.filter((result) => result.status === "partial").length,
    failed: results.filter((result) => result.status === "failed").length,
    skipped: results.filter((result) => result.status === "skipped").length,
  };

  let finalStatus = "success";
  if (!hasUsableResults && summaryCounts.skipped === scrapersToRun.length) {
    finalStatus = "skipped";
  } else if (!hasUsableResults) {
    finalStatus = "failed";
  } else if (summaryCounts.partial > 0 || summaryCounts.failed > 0 || summaryCounts.skipped > 0) {
    finalStatus = "partial";
  }

  await finalizeOrchestratorRun(supabase, startedRun!.id, finalStatus, results, {
    mode: requestedSource ? "single_scraper_window" : "scrape_window",
    window_time: activeWindow.time,
    legacy_window_label: activeWindow.label,
    scoring: "decoupled",
    requested_source: requestedSource,
    ...summaryCounts,
  });

  const responseBody = {
    status: finalStatus,
    timeZone,
    window_label: windowLabel,
    window_time: activeWindow.time,
    window_local_date: activeWindow.localDate,
    scoring: "decoupled",
    ...summaryCounts,
    totals: {
      posts_found: results.reduce((sum, result) => sum + result.posts_found, 0),
      posts_classified: results.reduce((sum, result) => sum + result.posts_classified, 0),
      apify_items_fetched: results.reduce((sum, result) => sum + result.apify_items_fetched, 0),
      filtered_candidates: results.reduce((sum, result) => sum + result.filtered_candidates, 0),
      net_new_rows: results.reduce((sum, result) => sum + result.net_new_rows, 0),
      duplicate_conflicts: results.reduce((sum, result) => sum + result.duplicate_conflicts, 0),
    },
    scrapers: results.map((result) => ({
      source: result.source,
      status: result.status,
      posts_found: result.posts_found,
      posts_classified: result.posts_classified,
      apify_items_fetched: result.apify_items_fetched,
      filtered_candidates: result.filtered_candidates,
      net_new_rows: result.net_new_rows,
      duplicate_conflicts: result.duplicate_conflicts,
      errors: result.errors,
    })),
  };

  return new Response(JSON.stringify(responseBody, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
