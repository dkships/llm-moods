import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isInternalServiceRequest, internalOnlyResponse } from "../_shared/runtime.ts";

// One-shot self-bias check. The dashboard's classifier is Gemini 2.5 Flash;
// it also classifies posts about Gemini, so the resulting sentiment could be
// biased. This function pulls a sample of stored Gemini-on-Gemini posts and
// re-classifies them with Claude Sonnet via the Anthropic API, then logs a
// summary diff to error_log so we can quantify the disagreement rate.
//
// Service-role gated (hits the paid Anthropic API). Run via the Lovable
// helper-fn invocation pattern, never from the browser. Safe to delete
// after a result is captured.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = "claude-sonnet-4-6";
const ANTHROPIC_VERSION = "2023-06-01";
const SAMPLE_SIZE = 50;
const BATCH_SIZE = 25;
const LOOKBACK_DAYS = 30;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Verbatim copy of _shared/classifier.ts BATCH_CLASSIFY_PROMPT (lines 62-103
// at the time of writing). Duplicated here rather than imported so this
// one-shot doesn't force a redeploy of every scraper that imports classifier.
const BATCH_CLASSIFY_PROMPT = `You are classifying social media posts about AI language models (ChatGPT, Claude, Gemini, Grok, DeepSeek, Perplexity, etc).

For EACH post, determine:

RELEVANCE: Is this post expressing a PERSONAL opinion about an AI model's quality, behavior, or usefulness based on direct or reported experience?
- RELEVANT: direct experience, quality complaints/praise, model comparisons, switching decisions, user-reported quality trends
  Examples: "Claude keeps refusing my coding requests", "GPT-4 just hallucinated my bibliography", "Claude is way better than GPT for coding", "has anyone noticed Gemini getting worse?", "I switched from ChatGPT to Claude"
- NOT RELEVANT:
  - News/research reporting: "PsyPost: ChatGPT acts as a cognitive crutch", "MIT Tech Review: 2025 is the year of AI hype correction"
  - Societal/behavioral commentary: "In 10 years will anyone know how to code?", "People are becoming dependent on AI"
  - Third-party business decisions mentioning a model: "DeviantArt added a Grok video generator"
  - Benchmark/spec comparisons without personal opinion: "Gemini 3 Flash: 218 tokens/sec vs GPT-4.5: 125 t/s"
  - Pricing observations without quality judgment: "ChatGPT costs the same as a Starbucks drink"
  - Pure news/funding/company strategy: "OpenAI raised $6B"
  - Posts where the model is mentioned but the opinion is about something else (a platform, a person, society)

KEY TEST: "Is this person expressing satisfaction or frustration with the MODEL ITSELF based on using it?" If no → not relevant.

LANGUAGE: If a post is NOT in English, detect the language (ISO 639-1 code) and provide a concise English translation. Classify sentiment based on the translated meaning. If the post IS in English, set both to null.

SENTIMENT (if relevant):
- "positive": praising, impressed, satisfied
- "negative": complaining, frustrated, disappointed
- "neutral": genuinely mixed or purely factual (should be RARE)

IMPORTANT: If the post describes switching away from, leaving, or replacing the model being discussed, that is NEGATIVE sentiment — even if the overall tone is positive. "I'm happily moving to X, done with Y" is negative for Y. Conversely, if someone is switching TO the model, that is POSITIVE.

IMPORTANT: Watch for sarcasm and irony. Classify based on TRUE intent, not surface tone. "At least ChatGPT would be sycophants" is NEGATIVE.

CATEGORY (if relevant):
If negative: lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning
If positive: output_quality, coding_quality, speed, reasoning, creativity, value, reliability, context_handling, multimodal_quality, general_improvement

Category guidance: hallucinations = model generated false info (NOT someone using the model to generate content). censorship = model refused due to safety filters (NOT copyright concerns). general_drop = quality declined (NOT societal AI concerns). lazy_responses = low-effort text (NOT image/video artifacts — use multimodal_quality).

CONFIDENCE: 0.0-1.0 (0.9+ = explicit model name + clear sentiment from direct experience, 0.7-0.8 = clear but indirect, below 0.5 = weak)

Return ONLY a JSON array with one object per post in the same order:
[{"relevant": true/false, "sentiment": "..."/null, "complaint_category": "..."/null, "praise_category": "..."/null, "confidence": 0.0-1.0, "language": "..."/null, "english_translation": "..."/null}, ...]

Posts to classify:
`;

interface ClaudeClassification {
  relevant: boolean;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number;
}

interface StoredPost {
  id: string;
  title: string | null;
  content: string | null;
  sentiment: string | null;
  complaint_category: string | null;
  praise_category: string | null;
  confidence: number | null;
}

const SKIP: ClaudeClassification = {
  relevant: false,
  sentiment: null,
  complaint_category: null,
  praise_category: null,
  confidence: 0,
};

async function classifyBatchViaClaude(
  texts: string[],
  apiKey: string,
): Promise<ClaudeClassification[]> {
  if (texts.length === 0) return [];
  const numbered = texts.map((t, j) => `Post ${j + 1}: "${t.slice(0, 600)}"`).join("\n\n");

  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: BATCH_CLASSIFY_PROMPT + numbered }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.content?.[0]?.text || "";
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Unparseable Anthropic response: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed)) return Array(texts.length).fill(SKIP);

  return Array.from({ length: texts.length }, (_, j) => {
    const item = parsed[j];
    if (!item) return SKIP;
    return {
      relevant: item.relevant !== false,
      sentiment: typeof item.sentiment === "string" ? item.sentiment : null,
      complaint_category: typeof item.complaint_category === "string" ? item.complaint_category : null,
      praise_category: typeof item.praise_category === "string" ? item.praise_category : null,
      confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!isInternalServiceRequest(req)) return internalOnlyResponse(corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      await supabase.from("error_log").insert({
        function_name: "check-gemini-self-bias",
        error_message: "ANTHROPIC_API_KEY not configured",
        context: "config-error",
      });
      return new Response(
        JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: gemini, error: modelErr } = await supabase
      .from("models")
      .select("id")
      .eq("slug", "gemini")
      .single();
    if (modelErr || !gemini) throw new Error(`Gemini model lookup failed: ${modelErr?.message}`);

    const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
    const { data: posts, error: postsErr } = await supabase
      .from("scraped_posts")
      .select("id, title, content, sentiment, complaint_category, praise_category, confidence")
      .eq("model_id", gemini.id)
      .not("sentiment", "is", null)
      .gte("posted_at", since)
      .order("id", { ascending: false })
      .limit(SAMPLE_SIZE);
    if (postsErr) throw postsErr;
    const sample = (posts as StoredPost[] | null) ?? [];
    if (sample.length === 0) {
      return new Response(
        JSON.stringify({ message: "No Gemini posts found in window", sample_size: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Re-classify each post via Claude Sonnet, batched.
    const texts = sample.map((p) => `${p.title || ""} ${p.content || ""}`.trim().slice(0, 1200));
    const claudeResults: ClaudeClassification[] = [];
    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);
      const results = await classifyBatchViaClaude(batch, apiKey);
      claudeResults.push(...results);
      if (i + BATCH_SIZE < texts.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Compare stored Gemini classifications vs Claude reclassifications.
    let bothRelevant = 0;
    let sentimentMatches = 0;
    let complaintsCompared = 0;
    let complaintMatches = 0;
    let confidenceDeltaSum = 0;
    let confidenceCount = 0;
    let claudeIrrelevant = 0;

    for (let i = 0; i < sample.length; i++) {
      const stored = sample[i];
      const claude = claudeResults[i];
      if (!claude) continue;
      if (!claude.relevant) { claudeIrrelevant++; continue; }
      bothRelevant++;
      if (claude.sentiment === stored.sentiment) sentimentMatches++;
      if (stored.sentiment === "negative" && claude.sentiment === "negative") {
        complaintsCompared++;
        if (claude.complaint_category === stored.complaint_category) complaintMatches++;
      }
      confidenceDeltaSum += Math.abs(claude.confidence - (stored.confidence ?? 0));
      confidenceCount++;
    }

    const sentimentFlipRate = bothRelevant > 0 ? 1 - sentimentMatches / bothRelevant : 0;
    const complaintDisagreementRate =
      complaintsCompared > 0 ? 1 - complaintMatches / complaintsCompared : 0;
    const avgConfidenceDelta = confidenceCount > 0 ? confidenceDeltaSum / confidenceCount : 0;

    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const summary = {
      sample_size: sample.length,
      lookback_days: LOOKBACK_DAYS,
      claude_irrelevant: claudeIrrelevant,
      both_relevant: bothRelevant,
      sentiment_flip_rate: round3(sentimentFlipRate),
      complaints_compared: complaintsCompared,
      complaint_disagreement_rate: round3(complaintDisagreementRate),
      avg_confidence_delta: round3(avgConfidenceDelta),
      sample_post_ids: sample.map((p) => p.id),
      model_versions: { gemini: "2.5-flash", claude: ANTHROPIC_MODEL },
      generated_at: new Date().toISOString(),
    };

    await supabase.from("error_log").insert({
      function_name: "check-gemini-self-bias",
      error_message: `Self-bias: n=${summary.sample_size}, sentiment_flip=${(sentimentFlipRate * 100).toFixed(1)}%, complaint_disagreement=${(complaintDisagreementRate * 100).toFixed(1)}%`,
      context: JSON.stringify(summary),
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({
      function_name: "check-gemini-self-bias",
      error_message: msg,
      context: "self_bias_check_error",
    });
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
