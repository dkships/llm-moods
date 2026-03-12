import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CLASSIFY_PROMPT = `You are analyzing a social media post to determine if it expresses an opinion about the quality or performance of an AI language model (like ChatGPT, Claude, Gemini, Grok, DeepSeek, or Perplexity).

Step 1 — RELEVANCE: Is this post actually about the user's experience with an AI model's quality, performance, or behavior? Posts about AI news, company business decisions, stock prices, hiring, or general AI discussion WITHOUT a quality opinion are NOT relevant.

Step 2 — If relevant, classify sentiment and complaint type. Complaint categories:
- lazy_responses, hallucinations, refusals, coding_quality, speed, general_drop, pricing_value, censorship, context_window, api_reliability, multimodal_quality, reasoning

Also return a "confidence" field between 0.0 and 1.0.

Return ONLY valid JSON:
{"relevant": true/false, "sentiment": "positive"/"negative"/"neutral", "complaint_category": "category"/null, "confidence": 0.0-1.0}

If relevant is false, sentiment and complaint_category should be null.
Classify as neutral ONLY if genuinely no opinion is expressed. When in doubt between neutral and negative, lean negative. When in doubt between neutral and positive, lean positive.

Post to classify: `;

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;

  try {
    // Get batch of unclassified posts (neutral + confidence 0.5 = fallback)
    const batchSize = 50;
    const { data: posts, error: fetchErr } = await supabase
      .from("scraped_posts")
      .select("id, title, content")
      .eq("sentiment", "neutral")
      .eq("confidence", 0.5)
      .gte("posted_at", "2026-03-10")
      .limit(batchSize);

    if (fetchErr) throw fetchErr;
    if (!posts || posts.length === 0) {
      return new Response(JSON.stringify({ message: "No posts to reclassify", remaining: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let classified = 0, irrelevant = 0, errors = 0;

    for (const post of posts) {
      const text = `${post.title || ""} ${post.content || ""}`.trim();
      if (!text) { errors++; continue; }

      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-2.5-flash-lite",
            messages: [{ role: "user", content: CLASSIFY_PROMPT + text.slice(0, 600) }],
          }),
        });

        if (!res.ok) {
          errors++;
          if (classified === 0 && errors >= 3) {
            // API is down, stop early
            return new Response(JSON.stringify({
              error: `AI gateway returning ${res.status}`,
              classified, irrelevant, errors,
              remaining: posts.length - classified - irrelevant - errors,
            }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          continue;
        }

        const data = await res.json();
        const raw = data.choices?.[0]?.message?.content || "";
        const jsonMatch = raw.match(/\{[\s\S]*?\}/);

        if (!jsonMatch) { errors++; continue; }

        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.relevant === false) {
          // Delete irrelevant posts
          await supabase.from("scraped_posts").delete().eq("id", post.id);
          irrelevant++;
        } else {
          await supabase.from("scraped_posts").update({
            sentiment: parsed.sentiment || "neutral",
            complaint_category: parsed.complaint_category || null,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
          }).eq("id", post.id);
          classified++;
        }

        // Small delay to avoid hammering the API
        await delay(100);
      } catch (e) {
        errors++;
      }
    }

    // Check remaining
    const { count } = await supabase
      .from("scraped_posts")
      .select("id", { count: "exact", head: true })
      .eq("sentiment", "neutral")
      .eq("confidence", 0.5)
      .gte("posted_at", "2026-03-10");

    return new Response(JSON.stringify({
      classified, irrelevant, errors,
      remaining: count || 0,
      message: (count || 0) > 0 ? "Call again to process more" : "All done!",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
