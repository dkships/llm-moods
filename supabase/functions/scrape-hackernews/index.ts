import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "anthropic"],
  chatgpt: ["chatgpt", "gpt", "gpt-4", "gpt-4o", "openai"],
  gemini: ["gemini", "google ai", "deepmind"],
  grok: ["grok"],
};

const RELEVANT_DOMAINS = ["anthropic.com", "openai.com", "deepmind.google"];

const HN_API = "https://hacker-news.firebaseio.com/v0";

function matchModels(text: string, url?: string): string[] {
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
  // Check URL domain
  if (url) {
    const lowerUrl = url.toLowerCase();
    for (const domain of RELEVANT_DOMAINS) {
      if (lowerUrl.includes(domain)) {
        const slug = domain.includes("anthropic")
          ? "claude"
          : domain.includes("openai")
          ? "chatgpt"
          : "gemini";
        if (!matched.includes(slug)) matched.push(slug);
      }
    }
  }
  return matched;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    await res.text();
    return null;
  }
  return res.json();
}

async function fetchInBatches<T>(
  ids: number[],
  batchSize: number,
  delayMs: number,
  fn: (id: number) => Promise<T | null>
): Promise<(T | null)[]> {
  const results: (T | null)[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
    if (i + batchSize < ids.length) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return results;
}

async function classifyPost(
  title: string,
  content: string,
  apiKey: string
): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Post: ${title} ${truncated}`;

  try {
    const res = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash-lite",
          messages: [{ role: "user", content: prompt }],
        }),
      }
    );
    if (!res.ok) {
      await res.text();
      return { sentiment: "neutral", complaint_category: null };
    }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sentiment: parsed.sentiment || "neutral",
        complaint_category: parsed.complaint_category || null,
      };
    }
    return { sentiment: "neutral", complaint_category: null };
  } catch {
    return { sentiment: "neutral", complaint_category: null };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;

    // Fetch models
    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    // Get existing HN URLs
    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "hackernews");
    const existingUrls = new Set(
      (existing || []).map((e) => e.source_url).filter(Boolean)
    );

    // Fetch top + new story IDs
    const [topIds, newIds] = await Promise.all([
      fetchJson(`${HN_API}/topstories.json`),
      fetchJson(`${HN_API}/newstories.json`),
    ]);

    const allIds = [
      ...new Set([
        ...((topIds || []) as number[]).slice(0, 100),
        ...((newIds || []) as number[]).slice(0, 100),
      ]),
    ];

    const summary = {
      fetched: 0,
      filtered: 0,
      classified: 0,
      inserted: 0,
      errors: [] as string[],
    };

    // Fetch items in batches of 10
    const items = await fetchInBatches(allIds, 10, 200, async (id) => {
      return fetchJson(`${HN_API}/item/${id}.json`);
    });

    summary.fetched = items.filter(Boolean).length;

    for (const item of items) {
      if (!item || item.type !== "story" || !item.title) continue;

      const matchedSlugs = matchModels(item.title, item.url);
      if (matchedSlugs.length === 0) continue;
      summary.filtered++;

      const sourceUrl = `https://news.ycombinator.com/item?id=${item.id}`;
      if (existingUrls.has(sourceUrl)) continue;

      // Fetch top 5 comments
      let commentText = "";
      const kids = (item.kids || []).slice(0, 5) as number[];
      if (kids.length > 0) {
        const comments = await fetchInBatches(kids, 5, 100, async (kid) => {
          return fetchJson(`${HN_API}/item/${kid}.json`);
        });
        commentText = comments
          .filter((c) => c?.text)
          .map((c) => c!.text.replace(/<[^>]*>/g, "").slice(0, 200))
          .join(" ");
      }

      const fullContent = `${item.text || ""} ${commentText}`.trim();
      const classification = await classifyPost(
        item.title,
        fullContent,
        lovableApiKey
      );
      summary.classified++;

      for (const slug of matchedSlugs) {
        const modelId = modelMap[slug];
        if (!modelId) continue;

        const { error } = await supabase.from("scraped_posts").insert({
          model_id: modelId,
          source: "hackernews",
          source_url: sourceUrl,
          title: item.title.slice(0, 500),
          content: fullContent.slice(0, 2000),
          sentiment: classification.sentiment,
          complaint_category: classification.complaint_category,
          score: item.score || 0,
          posted_at: item.time
            ? new Date(item.time * 1000).toISOString()
            : new Date().toISOString(),
        });

        if (error) {
          summary.errors.push(`Insert: ${error.message}`);
        } else {
          summary.inserted++;
          existingUrls.add(sourceUrl);
        }
      }
    }

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-hackernews error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
