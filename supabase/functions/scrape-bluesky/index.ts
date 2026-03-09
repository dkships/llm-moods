import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SEARCH_TERMS = [
  "Claude AI", "ChatGPT", "GPT-5", "Gemini AI", "Grok AI", "DeepSeek",
  "Claude dumb", "ChatGPT worse", "DeepSeek",
];

const MODEL_KEYWORDS: Record<string, string[]> = {
  claude: ["claude", "sonnet", "opus", "anthropic"],
  chatgpt: ["chatgpt", "gpt-5", "gpt-4", "gpt-4o", "gpt", "openai"],
  gemini: ["gemini", "gemini pro", "google ai"],
  grok: ["grok", "grok 4", "xai"],
  deepseek: ["deepseek", "deepseek r1", "deepseek v3"],
};

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

function isEnglish(text: string): boolean {
  const noWhitespace = text.replace(/\s/g, "");
  if (noWhitespace.length < 5) return true;
  const latinCount = (noWhitespace.match(/[a-zA-Z]/g) || []).length;
  return latinCount / noWhitespace.length >= 0.6;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function classifyPost(
  title: string, content: string, apiKey: string
): Promise<{ sentiment: string; complaint_category: string | null }> {
  const truncated = (content || "").slice(0, 500);
  const prompt = `Classify this social media post about an AI model. Return ONLY valid JSON with two fields: sentiment (positive/negative/neutral) and complaint_category (lazy_responses/hallucinations/refusals/coding_quality/speed/general_drop or null if not negative). Classify as neutral ONLY if the post is purely factual news with zero opinion expressed. Most social media posts express some sentiment — when in doubt, choose positive or negative, not neutral. Posts with any emotional language, slang, sarcasm, or subjective judgment should NOT be neutral. Post: ${title} ${truncated}`;
  try {
    const res = await fetchWithTimeout("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-2.5-flash-lite", messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) { await res.text(); return { sentiment: "neutral", complaint_category: null }; }
    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || "";
    const jsonMatch = raw.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return { sentiment: parsed.sentiment || "neutral", complaint_category: parsed.complaint_category || null };
    }
    return { sentiment: "neutral", complaint_category: null };
  } catch {
    return { sentiment: "neutral", complaint_category: null };
  }
}

function delay(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function logToErrorLog(supabase: any, functionName: string, errorMessage: string, context?: string) {
  try {
    await supabase.from("error_log").insert({ function_name: functionName, error_message: errorMessage, context: context || null });
  } catch (e) {
    console.error("Failed to log to error_log:", e);
  }
}

async function authenticateBluesky(handle: string, appPassword: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout("https://bsky.social/xrpc/com.atproto.server.createSession", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: handle, password: appPassword }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      console.error("Bluesky auth failed:", res.status, errorText);
      return null;
    }
    const data = await res.json();
    return data.accessJwt || null;
  } catch (e) {
    console.error("Bluesky auth error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY")!;
    const blueskyHandle = Deno.env.get("BLUESKY_HANDLE");
    const blueskyAppPassword = Deno.env.get("BLUESKY_APP_PASSWORD");

    if (!blueskyHandle || !blueskyAppPassword) {
      await logToErrorLog(supabase, "scrape-bluesky", "Missing BLUESKY_HANDLE or BLUESKY_APP_PASSWORD secrets", "auth");
      return new Response(JSON.stringify({ error: "Missing Bluesky credentials" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Authenticate with Bluesky
    const accessJwt = await authenticateBluesky(blueskyHandle, blueskyAppPassword);
    if (!accessJwt) {
      await logToErrorLog(supabase, "scrape-bluesky", "Failed to authenticate with Bluesky", "auth");
      return new Response(JSON.stringify({ error: "Bluesky authentication failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await logToErrorLog(supabase, "scrape-bluesky", "Successfully authenticated with Bluesky", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug");
    const modelMap: Record<string, string> = {};
    for (const m of models || []) modelMap[m.slug] = m.id;

    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "bluesky");
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, errors: [] as string[] };

    for (let i = 0; i < SEARCH_TERMS.length; i++) {
      const term = SEARCH_TERMS[i];
      if (i > 0) await delay(1000); // 1 second delay between requests

      try {
        const url = `https://bsky.social/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(term)}&limit=25&sort=latest`;
        const res = await fetchWithTimeout(url, {
          headers: {
            "Authorization": `Bearer ${accessJwt}`,
            "Accept": "application/json",
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          const msg = `"${term}": HTTP ${res.status} - ${errorText.slice(0, 100)}`;
          summary.errors.push(msg);
          await logToErrorLog(supabase, "scrape-bluesky", `Bluesky search failed: ${msg}`, term);
          continue;
        }

        const json = await res.json();
        const posts = json.posts || [];
        summary.fetched += posts.length;

        for (const post of posts) {
          const text = post.record?.text || "";
          const createdAt = post.record?.createdAt ? new Date(post.record.createdAt) : null;
          if (!createdAt || createdAt < cutoff) continue;

          const matchedSlugs = matchModels(text);
          if (matchedSlugs.length === 0) continue;
          summary.filtered++;

          const handle = post.author?.handle || "";
          const uriParts = (post.uri || "").split("/");
          const rkey = uriParts[uriParts.length - 1];
          const sourceUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;
          if (existingUrls.has(sourceUrl)) continue;

          const classification = await classifyPost("", text, lovableApiKey);
          summary.classified++;

          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").insert({
              model_id: modelId, source: "bluesky", source_url: sourceUrl,
              title: text.slice(0, 120), content: text.slice(0, 2000),
              sentiment: classification.sentiment, complaint_category: classification.complaint_category,
              score: post.likeCount || 0, posted_at: createdAt.toISOString(),
            });
            if (error) {
              summary.errors.push(`Insert: ${error.message}`);
              await logToErrorLog(supabase, "scrape-bluesky", error.message, `insert for ${slug}`);
            } else { summary.inserted++; existingUrls.add(sourceUrl); }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        summary.errors.push(`"${term}": ${msg}`);
        await logToErrorLog(supabase, "scrape-bluesky", msg, term);
      }
    }

    await logToErrorLog(supabase, "scrape-bluesky", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} inserted=${summary.inserted}`, "summary");

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-bluesky", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
