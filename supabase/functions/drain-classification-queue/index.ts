import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { processPendingClassifications } from "../_shared/classification-state.ts";
import { getClassifierApiKey } from "../_shared/classifier.ts";
import {
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  readJsonBody,
} from "../_shared/runtime.ts";
import { claimServiceLock, releaseServiceLock } from "../_shared/score-refresh.ts";
import { corsHeaders, logToErrorLog } from "../_shared/utils.ts";

const SOURCE = "drain-classification-queue";
// Deploy-verification marker (see reference: Lovable deploy prompts sometimes
// ship stale/rewritten code). Bump whenever the drain or its _shared imports
// change; verify after redeploy with a dry_run invocation and check the
// response's code_version. "r1" = the compact-irrelevant revert (2026-07-30).
const CODE_VERSION = "2026-07-30-r1-compact-irrelevant-revert";
// Fallbacks for invocations that omit limit/batch_size. Match the pg_cron
// production body (limit=200, batch_size=20); batch_size stays at 20 to
// respect the batch-JSON-size cap decision (see AGENT-REFERENCE.md).
const DEFAULT_LIMIT = 200;
const DEFAULT_BATCH_SIZE = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !await isSchedulerRequest(body, "drain-classifications")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Key follows the active CLASSIFIER_MODEL: ANTHROPIC_API_KEY for claude-*,
  // GEMINI_API_KEY otherwise. Avoids sending a Gemini key to the Anthropic API.
  const apiKey = getClassifierApiKey();
  if (!apiKey) {
    await logToErrorLog(supabase, SOURCE, "Classifier API key not configured", "config");
    return new Response(JSON.stringify({ status: "failed", error: "Classifier API key not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const lock = await claimServiceLock(supabase, SOURCE, 240);
  if (!lock.claimed) {
    return new Response(JSON.stringify({ status: "skipped", reason: "already_running", code_version: CODE_VERSION }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Number(...) || DEFAULT guards a malformed body: a NaN limit/batch_size
    // otherwise propagates through the Math.min/max clamps and silently no-ops
    // the whole pass (the `i < NaN` slice loop never runs).
    const summary = await processPendingClassifications(supabase, apiKey, {
      limit: Number(body.limit) || DEFAULT_LIMIT,
      batchSize: Number(body.batch_size) || DEFAULT_BATCH_SIZE,
      dryRun: body.dry_run === true,
      logError: (msg, ctx) => logToErrorLog(supabase, SOURCE, msg, ctx ?? "classification"),
    });

    return new Response(JSON.stringify({
      status: summary.errors.length > 0 ? "partial" : "success",
      code_version: CODE_VERSION,
      ...summary,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    return new Response(JSON.stringify({ status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await releaseServiceLock(supabase, SOURCE, lock.owner).catch(() => {});
  }
});
