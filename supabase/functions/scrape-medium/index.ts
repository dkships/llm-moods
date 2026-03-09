import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
  perplexity: ["perplexity", "perplexity ai", "pplx"],
};

const FEED_URLS = [
  "https://medium.com/feed/tag/chatgpt",
  "https://medium.com/feed/tag/claude-ai",
  "https://medium.com/feed/tag/llm",
  "https://medium.com/feed/tag/artificial-intelligence",
  "https://medium.com/feed/tag/openai",
  "https://medium.com/feed/tag/deepseek",
];

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

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
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/g, "").replace(/<[^>]*>/g, "").trim();
}

function meetsMinLength(title: string, content: string): boolean {
  const cleaned = stripUrls(`${title} ${content}`).replace(/\s+/g, " ").trim();
  return cleaned.length >= 20;
}

async function loadRecentTitleKeys(supabase: any): Promise<Set<string>> {
  const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from("scraped_posts").select("title, model_id").gte("posted_at", since).not("title", "is", null);
  const keys = new Set<string>();
  for (const p of data || []) {
    if (p.title) keys.add(`${p.model_id}:${p.title.slice(0, 80).toLowerCase()}`);
  }
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

async function classifyPost(title: string, content: string, apiKey: string) {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Post: ${title} ${truncated}`;
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
  } catch { /* ignore */ }
  return { sentiment: "neutral", complaint_category: null };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    await supabase.from("error_log").insert({ function_name: "scrape-medium", error_message: "Function started", context: "health-check" });

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "medium");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    const summary = { feeds: 0, items: 0, inserted: 0, classified: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

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

          const matchedSlugs = matchModels(title + " " + content);
          if (matchedSlugs.length === 0) continue;

          // Cross-source dedup
          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          const classification = await classifyPost(title, content, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "medium", source_url: link,
              title: title.slice(0, 500), content: content.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
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
      } catch (e) {
        summary.errors.push(`Feed ${feedUrl}: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await delay(2000);
    }

    await supabase.from("error_log").insert({
      function_name: "scrape-medium",
      error_message: `Done: inserted=${summary.inserted} feeds=${summary.feeds} items=${summary.items} classified=${summary.classified} dedupSkipped=${summary.dedupSkipped} contentSkipped=${summary.contentSkipped}`,
      context: `skipped=${summary.skipped} errors=${summary.errors.length}`,
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "scrape-medium", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
