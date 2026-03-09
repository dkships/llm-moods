import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUBREDDITS = ["ClaudeAI", "ChatGPT", "LocalLLaMA", "GoogleGemini", "singularity", "artificial", "deepseek"];

const DEDICATED_SUB_SLUGS: Record<string, string> = {
  ClaudeAI: "claude",
  ChatGPT: "chatgpt",
  GoogleGemini: "gemini",
  deepseek: "deepseek",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
};

const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const DELAY_MS = 3000;

function matchModels(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const [slug, keywords] of Object.entries(MODEL_KEYWORDS)) {
    for (const kw of keywords) {
      const regex = new RegExp(`\\b${kw.replace("-", "[-\\s]?")}\\b`, "i");
      if (regex.test(lower)) {
        if (!matched.includes(slug)) matched.push(slug);
        break;
      }
    }
  }
  return matched;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ").trim();
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, fn: string, msg: string, ctx?: string) {
  try { await supabase.from("error_log").insert({ function_name: fn, error_message: msg, context: ctx || null }); } catch {}
}

async function classifyPost(title: string, content: string, apiKey: string): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Post: ${title} ${truncated}`;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) return { sentiment: "neutral", complaint_category: null };
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
    }
    return { sentiment: "neutral", complaint_category: null };
  } catch { return { sentiment: "neutral", complaint_category: null }; }
}

interface RssEntry {
  title: string;
  link: string;
  updated: string;
  content: string;
  author: string;
}

function parseRssEntries(xml: string): RssEntry[] {
  const entries: RssEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;
  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = block.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] || "";
    const link = block.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] || block.match(/<link[^>]*href="([^"]*)"[^>]*>/)?.[1] || "";
    const updated = block.match(/<updated>([\s\S]*?)<\/updated>/)?.[1] || "";
    const contentRaw = block.match(/<content[^>]*>([\s\S]*?)<\/content>/)?.[1] || "";
    const author = block.match(/<author>\s*<name[^>]*>([\s\S]*?)<\/name>/)?.[1] || "";
    entries.push({ title: stripHtml(title), link, updated, content: stripHtml(contentRaw), author });
  }
  return entries;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await logToErrorLog(supabase, "scrape-reddit", "RSS scraper started", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "reddit");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = Date.now() - 86400 * 1000;
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const sub of SUBREDDITS) {
      if (reqIdx > 0) await delay(DELAY_MS);
      const url = `https://www.reddit.com/r/${sub}/new/.rss?limit=25`;
      reqIdx++;

      let res: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        res = await fetch(url, { headers: { "User-Agent": BROWSER_UA }, signal: controller.signal });
        clearTimeout(timer);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await logToErrorLog(supabase, "scrape-reddit", `Fetch failed r/${sub}: ${msg}`, "fetch-error");
        summary.errors.push(`r/${sub}: ${msg}`);
        continue;
      }

      const bodyText = await res.text();

      if (reqIdx <= 3) {
        await logToErrorLog(supabase, "scrape-reddit", `RSS r/${sub} status=${res.status} body=${bodyText.slice(0, 500)}`, "debug-rss");
      }

      if (res.status === 403 || res.status === 429) {
        await logToErrorLog(supabase, "scrape-reddit", `RSS blocked: HTTP ${res.status} for r/${sub}`, "blocked");
        summary.errors.push(`r/${sub}: HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) {
        summary.errors.push(`r/${sub}: HTTP ${res.status}`);
        continue;
      }

      const entries = parseRssEntries(bodyText);
      summary.fetched += entries.length;
      const defaultSlug = DEDICATED_SUB_SLUGS[sub] || undefined;

      for (const entry of entries) {
        const entryTime = new Date(entry.updated).getTime();
        if (isNaN(entryTime) || entryTime < cutoff) continue;

        const text = `${entry.title} ${entry.content}`;
        let matchedSlugs = defaultSlug ? [defaultSlug] : matchModels(text);
        if (!defaultSlug && matchedSlugs.length === 0) continue;
        if (defaultSlug) {
          for (const s of matchModels(text)) {
            if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
          }
        }
        summary.filtered++;

        if (existingUrls.has(entry.link)) continue;

        const classification = await classifyPost(entry.title, entry.content, lovableApiKey);
        summary.classified++;

        for (const slug of matchedSlugs) {
          const modelId = modelMap[slug];
          if (!modelId) continue;

          const { error: insertErr } = await supabase.from("scraped_posts").insert({
            model_id: modelId, source: "reddit", source_url: entry.link,
            title: entry.title.slice(0, 500), content: entry.content.slice(0, 2000),
            sentiment: classification.sentiment, complaint_category: classification.complaint_category,
            score: 0, posted_at: entry.updated || new Date().toISOString(),
          });

          if (insertErr) {
            summary.errors.push(`Insert: ${insertErr.message}`);
          } else {
            summary.inserted++;
            existingUrls.add(entry.link);
          }
        }
      }
    }

    await logToErrorLog(supabase, "scrape-reddit",
      `Completed: ${summary.inserted} inserted, ${summary.fetched} fetched, ${summary.filtered} filtered, ${summary.classified} classified, ${summary.errors.length} errors`,
      `requests=${reqIdx}`
    );

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown error";
    await logToErrorLog(supabase, "scrape-reddit", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
