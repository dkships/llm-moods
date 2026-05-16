/**
 * Generates the per-(date, model, surface) sentiment dataset shipped with
 * the surface-segmentation research article. Reads scraped_posts via the
 * public anon key (read-only), runs the lexical surface detector client-side,
 * and writes:
 *
 *   public/research/surface-segmentation-march-may-2026/data.csv
 *
 * Also prints a stderr coverage report so the author can spot-check whether
 * any (model, surface) cell is under-resourced before publishing.
 *
 * Run: npx tsx scripts/generate-surface-dataset.ts
 */

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { detectProductSurface } from "../src/lib/product-surface.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(
  __dirname,
  "../public/research/surface-segmentation-march-may-2026/data.csv",
);

const WINDOW_START = "2026-03-15"; // Pacific-day, inclusive
const WINDOW_END = "2026-05-14"; // Pacific-day, inclusive

const PAGE_SIZE = 1000;
const CONFIDENCE_FLOOR = 0.65;
const MIN_ELIGIBLE_PER_CELL = 5;
const SURFACE_VALUES = ["product_app", "api", "cli", "sdk", "unknown"] as const;
type SurfaceLabel = (typeof SURFACE_VALUES)[number];

interface ScrapedPostRow {
  id: string;
  model_id: string;
  source: string | null;
  title: string | null;
  content: string | null;
  posted_at: string;
  sentiment: string | null;
  complaint_category: string | null;
  confidence: number | null;
  classification_status: string | null;
  content_type: string | null;
}

interface ModelRow {
  id: string;
  slug: string;
  name: string;
}

interface CellAccumulator {
  date: string;
  model: string;
  surface: SurfaceLabel;
  total_posts: number;
  eligible_posts: number;
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  complaint_counts: Map<string, number>;
}

function loadSupabaseConfig(): { url: string; anonKey: string } {
  const clientPath = resolve(__dirname, "../src/integrations/supabase/client.ts");
  const source = readFileSync(clientPath, "utf8");
  const url = source.match(/SUPABASE_URL = .*?"(https:\/\/[^"]+)"/)?.[1];
  const anonKey = source.match(/SUPABASE_PUBLISHABLE_KEY = .*?"([^"]+)"/)?.[1];
  if (!url || !anonKey) {
    throw new Error(
      "Could not read public Supabase URL/key from src/integrations/supabase/client.ts",
    );
  }
  return { url, anonKey };
}

function pacificDateLabel(isoUtc: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(isoUtc));
}

function pacificDayBoundsToUtc(dateLabel: string): string {
  // 00:00 Pacific = 07:00 UTC (PDT) or 08:00 UTC (PST). For the article
  // window (Mar 15 – May 14, 2026) we are entirely in PDT, so 07:00 UTC.
  return `${dateLabel}T07:00:00.000Z`;
}

function isEligibleForScoring(post: ScrapedPostRow): boolean {
  if (post.classification_status === "pending") return false;
  if (post.classification_status === "retry") return false;
  if (post.classification_status === "failed") return false;
  if (post.classification_status === "irrelevant") return false;
  if (!post.sentiment) return false;
  if (post.sentiment !== "positive" && post.sentiment !== "negative" && post.sentiment !== "neutral") {
    return false;
  }
  if ((post.confidence ?? 0) < CONFIDENCE_FLOOR) return false;
  return true;
}

function computeSurrogateScore(positive: number, negative: number, neutral: number): number {
  const denominator = positive + negative + neutral;
  if (denominator === 0) return 0;
  return Math.round((100 * (positive + 0.3 * neutral)) / denominator);
}

function topComplaint(counts: Map<string, number>): string {
  if (counts.size === 0) return "";
  let topKey = "";
  let topValue = 0;
  for (const [key, value] of counts.entries()) {
    if (value > topValue) {
      topKey = key;
      topValue = value;
    }
  }
  return topKey;
}

function csvCell(value: string | number): string {
  const stringValue = String(value);
  if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

async function fetchPostsWindow(
  supabase: ReturnType<typeof createClient>,
): Promise<ScrapedPostRow[]> {
  const startUtc = pacificDayBoundsToUtc(WINDOW_START);
  // End is exclusive: include the entire 2026-05-14 PT day → up to 2026-05-15T07:00:00Z
  const endLabel = new Date(`${WINDOW_END}T00:00:00.000Z`);
  endLabel.setUTCDate(endLabel.getUTCDate() + 1);
  const endUtc = pacificDayBoundsToUtc(endLabel.toISOString().slice(0, 10));

  const rows: ScrapedPostRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("scraped_posts")
      .select(
        "id, model_id, source, title, content, posted_at, sentiment, complaint_category, confidence, classification_status, content_type",
      )
      .gte("posted_at", startUtc)
      .lt("posted_at", endUtc)
      .order("posted_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`scraped_posts page from ${from}: ${error.message}`);
    const page = (data ?? []) as ScrapedPostRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

async function fetchModels(supabase: ReturnType<typeof createClient>): Promise<ModelRow[]> {
  const { data, error } = await supabase
    .from("models")
    .select("id, slug, name");
  if (error) throw new Error(`models: ${error.message}`);
  return (data ?? []) as ModelRow[];
}

function emptyCell(date: string, model: string, surface: SurfaceLabel): CellAccumulator {
  return {
    date,
    model,
    surface,
    total_posts: 0,
    eligible_posts: 0,
    positive_count: 0,
    negative_count: 0,
    neutral_count: 0,
    complaint_counts: new Map<string, number>(),
  };
}

async function main() {
  const { url, anonKey } = loadSupabaseConfig();
  const supabase = createClient(url, anonKey);

  process.stderr.write(`[generate-surface-dataset] window: ${WINDOW_START} → ${WINDOW_END} (Pacific, inclusive)\n`);
  process.stderr.write(`[generate-surface-dataset] fetching scraped_posts...\n`);
  const [posts, models] = await Promise.all([fetchPostsWindow(supabase), fetchModels(supabase)]);
  process.stderr.write(`[generate-surface-dataset] ${posts.length} posts, ${models.length} models\n`);

  const slugById = new Map<string, string>();
  for (const model of models) slugById.set(model.id, model.slug);

  // Bucket: key = `${date}|${modelSlug}|${surface}`
  const cells = new Map<string, CellAccumulator>();
  const perModelTotals = new Map<
    string,
    { all: number; matched: number; surface_counts: Map<SurfaceLabel, number>; eligible: number }
  >();

  for (const model of models) {
    perModelTotals.set(model.slug, {
      all: 0,
      matched: 0,
      eligible: 0,
      surface_counts: new Map<SurfaceLabel, number>([
        ["product_app", 0],
        ["api", 0],
        ["cli", 0],
        ["sdk", 0],
        ["unknown", 0],
      ]),
    });
  }

  for (const post of posts) {
    const modelSlug = slugById.get(post.model_id);
    if (!modelSlug) continue;
    const dateLabel = pacificDateLabel(post.posted_at);
    const haystack = `${post.title ?? ""} ${post.content ?? ""}`.trim();
    const detected = haystack.length > 0 ? detectProductSurface(modelSlug, haystack) : null;
    const surface: SurfaceLabel = detected ? (detected.surface as SurfaceLabel) : "unknown";
    const eligible = isEligibleForScoring(post);

    const modelTotals = perModelTotals.get(modelSlug)!;
    modelTotals.all += 1;
    if (detected) modelTotals.matched += 1;
    modelTotals.surface_counts.set(surface, (modelTotals.surface_counts.get(surface) ?? 0) + 1);
    if (eligible) modelTotals.eligible += 1;

    const key = `${dateLabel}|${modelSlug}|${surface}`;
    const cell = cells.get(key) ?? emptyCell(dateLabel, modelSlug, surface);
    cell.total_posts += 1;
    if (eligible) {
      cell.eligible_posts += 1;
      if (post.sentiment === "positive") cell.positive_count += 1;
      else if (post.sentiment === "negative") cell.negative_count += 1;
      else if (post.sentiment === "neutral") cell.neutral_count += 1;
      if (post.complaint_category) {
        cell.complaint_counts.set(
          post.complaint_category,
          (cell.complaint_counts.get(post.complaint_category) ?? 0) + 1,
        );
      }
    }
    cells.set(key, cell);
  }

  // Sort: date asc, then model in [claude, chatgpt, gemini, grok], then surface
  const modelOrder = new Map([
    ["claude", 0],
    ["chatgpt", 1],
    ["gemini", 2],
    ["grok", 3],
  ]);
  const surfaceOrder = new Map<SurfaceLabel, number>([
    ["product_app", 0],
    ["api", 1],
    ["cli", 2],
    ["sdk", 3],
    ["unknown", 4],
  ]);
  const sortedCells = Array.from(cells.values()).sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const am = modelOrder.get(a.model) ?? 99;
    const bm = modelOrder.get(b.model) ?? 99;
    if (am !== bm) return am - bm;
    return (surfaceOrder.get(a.surface) ?? 99) - (surfaceOrder.get(b.surface) ?? 99);
  });

  // Write CSV
  const header = "date,model,surface,score,total_posts,positive_count,negative_count,neutral_count,top_complaint";
  const lines = [header];
  let writtenRows = 0;
  let skippedThin = 0;
  for (const cell of sortedCells) {
    if (cell.eligible_posts < MIN_ELIGIBLE_PER_CELL) {
      skippedThin += 1;
      continue;
    }
    const score = computeSurrogateScore(cell.positive_count, cell.negative_count, cell.neutral_count);
    lines.push(
      [
        cell.date,
        cell.model,
        cell.surface,
        score,
        cell.total_posts,
        cell.positive_count,
        cell.negative_count,
        cell.neutral_count,
        csvCell(topComplaint(cell.complaint_counts)),
      ].join(","),
    );
    writtenRows += 1;
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, lines.join("\n") + "\n", "utf8");

  // Coverage report
  process.stderr.write(`\n[generate-surface-dataset] coverage report (window-wide):\n`);
  for (const slug of ["claude", "chatgpt", "gemini", "grok"]) {
    const totals = perModelTotals.get(slug);
    if (!totals) continue;
    const matchRate = totals.all > 0 ? ((totals.matched / totals.all) * 100).toFixed(1) : "0.0";
    const eligibleRate = totals.all > 0 ? ((totals.eligible / totals.all) * 100).toFixed(1) : "0.0";
    process.stderr.write(
      `  ${slug.padEnd(8)} posts=${String(totals.all).padStart(5)}  matched=${String(totals.matched).padStart(5)} (${matchRate}%)  eligible=${String(totals.eligible).padStart(5)} (${eligibleRate}%)\n`,
    );
    for (const surface of SURFACE_VALUES) {
      const count = totals.surface_counts.get(surface) ?? 0;
      process.stderr.write(`           ${surface.padEnd(12)} ${String(count).padStart(5)}\n`);
    }
  }

  process.stderr.write(`\n[generate-surface-dataset] wrote ${OUTPUT_PATH}\n`);
  process.stderr.write(`[generate-surface-dataset] rows: ${writtenRows} (skipped ${skippedThin} thin cells with <${MIN_ELIGIBLE_PER_CELL} eligible posts)\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
