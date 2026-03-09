import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const INSTANCES = ["mastodon.social", "mastodon.online", "techhub.social", "sigmoid.social"];
const HASHTAGS = ["chatgpt", "claudeai", "gemini", "grok", "deepseek", "llm", "aitools"];

const SEARCH_QUERIES = [
  "Claude AI", "ChatGPT", "GPT dumber", "Claude worse", "Gemini bad", "AI getting worse",
];
const SEARCH_INSTANCE = "mastodon.social";

interface KeywordEntry { keyword: string; tier: string; context_words: string | null; model_slug: string; }

async function loadKeywords(supabase: any): Promise<{ modelMap: Record<string, string>; keywords: KeywordEntry[] }> {
  const { data: models } = await supabase.from("models").select("id, slug");
  const modelMap: Record<string, string> = {};
  const slugById: Record<string, string> = {};
  for (const m of models || []) { modelMap[m.slug] = m.id; slugById[m.id] = m.slug; }
  const { data: kws } = await supabase.from("model_keywords").select("keyword, tier, context_words, model_id");
  const keywords: KeywordEntry[] = (kws || []).map((k: any) => ({
    keyword: k.keyword, tier: k.tier, context_words: k.context_words, model_slug: slugById[k.model_id] || "",
  }));
  return { modelMap, keywords };
}

function matchModels(text: string, keywords: KeywordEntry[]): string[] {
  const matched: string[] = [];
  const lower = text.toLowerCase();
  const highKws = keywords.filter(k => k.tier === "high").sort((a, b) => b.keyword.length - a.keyword.length);
  for (const k of highKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (regex.test(lower)) matched.push(k.model_slug);
  }
  const ambigKws = keywords.filter(k => k.tier === "ambiguous");
  for (const k of ambigKws) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (!regex.test(lower)) continue;
    if (!k.context_words) { matched.push(k.model_slug); continue; }
    const contextList = k.context_words.split(",").map(w => w.trim().toLowerCase());
    if (contextList.some(cw => lower.includes(cw))) matched.push(k.model_slug);
  }
  return matched;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function isEnglish(text: string): boolean {
  const nw = text.replace(/\s/g, "");
  if (nw.length < 5) return true;
  return ((nw.match(/[a-zA-Z]/g) || []).length / nw.length) >= 0.6;
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/<[^>]*>/g, "").trim();
}

function meetsMinLength(content: string): boolean {
  return stripUrls(content).replace(/\s+/g, " ").trim().length >= 20;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: "scrape-mastodon", error_message: msg, context: ctx || null }); } catch {}
}

const CLASSIFY_PROMPT = `You are analyzing a social media post to determine if it expresses an opinion about the quality or performance of an AI language model (like ChatGPT, Claude, Gemini, Grok, DeepSeek, or Perplexity).

Step 1 — RELEVANCE: Is this post actually about the user's experience with an AI model's quality, performance, or behavior? Posts about AI news, company business decisions, stock prices, hiring, or general AI discussion WITHOUT a quality opinion are NOT relevant.

Step 2 — If relevant, classify sentiment and complaint type. Complaint categories:
- lazy_responses: Short, low-effort, truncated, or incomplete answers
- hallucinations: Making up facts, citations, or code that doesn't exist
- refusals: Refusing reasonable requests, over-cautious safety filtering
- coding_quality: Producing buggy, outdated, or non-working code
- speed: Slow response times, high latency
- general_drop: Vague "it got worse" without specifics
- pricing_value: Complaints about cost, token pricing, plan limits, value for money
- censorship: Over-filtering, nanny behavior, political bias, ideological slant in responses
- context_window: Forgetting context, losing thread in long conversations, ignoring earlier instructions
- api_reliability: API errors, timeouts, rate limits, downtime, 500 errors
- multimodal_quality: Poor image generation/understanding, voice issues, file handling problems
- reasoning: Logic errors, math mistakes, poor analysis (distinct from hallucinations — the model reasons badly rather than inventing facts)

Also return a "confidence" field between 0.0 and 1.0 indicating how confident you are in this classification. 1.0 = clearly about this model with clear sentiment. 0.5 = ambiguous or could go either way. 0.0 = random guess.

Return ONLY valid JSON:
{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral", "complaint_category": "lazy_responses"/"hallucinations"/"refusals"/"coding_quality"/"speed"/"general_drop"/"pricing_value"/"censorship"/"context_window"/"api_reliability"/"multimodal_quality"/"reasoning"/null, "confidence": 0.0-1.0}

If relevant is false, sentiment and complaint_category should be null.
Classify as neutral ONLY if genuinely no opinion is expressed. When in doubt between neutral and negative, lean negative. When in doubt between neutral and positive, lean positive.

Post to classify: `;

async function classifyPost(text: string, apiKey: string): Promise<{ relevant: boolean; sentiment: string | null; complaint_category: string | null; confidence: number }> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: CLASSIFY_PROMPT + text.slice(0, 600) }] }),
    });
    if (!res.ok) return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 };
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { relevant: parsed.relevant !== false, sentiment: parsed.sentiment || null, complaint_category: parsed.complaint_category || null, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5 };
    }
    return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 };
  } catch { return { relevant: true, sentiment: "neutral", complaint_category: null, confidence: 0.5 }; }
}

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

interface Status {
  id: string;
  content: string;
  created_at: string;
  url: string;
  favourites_count: number;
  reblogs_count: number;
  language: string | null;
  account?: { acct?: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    await logToErrorLog(supabase, "Mastodon scraper started (v3 - multi-instance + search)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "mastodon");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 3600000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, langSkipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    // Collect all statuses, deduped by URL
    const allStatuses = new Map<string, Status>();

    // Phase 1: Hashtag timelines across all instances
    for (const instance of INSTANCES) {
      for (const hashtag of HASHTAGS) {
        await delay(1000);
        try {
          const url = `https://${instance}/api/v1/timelines/tag/${hashtag}?limit=40`;
          const res = await fetchWithTimeout(url);
          if (!res.ok) { summary.errors.push(`${instance}/#${hashtag}: HTTP ${res.status}`); continue; }
          const statuses: Status[] = await res.json();
          if (!Array.isArray(statuses)) continue;
          for (const s of statuses) {
            if (s.url && !allStatuses.has(s.url)) allStatuses.set(s.url, s);
          }
        } catch (e) {
          summary.errors.push(`${instance}/#${hashtag}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Phase 2: Search queries on mastodon.social
    for (const query of SEARCH_QUERIES) {
      await delay(1000);
      try {
        const url = `https://${SEARCH_INSTANCE}/api/v2/search?q=${encodeURIComponent(query)}&type=statuses&limit=20`;
        const res = await fetchWithTimeout(url);
        if (!res.ok) { summary.errors.push(`search "${query}": HTTP ${res.status}`); continue; }
        const result = await res.json();
        const statuses: Status[] = result.statuses || [];
        for (const s of statuses) {
          if (s.url && !allStatuses.has(s.url)) allStatuses.set(s.url, s);
        }
      } catch (e) {
        summary.errors.push(`search "${query}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    summary.fetched = allStatuses.size;

    // Phase 3: Process all collected statuses
    for (const [sourceUrl, status] of allStatuses) {
      const createdAt = new Date(status.created_at);
      if (createdAt < cutoff) continue;

      const lang = status.language;
      if (lang && lang !== "en" && !lang.startsWith("en")) { summary.langSkipped++; continue; }

      const content = stripHtml(status.content || "");
      if (!isEnglish(content)) { summary.langSkipped++; continue; }
      if (!meetsMinLength(content)) { summary.contentSkipped++; continue; }

      const matchedSlugs = matchModels(content, keywords);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      if (existingUrls.has(sourceUrl)) { summary.dedupSkipped++; continue; }

      const classification = await classifyPost(content, lovableApiKey);
      summary.classified++;
      if (!classification.relevant) { summary.irrelevant++; continue; }

      const score = (status.favourites_count || 0) + (status.reblogs_count || 0);

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;
        const { error } = await supabase.from("scraped_posts").insert({
          model_id: modelId, source: "mastodon", source_url: sourceUrl,
          title: content.slice(0, 120), content: content.slice(0, 2000),
          sentiment: classification.sentiment, complaint_category: classification.complaint_category,
          confidence: classification.confidence, content_type: "full_content",
          score, posted_at: status.created_at,
        });
        if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
          summary.inserted++;
          existingUrls.add(sourceUrl);
        }
      }
    }

    await logToErrorLog(supabase, `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} errors=${summary.errors.length}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
