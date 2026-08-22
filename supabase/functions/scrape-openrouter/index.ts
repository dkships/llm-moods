import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  isUniqueViolation,
  loadScraperConfig,
  readJsonBody,
  type RunRecordRow,
  updateRunRecord,
} from "../_shared/runtime.ts";
import { corsHeaders, logToErrorLog, upsertPendingScrapedPost } from "../_shared/utils.ts";

const SOURCE = "scrape-openrouter";

// OpenRouter's public model list (no auth, JSON) is one of the earliest
// machine-readable signals that a frontier model exists: the slug appears when
// the provider wires it up, often before the launch post. Added 2026-08-22 as a
// rumors-radar source. Each newly-listed model for a tracked vendor becomes one
// scraped_posts row whose text deliberately contains the leak-lexicon terms
// ("spotted", "in the API") that get_rumor_candidates() keys on, so the
// extractor sees it as an artifact-grade signal; the sentiment classifier will
// mark it irrelevant (announcement) at negligible cost. Dedupe is the
// source_url, and only models created in the last 7 days are inserted, so the
// first run doesn't backfill the whole catalogue.
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const VENDOR_PREFIX_TO_SLUG: Record<string, string> = {
  "anthropic/": "claude",
  "openai/": "chatgpt",
  "google/": "gemini",
  "x-ai/": "grok",
};
const NEW_MODEL_MAX_AGE_MS = 7 * 24 * 3600000;

interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

function vendorSlug(id: string): string | null {
  for (const [prefix, slug] of Object.entries(VENDOR_PREFIX_TO_SLUG)) {
    if (id.startsWith(prefix)) return slug;
  }
  return null;
}

function perMillion(price: string | undefined): string | null {
  const n = Number(price);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${(n * 1_000_000).toFixed(2)}`;
}

export async function handleScrapeOpenrouter(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !await isSchedulerRequest(body, "scrape-openrouter")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runRecord: RunRecordRow | null = null;

  try {
    const config = await loadScraperConfig(supabase, SOURCE);
    if (!getConfigBoolean(config, "enabled", true)) {
      return new Response(JSON.stringify({ source: SOURCE, status: "skipped", skipped: true, reason: "disabled", errors: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: startedRun, error: runError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "scraper",
      status: "running",
      parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null,
      triggered_by: body.orchestrated ? "orchestrator" : "manual",
      window_label: typeof body.window_label === "string" ? body.window_label : null,
      window_local_date: typeof body.window_local_date === "string" ? body.window_local_date : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      started_at: new Date().toISOString(),
    });
    if (runError) {
      if (isUniqueViolation(runError)) {
        return new Response(JSON.stringify({ source: SOURCE, status: "skipped", skipped: true, reason: "already_running", errors: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw runError;
    }
    runRecord = startedRun;

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "openrouter")
      .limit(5000);
    const existingUrls = new Set((existing || []).map((entry: { source_url: string | null }) => entry.source_url).filter(Boolean));

    const summary = {
      source: SOURCE,
      posts_found: 0,
      filtered_candidates: 0,
      classified: 0,
      classification_success: 0,
      net_new_rows: 0,
      duplicate_conflicts: 0,
      irrelevant: 0,
      classificationQueued: 0,
      dedupSkipped: 0,
      contentSkipped: 0,
      errors: [] as string[],
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let catalogue: OpenRouterModel[] = [];
    try {
      const res = await fetch(OPENROUTER_MODELS_URL, {
        headers: { Accept: "application/json", "User-Agent": "llmvibes.ai scraper (+https://llmvibes.ai)" },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
      const json = await res.json();
      catalogue = Array.isArray(json?.data) ? json.data : [];
    } finally {
      clearTimeout(timer);
    }

    const cutoff = Date.now() - NEW_MODEL_MAX_AGE_MS;
    for (const model of catalogue) {
      if (!model?.id || model.id.startsWith("~") || model.id.includes(":")) continue; // aliases + variants
      const slug = vendorSlug(model.id);
      if (!slug) continue;
      summary.posts_found++;

      const createdMs = typeof model.created === "number" ? model.created * 1000 : NaN;
      if (!Number.isFinite(createdMs) || createdMs < cutoff) continue;

      const sourceUrl = `https://openrouter.ai/${model.id}`;
      if (existingUrls.has(sourceUrl)) {
        summary.dedupSkipped++;
        continue;
      }
      const modelId = modelMap[slug];
      if (!modelId) continue;
      summary.filtered_candidates++;

      const listedOn = new Date(createdMs).toISOString().slice(0, 10);
      const priceIn = perMillion(model.pricing?.prompt);
      const priceOut = perMillion(model.pricing?.completion);
      const pricing = priceIn && priceOut ? ` Pricing ${priceIn}/M input, ${priceOut}/M output.` : "";
      const context = model.context_length ? ` Context window ${model.context_length.toLocaleString("en-US")} tokens.` : "";
      const description = (model.description || "").replace(/\s+/g, " ").trim().slice(0, 300);
      const title = `New model listed on OpenRouter: ${model.name || model.id}`;
      const content =
        `${model.name || model.id} (${model.id}) was spotted in the API on OpenRouter on ${listedOn} — a new model slug listed by the provider.${context}${pricing}` +
        (description ? ` Provider description: ${description}` : "");

      const upsertResult = await upsertPendingScrapedPost(supabase, {
        model_id: modelId,
        source: "openrouter",
        source_url: sourceUrl,
        title: title.slice(0, 120),
        content: content.slice(0, 2000),
        content_type: "title_and_body",
        score: 0,
        posted_at: new Date(createdMs).toISOString(),
        author_handle: "openrouter",
      });
      if (upsertResult.error) {
        summary.errors.push(`Insert: ${upsertResult.error}`);
        continue;
      }
      if (upsertResult.inserted) {
        summary.net_new_rows++;
        summary.classificationQueued++;
        existingUrls.add(sourceUrl);
      } else {
        summary.duplicate_conflicts++;
      }
    }

    const derived = deriveRunMetrics(summary);
    await updateRunRecord(supabase, runRecord!.id, {
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      metadata: { classification_queued: summary.classificationQueued, dedup_skipped: summary.dedupSkipped, catalogue_size: catalogue.length },
      completed_at: new Date().toISOString(),
    });
    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: tracked-vendor models=${summary.posts_found} new=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
      "summary",
    );

    return new Response(JSON.stringify({
      ...summary,
      classification_queued: summary.classificationQueued,
      status: derived.status,
      posts_classified: derived.posts_classified,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runRecord) {
      await updateRunRecord(supabase, runRecord!.id, {
        status: "failed",
        errors: [message],
        metadata: { error: message },
        completed_at: new Date().toISOString(),
      });
    }
    return new Response(JSON.stringify({ source: SOURCE, status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve(handleScrapeOpenrouter);
}
