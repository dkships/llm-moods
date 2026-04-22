import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { classifyBatch, classifyBatchTargeted } from "../_shared/classifier.ts";
import { corsHeaders, loadKeywords, matchModels, logToErrorLog } from "../_shared/utils.ts";

const REPOS: { owner: string; repo: string; defaultSlug: string | null }[] = [
  { owner: "anthropics", repo: "anthropic-sdk-python", defaultSlug: "claude" },
  { owner: "anthropics", repo: "courses", defaultSlug: "claude" },
  { owner: "openai", repo: "openai-python", defaultSlug: "chatgpt" },
  { owner: "google-gemini", repo: "generative-ai-python", defaultSlug: "gemini" },
  { owner: "ollama", repo: "ollama", defaultSlug: null },
  { owner: "ggerganov", repo: "llama.cpp", defaultSlug: null },
];

const DELAY_MS = 2000;
const USER_AGENT = "llmvibes:v1.0";

function delay(ms: number) { return new Promise(r => setTimeout(r, ms)); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const lovableApiKey = Deno.env.get("GEMINI_API_KEY")!;
    await logToErrorLog(supabase, "scrape-github", "GitHub scraper started", "health-check");

    const { modelMap, keywords } = await loadKeywords(supabase);
    const { data: existing } = await supabase.from("scraped_posts").select("source_url").eq("source", "github").limit(10000);
    const existingUrls = new Set((existing || []).map((e: any) => e.source_url).filter(Boolean));

    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const summary = { fetched: 0, filtered: 0, classified: 0, inserted: 0, irrelevant: 0, prSkipped: 0, errors: [] as string[] };
    let reqIdx = 0;

    for (const { owner, repo, defaultSlug } of REPOS) {
      if (reqIdx > 0) await delay(DELAY_MS);
      reqIdx++;

      try {
        const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=open&sort=created&direction=desc&per_page=20&since=${since}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, Accept: "application/vnd.github.v3+json" },
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          summary.errors.push(`${owner}/${repo}: HTTP ${res.status}`);
          continue;
        }

        const issues: any[] = await res.json();
        if (!Array.isArray(issues)) continue;
        summary.fetched += issues.length;

        // Pass 1: collect candidates
        const candidates: { text: string; matchedSlugs: string[]; htmlUrl: string; title: string; body: string; score: number; createdAt: string; contentType: string }[] = [];
        for (const issue of issues) {
          // Skip pull requests
          if (issue.pull_request) { summary.prSkipped++; continue; }

          const title = (issue.title || "").slice(0, 500);
          const body = (issue.body || "").slice(0, 500);
          const text = `${title} ${body}`;
          const htmlUrl = issue.html_url || "";
          const createdAt = issue.created_at || new Date().toISOString();
          const reactions = issue.reactions?.total_count || 0;
          const comments = issue.comments || 0;
          const score = reactions + comments;

          // Model matching
          let matchedSlugs: string[];
          if (defaultSlug) {
            matchedSlugs = [defaultSlug];
            // Also check for mentions of other models
            for (const s of matchModels(text, keywords)) {
              if (!matchedSlugs.includes(s)) matchedSlugs.push(s);
            }
          } else {
            matchedSlugs = matchModels(text, keywords);
            if (matchedSlugs.length === 0) continue;
          }
          summary.filtered++;

          if (existingUrls.has(htmlUrl)) continue;

          const contentType = body.trim() ? "title_and_body" : "title_only";
          candidates.push({ text, matchedSlugs, htmlUrl, title, body, score, createdAt, contentType });
        }

        // Pass 2: batch classify
        const githubLogError = async (msg: string, ctx?: string) => {
          await logToErrorLog(supabase, "scrape-github", msg, ctx || "classify");
        };
        const classifications = await classifyBatch(candidates.map(c => c.text), lovableApiKey, 25, githubLogError);
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
              targetedItems.map(item => ({ text: candidates[item.idx].text, targetModel: item.slug })),
              lovableApiKey, 25, githubLogError
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
            if (!modelId) continue;
            const { error } = await supabase.from("scraped_posts").upsert({
              model_id: modelId, source: "github", source_url: c.htmlUrl,
              title: c.title, content: c.body.slice(0, 2000),
              sentiment: cls.sentiment, complaint_category: cls.complaint_category,
              praise_category: cls.praise_category,
              confidence: cls.confidence, content_type: c.contentType,
              score: c.score, posted_at: c.createdAt,
              original_language: cls.language || null, translated_content: cls.english_translation || null,
            }, { onConflict: "source_url,model_id", ignoreDuplicates: true });
            if (error) { summary.errors.push(`Insert: ${error.message}`); } else {
              summary.inserted++;
              existingUrls.add(c.htmlUrl);
            }
          }
        }
      } catch (e) {
        summary.errors.push(`${owner}/${repo}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logToErrorLog(supabase, "scrape-github", `Completed: fetched=${summary.fetched} filtered=${summary.filtered} classified=${summary.classified} irrelevant=${summary.irrelevant} inserted=${summary.inserted} prSkipped=${summary.prSkipped}`, "summary");
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown";
    await logToErrorLog(supabase, "scrape-github", msg, "top-level error");
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
