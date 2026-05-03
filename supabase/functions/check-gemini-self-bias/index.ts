import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatchTargeted, isClassifierFailure } from "../_shared/classifier.ts";
import { internalOnlyResponse, isInternalServiceRequest, readJsonBody } from "../_shared/runtime.ts";

// Gemini-only classifier canary. This replaces the old Anthropic/Claude
// self-bias check so sentiment evaluation stays inside the Gemini free-tier
// budget. It reads recent stored posts, compares candidate Gemini models
// against current labels, and never writes public scores or scraped posts.

const SOURCE = "check-gemini-self-bias";
const DEFAULT_CANDIDATES = ["gemini-2.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite-preview"];
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 200;
const LOOKBACK_DAYS = 21;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface StoredPost {
  id: string;
  model_id: string;
  title: string | null;
  content: string | null;
  sentiment: string | null;
  complaint_category: string | null;
  confidence: number | null;
  models: { slug: string } | null;
}

function clampCandidates(value: unknown): string[] {
  if (!Array.isArray(value)) return DEFAULT_CANDIDATES;
  const candidates = value
    .filter((entry): entry is string => typeof entry === "string")
    .filter((entry) => DEFAULT_CANDIDATES.includes(entry));
  return candidates.length > 0 ? Array.from(new Set(candidates)) : DEFAULT_CANDIDATES;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await readJsonBody(req);
  const limit = Math.max(25, Math.min(MAX_LIMIT, Number(body.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));
  const candidates = clampCandidates(body.candidates);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();

  try {
    const { data, error } = await supabase
      .from("scraped_posts")
      .select("id, model_id, title, content, sentiment, complaint_category, confidence, models(slug)")
      .gte("posted_at", since)
      .order("posted_at", { ascending: false })
      .limit(MAX_LIMIT * 4);
    if (error) throw error;

    const sample = ((data ?? []) as StoredPost[])
      .filter((post) => post.sentiment === null || (post.confidence ?? 0) < 0.65 || (post.sentiment === "negative" && !post.complaint_category))
      .slice(0, limit)
      .map((post) => ({
        ...post,
        text: `${post.title || ""} ${post.content || ""}`.trim().slice(0, 1200),
        model_slug: post.models?.slug ?? "unknown",
      }))
      .filter((post) => post.text.length > 0 && post.model_slug !== "unknown");

    if (sample.length === 0) {
      return new Response(JSON.stringify({ status: "success", sample_size: 0, candidates }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Record<string, unknown> = {};
    for (const model of candidates) {
      const classified = await classifyBatchTargeted(
        sample.map((post) => ({ text: post.text, targetModel: post.model_slug })),
        apiKey,
        25,
        async (msg, ctx) => {
          await supabase.from("error_log").insert({
            function_name: SOURCE,
            error_message: msg,
            context: ctx || "model-eval",
          });
        },
        { model, quotaScope: "eval" },
      );

      let parseOrQuotaFailures = 0;
      let comparableSentiment = 0;
      let sentimentMatches = 0;
      let comparableComplaints = 0;
      let complaintMatches = 0;
      let newlyIrrelevant = 0;

      for (let i = 0; i < sample.length; i++) {
        const current = sample[i];
        const result = classified[i];
        if (!result || isClassifierFailure(result)) {
          parseOrQuotaFailures++;
          continue;
        }
        if (!result.relevant) {
          newlyIrrelevant++;
          continue;
        }
        if (current.sentiment) {
          comparableSentiment++;
          if (result.sentiment === current.sentiment) sentimentMatches++;
        }
        if (current.sentiment === "negative" && current.complaint_category) {
          comparableComplaints++;
          if (result.complaint_category === current.complaint_category) complaintMatches++;
        }
      }

      results[model] = {
        sample_size: sample.length,
        parse_or_quota_failures: parseOrQuotaFailures,
        newly_irrelevant: newlyIrrelevant,
        sentiment_match_rate: comparableSentiment > 0 ? Math.round((sentimentMatches / comparableSentiment) * 1000) / 1000 : null,
        complaint_match_rate: comparableComplaints > 0 ? Math.round((complaintMatches / comparableComplaints) * 1000) / 1000 : null,
      };
    }

    const summary = {
      status: "success",
      lookback_days: LOOKBACK_DAYS,
      sample_size: sample.length,
      candidates,
      generated_at: new Date().toISOString(),
      results,
      note: "Gemini-only historical canary; no public score writes.",
    };

    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: `Gemini model canary complete: n=${sample.length}, candidates=${candidates.join(",")}`,
      context: "summary",
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("error_log").insert({
      function_name: SOURCE,
      error_message: message,
      context: "model_eval_error",
    });
    return new Response(JSON.stringify({ status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
