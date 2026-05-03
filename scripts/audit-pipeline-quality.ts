import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const clientSource = readFileSync("src/integrations/supabase/client.ts", "utf8");
const url = clientSource.match(/SUPABASE_URL = .*?"(https:\/\/[^"]+)"/)?.[1];
const anonKey = clientSource.match(/SUPABASE_PUBLISHABLE_KEY = .*?"([^"]+)"/)?.[1];

if (!url || !anonKey) {
  throw new Error("Could not read public Supabase URL/key from src/integrations/supabase/client.ts");
}

const supabase = createClient(url, anonKey);
const PAGE_SIZE = 1000;

type WindowDays = 7 | 14 | 21;

function pacificWindow(days: WindowDays) {
  const now = new Date();
  const todayPacific = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [year, month, day] = todayPacific.split("-").map(Number);
  const end = new Date(Date.UTC(year, month - 1, day + 1, 7, 0, 0));
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

async function fetchPaged(table: string, select: string, start: string, end: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .gte("posted_at", start)
      .lt("posted_at", end)
      .order("posted_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return rows;
}

function countBy(rows: Record<string, unknown>[], key: string) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = String(row[key] ?? "NULL");
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const windows: WindowDays[] = [7, 14, 21];
  const report: Record<string, unknown> = {};

  for (const days of windows) {
    const { start, end } = pacificWindow(days);
    const posts = await fetchPaged(
      "scraped_posts",
      "model_id, source, posted_at, sentiment, complaint_category, confidence",
      start,
      end,
    );
    report[`${days}d`] = {
      window_start: start,
      window_end: end,
      posts: posts.length,
      by_source: countBy(posts, "source"),
      by_sentiment: countBy(posts, "sentiment"),
      null_sentiment: posts.filter((row) => row.sentiment == null).length,
      low_confidence: posts.filter((row) => Number(row.confidence ?? 0) < 0.65).length,
      negative_without_category: posts.filter((row) => row.sentiment === "negative" && !row.complaint_category).length,
      pagination_verified: days !== 21 || posts.length > PAGE_SIZE,
    };
  }

  const [{ data: runs, error: runsError }, { data: errors, error: errorsError }] = await Promise.all([
    supabase.rpc("get_scraper_monitor_runs", { limit_count: 1000 }),
    supabase.rpc("get_recent_errors", { hours_back: 504 }),
  ]);
  if (runsError) throw runsError;
  if (errorsError) throw errorsError;

  report.scraper_runs = {
    rows: runs?.length ?? 0,
    by_status: countBy((runs ?? []) as Record<string, unknown>[], "status"),
  };
  report.recent_errors_21d = {
    rows: errors?.length ?? 0,
    top: (errors ?? []).slice(0, 10),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
