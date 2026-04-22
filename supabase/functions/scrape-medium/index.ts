import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, meetsMinLength, loadRecentTitleKeys, isDuplicate, logToErrorLog } from "../_shared/utils.ts";

const FEED_URLS = [
  "https://medium.com/feed/tag/chatgpt",
  "https://medium.com/feed/tag/claude-ai",
  "https://medium.com/feed/tag/llm",
  "https://medium.com/feed/tag/artificial-intelligence",
  "https://medium.com/feed/tag/openai",
];

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;

    await logToErrorLog(supabase, "scrape-medium", "Function started (v2)", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "medium").limit(10000);
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

        // Pass 1: collect candidates
        const candidates: { classifyText: string; matchedSlugs: string[]; link: string; title: string; content: string; postedAt: string }[] = [];
        for (const itemXml of items) {
          const title = stripHtml(extractTag(itemXml, "title"));
          const link = extractTag(itemXml, "link");
          const pubDate = extractTag(itemXml, "pubDate");
          const contentEncoded = extractTag(itemXml, "content:encoded");
          const content = stripHtml(contentEncoded).slice(0, 2000);

          if (!title || !link) continue;
          if (pubDate && new Date(pubDate).getTime() < twoDaysAgo) continue;
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

          candidates.push({ classifyText: `${title} ${content}`, matchedSlugs, link, title, content, postedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString() });
        }

        // Pass 2: batch classify
        const mediumLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-medium", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.classifyText), lovableApiKey, 25, mediumLogError);
        summary.classified += classifications.length;
        summary.irrelevant += classifications.filter(c => !c.relevant).length;

        // Pass 2b: Re-classify each matched model with targeted sentiment.
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
              lovableApiKey, 25, mediumLogError
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
            const modelId = modelMap[slug];
            if (!modelId || isDuplicate(titleKeys, c.title, modelId)) continue;
            const cls = targetedMap.get(`${i}:${slug}`) || classification;
            if (!cls.relevant) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "medium", source_url: c.link,
              title: c.title.slice(0, 500), content: c.content.slice(0, 2000),
              sentiment: cls.sentiment, complaint_category: cls.complaint_category,
              praise_category: cls.praise_category,
              confidence: cls.confidence, content_type: "title_and_body",
              original_language: cls.language || null,
              translated_content: cls.english_translation || null,
              score: 0,
              posted_at: c.postedAt,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(error.message); } else {
              summary.inserted++;
              existingUrls.add(c.link);
              titleKeys.add(`${modelId}:${c.title.slice(0, 80).toLowerCase()}`);
            }
          }
        }
      } catch (e) { summary.errors.push(`Feed ${feedUrl}: ${e instanceof Error ? e.message : "unknown"}`); }
      await delay(2000);
    }

    await logToErrorLog(supabase, "scrape-medium", `Done: inserted=${summary.inserted} feeds=${summary.feeds} items=${summary.items} classified=${summary.classified} irrelevant=${summary.irrelevant}`, `skipped=${summary.skipped} errors=${summary.errors.length}`);

    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-medium", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
