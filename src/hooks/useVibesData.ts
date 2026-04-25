import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";
import type { Database } from "@/integrations/supabase/types";
import { normalizePublicComplaintCategory } from "@/shared/public-taxonomy";
import { getPacificDayWindowSince } from "@/lib/pacific-day";

type LandingVibesRow = Database["public"]["Functions"]["get_landing_vibes"]["Returns"][number];
type ScrapedPostRow = Database["public"]["Tables"]["scraped_posts"]["Row"];
type ModelRow = Database["public"]["Tables"]["models"]["Row"];

export interface SparklinePoint {
  score: number;
  isCarryForward: boolean;
}

export interface ComplaintBreakdownItem {
  category: string;
  count: number;
  pct: number;
}

export interface SourceBreakdownItem {
  source: string;
  count: number;
  pct: number;
}

export interface RecentChatterPost extends ScrapedPostRow {
  models: Pick<ModelRow, "name" | "accent_color" | "slug"> | null;
}

export interface ModelWithVibes {
  id: string;
  name: string;
  slug: string;
  accent_color: string | null;
  latestScore: number;
  vibe: number;
  trend: { direction: "up" | "down" | "flat"; pts: number };
  sparkline: SparklinePoint[];
  topComplaint: string | null;
  totalPosts: number;
  lastUpdated: string | null;
  /** Latest daily row had zero scraped posts — score is carried forward from
   * the previous day. UI should soften the trend chip and mark the chart point. */
  isLatestCarryForward: boolean;
}

export function useModelsWithLatestVibes() {
  return useQuery<ModelWithVibes[]>({
    queryKey: ["models-with-vibes"],
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: landing, error: lErr } = await supabase.rpc("get_landing_vibes");
      if (lErr) throw lErr;

      // Pull the last 10 daily vibes_scores rows per model directly so we can
      // surface total_posts alongside the score — get_sparkline_scores doesn't
      // return total_posts, and we need it to flag carry-forward days.
      const sinceISO = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
      const { data: sparkRows, error: sErr } = await supabase
        .from("vibes_scores")
        .select("model_id, period_start, score, total_posts")
        .eq("period", "daily")
        .gte("period_start", sinceISO)
        .order("period_start", { ascending: true });
      if (sErr) throw sErr;

      const sparkByModel = new Map<string, Array<{ score: number; total_posts: number | null }>>();
      for (const row of sparkRows || []) {
        const arr = sparkByModel.get(row.model_id) ?? [];
        arr.push({ score: row.score, total_posts: row.total_posts });
        sparkByModel.set(row.model_id, arr);
      }

      return (landing || []).map((m: LandingVibesRow): ModelWithVibes => {
        const allRows = sparkByModel.get(m.model_id) ?? [];
        const recent = allRows.slice(-7);
        const sparkline: SparklinePoint[] = recent.map((r) => ({
          score: r.score,
          isCarryForward: r.total_posts === 0,
        }));
        const latestRow = recent[recent.length - 1];
        const isLatestCarryForward = latestRow ? latestRow.total_posts === 0 : false;

        const trendPts = m.previous_score != null ? m.latest_score - m.previous_score : 0;
        const topComplaint = normalizePublicComplaintCategory(m.top_complaint);

        return {
          id: m.model_id,
          name: m.model_name,
          slug: m.model_slug,
          accent_color: m.accent_color,
          latestScore: m.latest_score ?? 50,
          vibe: m.latest_score ?? 50,
          trend: {
            direction: trendPts > 0 ? "up" : trendPts < 0 ? "down" : "flat",
            pts: Math.abs(trendPts),
          },
          sparkline,
          topComplaint,
          totalPosts: m.total_posts ?? 0,
          lastUpdated: m.last_updated ?? null,
          isLatestCarryForward,
        };
      });
    },
  });
}

const CHATTER_PAGE_SIZE = 25;

export function useRecentChatter(enabled = true) {
  return useInfiniteQuery<RecentChatterPost[]>({
    queryKey: ["recent-chatter"],
    staleTime: 60_000,
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from("scraped_posts")
        .select("*, models(name, accent_color, slug)")
        .order("posted_at", { ascending: false })
        .limit(CHATTER_PAGE_SIZE);
      if (pageParam) {
        query = query.lt("posted_at", pageParam);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as RecentChatterPost[];
    },
    getNextPageParam: (lastPage) => {
      if (lastPage.length < CHATTER_PAGE_SIZE) return undefined;
      const last = lastPage[lastPage.length - 1];
      return last?.posted_at ?? undefined;
    },
  });
}

export function useModelDetail(slug: string | undefined) {
  return useQuery({
    queryKey: ["model-detail", slug],
    enabled: !!slug,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: model, error: mErr } = await supabase
        .from("models")
        .select("*")
        .eq("slug", slug!)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!model) return null;
      return model;
    },
  });
}

export function useVibesHistory(modelId: string | undefined, period: string, range: string) {
  return useQuery({
    queryKey: ["vibes-history", modelId, period, range],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      let sinceISO: string;
      if (period === "daily") {
        const daysBack = range === "7d" ? 6 : 29;
        sinceISO = getPacificDayWindowSince(daysBack, now);
      } else if (range === "24h") {
        sinceISO = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      } else if (range === "7d") {
        sinceISO = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      } else {
        sinceISO = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      }

      const { data, error } = await supabase
        .from("vibes_scores")
        .select("*")
        .eq("model_id", modelId!)
        .eq("period", period)
        .gte("period_start", sinceISO)
        .order("period_start", { ascending: true })
        .limit(90);
      if (error) throw error;
      return data || [];
    },
  });
}

// Two raw DB categories can normalize to the same public key (e.g. `reliability`
// and `api_reliability` both collapse to `api_reliability`). Aggregate counts
// by normalized key before computing percentages, otherwise React sees
// duplicate keys when the breakdown is rendered.
function aggregateComplaintBreakdown(rows: { category: string | null; count: number | string | bigint | null }[]): ComplaintBreakdownItem[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const cat = normalizePublicComplaintCategory(row.category);
    if (!cat) continue;
    totals.set(cat, (totals.get(cat) ?? 0) + Number(row.count ?? 0));
  }
  const total = Array.from(totals.values()).reduce((sum, v) => sum + v, 0);
  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([category, count]) => ({
      category,
      count,
      pct: total > 0 ? Math.round((count / total) * 100) : 0,
    }));
}

export function useComplaintBreakdown(modelId: string | undefined) {
  return useQuery<ComplaintBreakdownItem[]>({
    queryKey: ["complaint-breakdown", modelId],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_complaint_breakdown", { p_model_id: modelId! });
      if (error) throw error;
      return aggregateComplaintBreakdown(data || []);
    },
  });
}

export function useSourceBreakdown(modelId: string | undefined) {
  return useQuery<SourceBreakdownItem[]>({
    queryKey: ["source-breakdown", modelId],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_source_breakdown", { p_model_id: modelId! });
      if (error) throw error;

      const total = (data || []).reduce((sum: number, row) => sum + Number(row.count), 0);
      return (data || []).map((row) => ({
        source: row.source,
        count: Number(row.count),
        pct: total > 0 ? Math.round((Number(row.count) / total) * 100) : 0,
      }));
    },
  });
}

// Header copy on /model/:slug claims "recent posts over the last 7 days", so
// the feed below it must respect the same window. Without this filter, a
// quiet model could surface posts weeks old and look mismatched against the
// 7-day post count in the header.
const RECENT_POSTS_WINDOW_DAYS = 7;

export function useModelPosts(modelId: string | undefined, limit = 25, enabled = true) {
  return useQuery<ScrapedPostRow[]>({
    queryKey: ["model-posts", modelId, limit],
    enabled: !!modelId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const sinceISO = new Date(Date.now() - RECENT_POSTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("*")
        .eq("model_id", modelId!)
        .gte("posted_at", sinceISO)
        .order("posted_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data || []) as ScrapedPostRow[];
    },
  });
}

/** Prefetch model detail data on hover */
export function usePrefetchModelDetail() {
  const queryClient = useQueryClient();

  return useCallback((slug: string, modelId: string) => {
    queryClient.prefetchQuery({
      queryKey: ["vibes-history", modelId, "daily", "30d"],
      staleTime: 60_000,
      queryFn: async () => {
        const sinceISO = getPacificDayWindowSince(29);
        const { data } = await supabase
          .from("vibes_scores")
          .select("*")
          .eq("model_id", modelId)
          .eq("period", "daily")
          .gte("period_start", sinceISO)
          .order("period_start", { ascending: true })
          .limit(90);
        return data || [];
      },
    });

    queryClient.prefetchQuery({
      queryKey: ["complaint-breakdown", modelId],
      staleTime: 60_000,
      queryFn: async () => {
        const { data } = await supabase.rpc("get_complaint_breakdown", { p_model_id: modelId });
        return aggregateComplaintBreakdown(data || []);
      },
    });

    queryClient.prefetchQuery({
      queryKey: ["source-breakdown", modelId],
      staleTime: 60_000,
      queryFn: async () => {
        const { data } = await supabase.rpc("get_source_breakdown", { p_model_id: modelId });
        const total = (data || []).reduce((sum: number, row) => sum + Number(row.count), 0);
        return (data || []).map((row) => ({
          source: row.source,
          count: Number(row.count),
          pct: total > 0 ? Math.round((Number(row.count) / total) * 100) : 0,
        }));
      },
    });

    queryClient.prefetchQuery({
      queryKey: ["model-posts", modelId, 25],
      staleTime: 60_000,
      queryFn: async () => {
        const sinceISO = new Date(Date.now() - RECENT_POSTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("scraped_posts")
          .select("*")
          .eq("model_id", modelId)
          .gte("posted_at", sinceISO)
          .order("posted_at", { ascending: false })
          .limit(25);
        return (data || []) as ScrapedPostRow[];
      },
    });
  }, [queryClient]);
}
