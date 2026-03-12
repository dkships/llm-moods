import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyPost } from "../_shared/classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REPOS: { owner: string; repo: string; defaultSlug: string | null }[] = [
  { owner: "anthropics", repo: "anthropic-sdk-python", defaultSlug: "claude" },
  { owner: "anthropics", repo: "courses", defaultSlug: "claude" },
  { owner: "openai", repo: "openai-python", defaultSlug: "chatgpt" },
  { owner: "google-gemini", repo: "generative-ai-python", defaultSlug: "gemini" },
  { owner: "deepseek-ai", repo: "DeepSeek-V3", defaultSlug: "deepseek" },
  { owner: "ollama", repo: "ollama", defaultSlug: null },
  { owner: "ggerganov", repo: "llama.cpp", defaultSlug: null },
];

const DELAY_MS = 2000;
const USER_AGENT = "llmvibes:v1.0";

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
  for (const k of keywords.filter(k => k.tier === "high").sort((a, b) => b.keyword.length - a.keyword.length)) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (regex.test(lower)) matched.push(k.model_slug);
  }
  for (const k of keywords.filter(k => k.tier === "ambiguous")) {
    if (matched.includes(k.model_slug)) continue;
    const regex = new RegExp(`\\b${k.keyword.replace(/[-\.]/g, "[-\\s.]?")}\\b`, "i");
    if (!regex.test(lower)) continue;
    if (!k.context_words) { matched.push(k.model_slug); continue; }
    const contextList = k.context_words.split(",").map(w => w.trim().toLowerCase());
    if (contextList.some(cw => lower.includes(cw))) matched.push(k.model_slug);
  }
  return matched;
}

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: "scrape-github", error_message: msg, context: ctx || null }); } catch {}
}

const CLASSIFY_PROMPT = `You are analyzing a GitHub issue to determine if it expresses an opinion about the quality or performance of an AI language model (like ChatGPT, Claude, Gemini, Grok, DeepSeek, or Perplexity).

Step 1 — RELEVANCE: Is this issue about the user's experience with an AI model's quality, performance, or behavior? Pure bug reports about SDK code (not model behavior), feature requests, documentation issues, or build problems are NOT relevant. Issues describing unexpected MODEL behavior ARE relevant.

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
Classify as neutral ONLY if genuinely no opinion is expressed. When in doubt between neutral and negative, lean negative.

Issue to classify: `;

async function classifyPost(text: string, apiKey: string): Promise<{ relevant: boolean; sentiment: string | null; complaint_category: string | null; confidence: number }> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: CLASSIFY_PROMPT + text.slice(0, 800) }] }),
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    await logToErrorLog(supabase, "GitHub scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "github").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, prSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const { owner, repo, defaultSlug } of REPOS) {
      if (reqIdx > 0) await delay(DELAY_MS);
      reqIdx++;

      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=20&since=${since}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github.v3+json" },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          summary.errors.push(`${owner}/${repo}: HTTP ${res.status}`);
          continue;
        }

        const issues: any[] = await res.json();
        if (!Array.isArray(issues)) continue;
        summary.fetched += issues.length;

        for (const issue of issues) {
          // Skip pull requests
          if (issue.pull_request) { summary.prSkipped++; continue; }

          const title = (issue.title || "").slice(0, 500);
          const body = (issue.body || "").slice(0, 500);
          const text = `${title} ${body}`;
          const htmlUrl = issue.html_url || "";
          const createdAt = issue.created_at || new Date().toISOString();
          const reactions = issue.reactions?.total_count || 0;
          const comments = issue.comments || 0;
          const score = reactions + comments;

          // Model matching
          let matchedSlugs: string[];
          if (defaultSlug) {
            matchedSlugs = [defaultSlug];
            // Also check for mentions of other models
            for (const s of matchModels(text, keywords)) {
              if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
            }
          } else {
            matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;
          }
          summary.filtered++;

          if (existingUrls.has(htmlUrl)) continue;

          const classification = await classifyPost(text, lovableApiKey);
          summary.classified++;
          if (!classification.relevant) { summary.irrelevant++; continue; }

          const contentType = body.trim() ? "title_and_body" : "title_only";

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "github", source_url: htmlUrl,
              title, content: body.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              confidence: classification.confidence, content_type: contentType,
              score, posted_at: createdAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
              summary.inserted++;
              existingUrls.add(htmlUrl);
            }
          }
        }
      } catch (e) {
        summary.errors.push(`${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logToErrorLog(supabase, `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} prSkipped=${summary.prSkipped}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
