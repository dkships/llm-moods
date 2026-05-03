import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatchTargeted, isClassifierFailure, summarizeClassifierFailures } from "../_shared/classifier.ts";
import {
  claimServiceLock,
  internalOnlyResponse,
  isInternalServiceRequest,
  readJsonBody,
  releaseServiceLock,
} from "../_shared/runtime.ts";
import {
  corsHeaders,
  isDuplicate,
  loadRecentTitleKeys,
  logToErrorLog,
  upsertScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "drain-classification-queue";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

interface QueueRow {
  id: string;
  source: string;
  scraper_source: string;
  model_id: string;
  model_slug: string;
  source_url: string;
  title: string | null;
  content: string | null;
  full_text: string;
  content_type: string;
  score: number | null;
  posted_at: string;
  attempt_count: number;
}

function retryDelayMs(attemptCount: number, retryAfterMs: number | null | undefined): number {
  if (retryAfterMs && retryAfterMs > 0) return retryAfterMs;
  const minutes = Math.min(24 * 60, 15 * (2 ** Math.min(6, attemptCount)));
  return minutes * 60 * 1000;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await readJsonBody(req);
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const lock = await claimServiceLock(supabase, SOURCE, 240);
  if (!lock.claimed) {
    return new Response(JSON.stringify({ status: "skipped", reason: "already_running" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) throw new Error("GEMINI_API_KEY not configured");

    const { data, error } = await supabase
      .from("classification_queue")
      .select("id, source, scraper_source, model_id, model_slug, source_url, title, content, full_text, content_type, score, posted_at, attempt_count")
      .in("status", ["queued", "retrying", "failed"])
      .lte("next_attempt_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`Queue fetch failed: ${error.message}`);
    const rows = (data ?? []) as QueueRow[];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ status: "success", processed: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabase
      .from("classification_queue")
      .update({ status: "retrying", last_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in("id", rows.map((row) => row.id));

    const logError = async (msg: string, ctx?: string) => {
      await logToErrorLog(supabase, SOURCE, msg, ctx || "classify");
    };
    const results = await classifyBatchTargeted(
      rows.map((row) => ({ text: row.full_text, targetModel: row.model_slug })),
      apiKey,
      25,
      logError,
    );
    const titleKeys = await loadRecentTitleKeys(supabase);

    let classified = 0;
    let irrelevant = 0;
    let duplicate = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const result = results[i];
      const title = (row.title || row.content || row.full_text).slice(0, 500);

      if (!result || isClassifierFailure(result)) {
        failed++;
        const delayMs = retryDelayMs(row.attempt_count + 1, result?.retry_after_ms);
        const nextAttemptAt = new Date(Date.now() + delayMs).toISOString();
        await supabase
          .from("classification_queue")
          .update({
            status: "queued",
            attempt_count: row.attempt_count + 1,
            last_error: result?.error ?? "missing_classifier_result",
            last_error_type: result?.error_type ?? result?.status ?? "classifier_error",
            request_error_id: result?.request_error_id ?? null,
            next_attempt_at: nextAttemptAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        continue;
      }

      if (!result.relevant) {
        irrelevant++;
        await supabase
          .from("classification_queue")
          .update({ status: "irrelevant", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }

      if (isDuplicate(titleKeys, title, row.model_id)) {
        duplicate++;
        await supabase
          .from("classification_queue")
          .update({ status: "duplicate", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        continue;
      }

      const upsertResult = await upsertScrapedPost(supabase, {
        model_id: row.model_id,
        source: row.source,
        source_url: row.source_url,
        title: title.slice(0, 120),
        content: (row.content || row.full_text).slice(0, 2000),
        sentiment: result.sentiment,
        complaint_category: result.complaint_category,
        praise_category: result.praise_category,
        confidence: result.confidence,
        content_type: row.content_type,
        score: row.score ?? 0,
        posted_at: row.posted_at,
        original_language: result.language || null,
        translated_content: result.english_translation || null,
      });

      if (upsertResult.error) {
        failed++;
        errors.push(upsertResult.error);
        await supabase
          .from("classification_queue")
          .update({
            status: "failed",
            attempt_count: row.attempt_count + 1,
            last_error: upsertResult.error,
            last_error_type: "insert_error",
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        continue;
      }

      classified++;
      await supabase
        .from("classification_queue")
        .update({ status: upsertResult.inserted ? "classified" : "duplicate", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      titleKeys.add(`${row.model_id}:${title.slice(0, 80).toLowerCase()}`);
    }

    const classifierSummary = summarizeClassifierFailures(results, "Queue classifier");
    if (classifierSummary.messages.length > 0) errors.push(...classifierSummary.messages);
    await logToErrorLog(
      supabase,
      SOURCE,
      `Processed queue: rows=${rows.length} classified=${classified} irrelevant=${irrelevant} duplicate=${duplicate} failed=${failed}`,
      "summary",
    );

    return new Response(JSON.stringify({
      status: errors.length > 0 ? "partial" : "success",
      processed: rows.length,
      classified,
      irrelevant,
      duplicate,
      failed,
      classifier_quota_deferred: classifierSummary.quotaDeferred,
      errors,
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
