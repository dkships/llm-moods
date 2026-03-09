import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCRAPERS = [
  "scrape-reddit-apify",
  "scrape-hackernews",
  "scrape-bluesky",
  "scrape-mastodon",
  "scrape-lobsters",
  "scrape-lemmy",
  "scrape-devto",
  "scrape-stackoverflow",
  "scrape-medium",
  "scrape-discourse",
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function runScraper(name: string): Promise<{
  source: string;
  posts_found: number;
  posts_classified: number;
  errors: string[];
  status: string;
  started_at: string;
  completed_at: string;
}> {
  const started_at = new Date().toISOString();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const completed_at = new Date().toISOString();

    if (!res.ok) {
      const text = await res.text().catch(() => "no body");
      return {
        source: name,
        posts_found: 0,
        posts_classified: 0,
        errors: [`HTTP ${res.status}: ${text.slice(0, 500)}`],
        status: "failed",
        started_at,
        completed_at,
      };
    }

    let body: any = {};
    try {
      body = await res.json();
    } catch {
      // Some scrapers return text
    }

    return {
      source: name,
      posts_found: body.posts_found ?? body.fetched ?? body.total ?? 0,
      posts_classified: body.posts_classified ?? body.classified ?? body.inserted ?? 0,
      errors: body.errors ?? [],
      status: (body.errors?.length ?? 0) > 0 ? "partial" : "success",
      started_at,
      completed_at,
    };
  } catch (err) {
    return {
      source: name,
      posts_found: 0,
      posts_classified: 0,
      errors: [String(err)],
      status: "failed",
      started_at,
      completed_at: new Date().toISOString(),
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const allResults: any[] = [];

  // Run scrapers in batches of 3 to avoid overwhelming resources
  for (let i = 0; i < SCRAPERS.length; i += 3) {
    const batch = SCRAPERS.slice(i, i + 3);
    const results = await Promise.all(batch.map((s) => runScraper(s)));
    allResults.push(...results);
  }

  // Insert results into scraper_runs
  const { error: insertErr } = await supabase.from("scraper_runs").insert(
    allResults.map((r) => ({
      source: r.source,
      started_at: r.started_at,
      completed_at: r.completed_at,
      posts_found: r.posts_found,
      posts_classified: r.posts_classified,
      errors: r.errors,
      status: r.status,
    }))
  );

  // Run aggregation after all scrapers
  let aggregateStatus = "success";
  try {
    const aggRes = await fetch(`${SUPABASE_URL}/functions/v1/aggregate-vibes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    if (!aggRes.ok) aggregateStatus = "failed";
  } catch {
    aggregateStatus = "failed";
  }

  const summary = {
    total_scrapers: SCRAPERS.length,
    succeeded: allResults.filter((r) => r.status === "success").length,
    partial: allResults.filter((r) => r.status === "partial").length,
    failed: allResults.filter((r) => r.status === "failed").length,
    aggregate: aggregateStatus,
    insert_error: insertErr?.message ?? null,
  };

  return new Response(JSON.stringify(summary), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
