import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { processPendingClassifications } from "../_shared/classification-state.ts";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfiguredWindows,
  internalOnlyResponse,
  isInternalServiceRequest,
  isUniqueViolation,
  loadScraperConfig,
  readJsonBody,
  updateRunRecord,
} from "../_shared/runtime.ts";
import {
  claimServiceLock,
  refreshScores,
  releaseServiceLock,
  type ModelRow,
} from "../_shared/score-refresh.ts";
import { getMatchingWindow } from "../_shared/vibes-scoring.ts";
import { corsHeaders, logToErrorLog } from "../_shared/utils.ts";

const SOURCE = "run-pipeline";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SOURCE_HANDLERS = [
  { name: "scrape-hackernews" },
  { name: "scrape-bluesky" },
  { name: "scrape-mastodon" },
  { name: "scrape-twitter" },
  { name: "scrape-reddit-apify" },
];

function stableWindowLabel(time: string): string {
  return `window_${time.replace(":", "")}`;
}

async function runSourceHandler(
  name: string,
  payload: Record<string, unknown>,
) {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  const derived = deriveRunMetrics(body);
  return {
    source: name,
    ok: response.ok,
    status_code: response.status,
    status: response.ok ? derived.status : "failed",
    errors: response.ok ? derived.errors : [`HTTP ${response.status}: ${text.slice(0, 500)}`],
    body,
    metrics: derived,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  const isInternal = isInternalServiceRequest(req);
  const isSchedulerRequest = body.scheduler === "pg_cron" && body.pipeline === SOURCE && body.dry_run !== true && body.dryRun !== true;
  if (!isInternal && !isSchedulerRequest) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const dryRun = body.dry_run === true || body.dryRun === true;
  const force = body.force === true || dryRun;
  let lockOwner: string | null = null;
  let runId: string | null = null;

  try {
    const config = await loadScraperConfig(supabase, SOURCE);
    const { timeZone, windows } = getConfiguredWindows(config);
    const activeWindow = force
      ? {
        label: "manual",
        time: typeof body.window_time === "string" ? body.window_time : windows[0]?.time ?? "05:00",
        localDate: new Date().toISOString().slice(0, 10),
        localTime: "manual",
        timeZone,
      }
      : getMatchingWindow(new Date(), timeZone, windows.map((window) => window.time), 30);

    if (!activeWindow) {
      return new Response(JSON.stringify({
        status: "skipped",
        reason: "outside_window",
        timeZone,
        allowed_windows: windows.map((window) => window.time),
      }, null, 2), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lock = await claimServiceLock(supabase, "llm-vibes-pipeline", 1800);
    lockOwner = lock.owner;
    if (!lock.claimed) {
      return new Response(JSON.stringify({ status: "skipped", reason: "pipeline_already_running" }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const windowLabel = stableWindowLabel(activeWindow.time);
    const { data: startedRun, error: startError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "orchestrator",
      status: "running",
      triggered_by: dryRun ? "manual_dry_run" : "scheduler",
      window_label: windowLabel,
      window_local_date: activeWindow.localDate,
      timezone: timeZone,
      metadata: {
        mode: "collect_classify_aggregate",
        dry_run: dryRun,
        window_time: activeWindow.time,
      },
    });

    if (startError) {
      if (isUniqueViolation(startError)) {
        return new Response(JSON.stringify({ status: "skipped", reason: "window_already_started" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw startError;
    }
    runId = startedRun!.id;

    const sourcePayload = {
      orchestrated: true,
      parent_run_id: runId,
      window_label: windowLabel,
      window_local_date: activeWindow.localDate,
      timezone: timeZone,
    };

    const collection = dryRun
      ? SOURCE_HANDLERS.map(({ name }) => ({
        source: name,
        status: "skipped",
        ok: true,
        status_code: 200,
        errors: [],
        body: { dry_run: true, reason: "collection_not_mutated_in_dry_run" },
        metrics: deriveRunMetrics({ status: "skipped", skipped: true }),
      }))
      : [];

    if (!dryRun) {
      for (const source of SOURCE_HANDLERS) {
        collection.push(await runSourceHandler(source.name, source.handler, sourcePayload));
      }
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!dryRun && !geminiApiKey) throw new Error("GEMINI_API_KEY not configured");
    const classification = await processPendingClassifications(supabase, geminiApiKey ?? "", {
      dryRun,
      limit: Number(body.classification_limit ?? Deno.env.get("PIPELINE_CLASSIFICATION_LIMIT") ?? 40),
      batchSize: Number(body.classification_batch_size ?? Deno.env.get("PIPELINE_CLASSIFICATION_BATCH_SIZE") ?? 20),
      logError: (msg, ctx) => logToErrorLog(supabase, SOURCE, msg, ctx ?? "classification"),
    });

    const { data: models, error: modelsError } = await supabase
      .from("models")
      .select("id, name, slug");
    if (modelsError) throw new Error(`Failed to fetch models: ${modelsError.message}`);

    const scoring = await refreshScores(supabase, (models ?? []) as ModelRow[], {
      daysBack: Number(body.score_days_back ?? 2),
      includeHourly: true,
      dryRun,
      replaceRange: body.replace_range === true,
    });

    const failures = collection.filter((result) => result.status === "failed").length;
    const partials = collection.filter((result) => result.status === "partial").length;
    const finalStatus = failures > 0 || classification.errors.length > 0
      ? "partial"
      : partials > 0
        ? "partial"
        : "success";
    const errors = [
      ...collection.flatMap((result) => result.errors.map((error) => `${result.source}: ${error}`)),
      ...classification.errors.map((error) => `classification: ${error}`),
    ].slice(0, 50);

    await updateRunRecord(supabase, runId, {
      status: dryRun ? "success" : finalStatus,
      posts_found: collection.reduce((sum, result) => sum + result.metrics.posts_found, 0),
      posts_classified: classification.processed,
      filtered_candidates: collection.reduce((sum, result) => sum + result.metrics.filtered_candidates, 0),
      net_new_rows: collection.reduce((sum, result) => sum + result.metrics.net_new_rows, 0),
      duplicate_conflicts: collection.reduce((sum, result) => sum + result.metrics.duplicate_conflicts, 0),
      errors,
      metadata: {
        dry_run: dryRun,
        collection: collection.map((result) => ({
          source: result.source,
          status: result.status,
          metrics: result.metrics,
        })),
        classification,
        scoring,
      },
      completed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({
      status: dryRun ? "success" : finalStatus,
      dry_run: dryRun,
      window_label: windowLabel,
      window_local_date: activeWindow.localDate,
      collection: collection.map((result) => ({
        source: result.source,
        status: result.status,
        metrics: result.metrics,
        errors: result.errors,
      })),
      classification,
      scoring,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runId) {
      await updateRunRecord(supabase, runId, {
        status: "failed",
        errors: [message],
        metadata: { error: message, dry_run: dryRun },
        completed_at: new Date().toISOString(),
      });
    }
    return new Response(JSON.stringify({ status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    if (lockOwner) {
      try {
        await releaseServiceLock(supabase, "llm-vibes-pipeline", lockOwner);
      } catch (error) {
        console.error("Failed to release pipeline lock", error);
      }
    }
  }
});
