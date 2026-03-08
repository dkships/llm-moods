import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SUBREDDITS = [
  "ClaudeAI",
  "ChatGPT",
  "LocalLLaMA",
  "GoogleGemini",
  "singularity",
  "artificial",
];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude"],
  chatgpt: ["chatgpt", "gpt", "gpt-4", "gpt-4o"],
  gemini: ["gemini"],
  grok: ["grok"],
};

const USER_AGENT = "llmvibes:v1.0 (contact: hello@llmvibes.ai)";

function matchModels(text: string): string[] {
  const lower = text.toLowerCase();
  const matched: string[] = [];
  for (const [slug, keywords] of Object.entries(MODEL_KEYWORDS)) {
    for (const kw of keywords) {
      // Word boundary matching
      const regex = new RegExp(`\\b${kw.replace("-", "[-\\s]?")}\\b`, "i");
      if (regex.test(lower)) {
        if (!matched.includes(slug)) matched.push(slug);
        break;
      }
    }
  }
  return matched;
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
      const t = await res.text();
      console.error("AI classification failed:", res.status, t);
      return { sentiment: "neutral", complaint_category: null };
    }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    // Extract JSON from response (may be wrapped in markdown code block)
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        sentiment: parsed.sentiment || "neutral",
        complaint_category: parsed.complaint_category || null,
      };
    }
    return { sentiment: "neutral", complaint_category: null };
  } catch (e) {
    console.error("AI classification error:", e);
    return { sentiment: "neutral", complaint_category: null };
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch models for ID lookup
    const { data: models, error: modelsErr } = await supabase
      .from("models")
      .select("id, slug");
    if (modelsErr) throw modelsErr;

    const modelMap: Record<string, string> = {};
    for (const m of models || []) {
      modelMap[m.slug] = m.id;
    }

    // Get existing source_urls to skip duplicates
    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "reddit");
    const existingUrls = new Set(
      (existing || []).map((e) => e.source_url).filter(Boolean)
    );

    const summary = {
      fetched: 0,
      filtered: 0,
      classified: 0,
      inserted: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < SUBREDDITS.length; i++) {
      const sub = SUBREDDITS[i];
      if (i > 0) await delay(2000);

      try {
        const res = await fetch(
          `https://www.reddit.com/r/${sub}/new.json?limit=25`,
          { headers: { "User-Agent": USER_AGENT } }
        );
        if (!res.ok) {
          const t = await res.text();
          console.error(`Reddit fetch failed for r/${sub}:`, res.status, t);
          summary.errors.push(`r/${sub}: HTTP ${res.status}`);
          continue;
        }

        const json = await res.json();
        const posts = json?.data?.children || [];
        summary.fetched += posts.length;

        for (const child of posts) {
          const post = child.data;
          const text = `${post.title || ""} ${post.selftext || ""}`;
          const matchedSlugs = matchModels(text);

          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const sourceUrl = `https://www.reddit.com${post.permalink}`;
          if (existingUrls.has(sourceUrl)) continue;

          // Classify once per post
          const classification = await classifyPost(
            post.title || "",
            post.selftext || "",
            lovableApiKey
          );
          summary.classified++;

          // Insert one row per matched model
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;

            const { error: insertErr } = await supabase
              .from("scraped_posts")
              .insert({
                model_id: modelId,
                source: "reddit",
                source_url: sourceUrl,
                title: (post.title || "").slice(0, 500),
                content: (post.selftext || "").slice(0, 2000),
                sentiment: classification.sentiment,
                complaint_category: classification.complaint_category,
                score: post.score || 0,
                posted_at: post.created_utc
                  ? new Date(post.created_utc * 1000).toISOString()
                  : new Date().toISOString(),
              });

            if (insertErr) {
              console.error("Insert error:", insertErr);
              summary.errors.push(`Insert: ${insertErr.message}`);
            } else {
              summary.inserted++;
              existingUrls.add(sourceUrl);
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`Error processing r/${sub}:`, msg);
        summary.errors.push(`r/${sub}: ${msg}`);
      }
    }

    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scrape-reddit error:", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
