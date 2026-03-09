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

const FORUMS = [
  { baseUrl: "https://community.openai.com", defaultSlug: "chatgpt" },
  { baseUrl: "https://community.anthropic.com", defaultSlug: "claude" },
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
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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

    await supabase.from("error_log").insert({ function_name: "scrape-discourse", error_message: "Function started", context: "health-check" });

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "discourse");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const summary = { topics: 0, fetched: 0, inserted: 0, classified: 0, skipped: 0, errors: [] as string[] };

    for (const forum of FORUMS) {
      try {
        const res = await fetch(`${forum.baseUrl}/latest.json`);
        if (!res.ok) { summary.errors.push(`${forum.baseUrl}: ${res.status}`); await delay(2000); continue; }
        const data = await res.json();
        const topics = data?.topic_list?.topics || [];

        for (const topic of topics) {
          if (!topic.title || !topic.id || !topic.slug) continue;
          const createdAt = new Date(topic.created_at).getTime();
          if (createdAt < oneDayAgo) continue;
          if (!isEnglish(topic.title)) continue;

          summary.topics++;

          // Check if title matches any model keywords, or use forum default
          let matchedSlugs = matchModels(topic.title);
          if (matchedSlugs.length === 0) matchedSlugs = [forum.defaultSlug];

          const sourceUrl = `${forum.baseUrl}/t/${topic.slug}/${topic.id}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          // Fetch first post content
          let content = topic.title;
          try {
            await delay(2000);
            const topicRes = await fetch(`${forum.baseUrl}/t/${topic.slug}/${topic.id}.json`);
            if (topicRes.ok) {
              const topicData = await topicRes.json();
              const firstPost = topicData?.post_stream?.posts?.[0];
              if (firstPost?.cooked) {
                content = stripHtml(firstPost.cooked).slice(0, 2000);
              }
              summary.fetched++;
            }
          } catch { /* use title only */ }

          const classification = await classifyPost(topic.title, content, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "discourse", source_url: sourceUrl,
              title: topic.title.slice(0, 500), content: content.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: topic.like_count || 0,
              posted_at: topic.created_at || new Date().toISOString(),
            });
            if (error) { summary.errors.push(error.message); } else { summary.inserted++; existingUrls.add(sourceUrl); }
          }
        }
      } catch (e) {
        summary.errors.push(`${forum.baseUrl}: ${e instanceof Error ? e.message : "unknown"}`);
      }
      await delay(2000);
    }

    await supabase.from("error_log").insert({
      function_name: "scrape-discourse",
      error_message: `Done: inserted=${summary.inserted} topics=${summary.topics} fetched=${summary.fetched} classified=${summary.classified}`,
      context: `skipped=${summary.skipped} errors=${summary.errors.length}`,
    });

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await supabase.from("error_log").insert({ function_name: "scrape-discourse", error_message: msg, context: "top-level error" });
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
