import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const FORUMS = [
  { baseUrl: "https://community.openai.com", defaultSlug: "chatgpt" },
  { baseUrl: "https://community.anthropic.com", defaultSlug: "claude" },
];

function stripHtml(html: string): string {
  return (html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function fetchWithTimeout(url: string, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { signal: controller.signal }); } finally { clearTimeout(timer); }
}


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;

    await logToErrorLog(supabase, "scrape-discourse", "Function started (v2)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "discourse").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));
    const titleKeys = await loadRecentTitleKeys(supabase);

    const oneDayAgo = Date.now() - 24 * 3600000;
    const summary = { topics: 0, fetched: 0, inserted: 0, classified: 0, irrelevant: 0, skipped: 0, dedupSkipped: 0, contentSkipped: 0, errors: [] as string[] };

    for (const forum of FORUMS) {
      try {
        const res = await fetchWithTimeout(`${forum.baseUrl}/latest.json`);
        if (!res.ok) { summary.errors.push(`${forum.baseUrl}: HTTP ${res.status}`); await delay(2000); continue; }
        const data = await res.json();
        const topics = data?.topic_list?.topics || [];

        // Pass 1: collect candidates (including topic detail fetches)
        const candidates: { classifyText: string; matchedSlugs: string[]; sourceUrl: string; title: string; content: string; score: number; postedAt: string }[] = [];
        for (const topic of topics) {
          if (!topic.title || !topic.id || !topic.slug) continue;
          const createdAt = new Date(topic.created_at).getTime();
          if (createdAt < oneDayAgo) continue;
          summary.topics++;

          let matchedSlugs = matchModels(topic.title, keywords);
          if (matchedSlugs.length === 0) matchedSlugs = [forum.defaultSlug];

          const sourceUrl = `${forum.baseUrl}/t/${topic.slug}/${topic.id}`;
          if (existingUrls.has(sourceUrl)) { summary.skipped++; continue; }

          let content = topic.title;
          try {
            await delay(2000);
            const topicRes = await fetchWithTimeout(`${forum.baseUrl}/t/${topic.slug}/${topic.id}.json`);
            if (topicRes.ok) {
              const topicData = await topicRes.json();
              const firstPost = topicData?.post_stream?.posts?.[0];
              if (firstPost?.cooked) content = stripHtml(firstPost.cooked).slice(0, 2000);
              summary.fetched++;
            }
          } catch { /* use title only */ }

          if (!meetsMinLength(topic.title, content)) { summary.contentSkipped++; continue; }

          let allDuped = true;
          for (const slug of matchedSlugs) {
            const modelId = modelMap[slug];
            if (modelId && !isDuplicate(titleKeys, topic.title, modelId)) { allDuped = false; break; }
          }
          if (allDuped) { summary.dedupSkipped++; continue; }

          candidates.push({ classifyText: `${topic.title} ${content}`, matchedSlugs, sourceUrl, title: topic.title, content, score: topic.like_count || 0, postedAt: topic.created_at || new Date().toISOString() });
        }

        // Pass 2: batch classify
        const discourseLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-discourse", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.classifyText), lovableApiKey, 25, discourseLogError);
        summary.classified += classifications.length;
        summary.irrelevant += classifications.filter(c => !c.relevant).length;

        // Pass 2.5: targeted classification for each matched model.
        const targetedItems: { idx: number; slug: string }[] = [];
        for (let i = 0; i < candidates.length; i++) {
          if (!classifications[i].relevant) continue;
          for (const slug of candidates[i].matchedSlugs) {
            targetedItems.push({ idx: i, slug });
          }
        }
        const targetedResults = targetedItems.length > 0
          ? await classifyBatchTargeted(
              targetedItems.map(item => ({ text: candidates[item.idx].classifyText, targetModel: item.slug })),
              lovableApiKey, 25, discourseLogError
            )
          : [];
        const targetedMap = new Map<string, typeof classifications[0]>();
        targetedItems.forEach((item, j) => targetedMap.set(`${item.idx}:${item.slug}`, targetedResults[j]));

        // Pass 3: insert
        for (let i = 0; i < candidates.length; i++) {
          const classification = classifications[i];
          if (!classification.relevant) continue;
          const c = candidates[i];

          for (const slug of c.matchedSlugs) {
            const cls = targetedMap.get(`${i}:${slug}`) || classification;
            if (!cls.relevant) continue;
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "discourse", source_url: c.sourceUrl,
              title: c.title.slice(0, 500), content: c.content.slice(0, 2000),
              sentiment: cls.sentiment, complaint_category: cls.complaint_category,
              praise_category: cls.praise_category,
              confidence: cls.confidence, content_type: "title_and_body",
              score: c.score,
              posted_at: c.postedAt,
              original_language: cls.language || null, translated_content: cls.english_translation || null,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(c.sourceUrl);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`${forum.baseUrl}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(2000);
    }

    await logToErrorLog(supabase, "scrape-discourse", `Completed: posts=${summary.fetched} classified=${summary.inserted} errors=${summary.errors.length}`, "summary");

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-discourse", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
