import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const FEED_URLS = [
  "https://medium.com/feed/tag/chatgpt",
  "https://medium.com/feed/tag/claude-ai",
  "https://medium.com/feed/tag/llm",
  "https://medium.com/feed/tag/artificial-intelligence",
  "https://medium.com/feed/tag/openai",
  "https://medium.com/feed/tag/deepseek",
];

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

function isEnglish(text: string): boolean {
  const nw = text.replace(/\s/g, "");
  if (nw.length < 5) return true;
  return ((nw.match(/[a-zA-Z]/g) || []).length / nw.length) >= 0.6;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/<[^>]*>/g, "").trim();
}

function meetsMinLength(title: string, content: string): boolean {
  return stripUrls(`${title} ${content}`).replace(/\s+/g, " ").trim().length >= 20;
}

async function loadRecentTitleKeys(supabase: any): Promise<Set<string>> {
  const since = new Date(Date.now() - 48 * 3600000).toISOString();
  const { data } = await supabase.from("scraped_posts").select("title, model_id").gte("posted_at", since).not("title", "is", null);
  const keys = new Set<string>();
  for (const p of data || []) if (p.title) keys.add(`${p.model_id}:${p.title.slice(0, 80).toLowerCase()}`);
  return keys;
}

function isDuplicate(titleKeys: Set<string>, title: string, modelId: string): boolean {
  return titleKeys.has(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
}

function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return (match?.[1] || match?.[2] || "").trim();
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const regex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = regex.exec(xml)) !== null) items.push(m[1]);
  return items;
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await supabase.from("error_log").insert({ function_name: "scrape-medium", error_message: "Function started (v2)", context: "health-check" });

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "medium");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const twoDaysAgo = Date.now() - 48 * 3600000;
    const summary = { feeds: 0, items: 0, inserted: 0, classified: 0, irrelevant: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const feedUrl of FEED_URLS) {
      try {
        const res = await fetch(feedUrl);
        if (!res.ok) { summary.errors.push(`Feed ${feedUrl}: ${res.status}`); await delay(2000); continue; }
        const xml = await res.text();
        summary.feeds++;

        const items = extractItems(xml);
        summary.items += items.length;

        for (const itemXml of items) {
          const title = stripHtml(extractTag(itemXml, "title"));
          const link = extractTag(itemXml, "link");
          const pubDate = extractTag(itemXml, "pubDate");
          const contentEncoded = extractTag(itemXml, "content:encoded");
          const content = stripHtml(contentEncoded).slice(0, 2000);

          if (!title || !link) continue;
          if (pubDate && new Date(pubDate).getTime() < twoDaysAgo) continue;
          if (!isEnglish(title)) continue;
          if (!meetsMinLength(title, content)) { summary.contentSkipped++; continue; }
          if (existingUrls.has(link)) { summary.skipped++; continue; }

          const matchedSlugs = matchModels(title + " " + content, keywords);
          if (matchedSlugs.length === 0) continue;

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          const classification = await classifyPost(`${title} ${content}`, lovableApiKey);
          summary.classified++;
          if (!classification.relevant) { summary.irrelevant++; continue; }

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "medium", source_url: link,
              title: title.slice(0, 500), content: content.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              confidence: classification.confidence, content_type: "title_and_body",
              score: 0,
              posted_at: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
            });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(link);
              titleKeys.add(`${modelId}:${title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`Feed ${feedUrl}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(2000);
    }

    await supabase.from("error_log").insert({
      function_name: "scrape-medium",
      error_message: `Done: inserted=${summary.inserted} feeds=${summary.feeds} items=${summary.items} classified=${summary.classified} irrelevant=${summary.irrelevant}`,
      context: `skipped=${summary.skipped} errors=${summary.errors.length}`,
    });

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "scrape-medium", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
