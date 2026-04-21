import { useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";
import type { Database } from "@/integrations/supabase/types";
import { normalizePublicComplaintCategory } from "@/shared/public-taxonomy";

type LandingVibesRow = Database["public"]["Functions"]["get_landing_vibes"]["Returns"][number];
type SparklineRow = Database["public"]["Functions"]["get_sparkline_scores"]["Returns"][number];
type ScrapedPostRow = Database["public"]["Tables"]["scraped_posts"]["Row"];
type ModelRow = Database["public"]["Tables"]["models"]["Row"];

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
  trend: { direction: "up" | "down"; pts: number };
  sparkline: number[];
  topComplaint: string | null;
  totalPosts: number;
  lastUpdated: string | null;
}

export function useModelsWithLatestVibes() {
  return useQuery<ModelWithVibes[]>({
    queryKey: ["models-with-vibes"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: landing, error: lErr } = await supabase.rpc("get_landing_vibes");
      if (lErr) throw lErr;

      const { data: sparklines, error: sErr } = await supabase.rpc("get_sparkline_scores");
      if (sErr) throw sErr;

      const sparkMap = new Map<string, number[]>();
      (sparklines || []).forEach((s: SparklineRow) => {
        const arr = sparkMap.get(s.model_id) || [];
        arr.push(s.score);
        sparkMap.set(s.model_id, arr);
      });

      return (landing || []).map((m: LandingVibesRow): ModelWithVibes => {
        const sparkline = sparkMap.get(m.model_id) || [];
        const trendPts = m.previous_score != null ? m.latest_score - m.previous_score : 0;
        const topComplaint = normalizePublicComplaintCategory(m.top_complaint);

        return {
          id: m.model_id,
          name: m.model_name,
          slug: m.model_slug,
          accent_color: m.accent_color,
          latestScore: m.latest_score ?? 50,
          vibe: m.latest_score ?? 50,
          trend: { direction: trendPts >= 0 ? "up" : "down", pts: Math.abs(trendPts) },
          sparkline,
          topComplaint,
          totalPosts: m.total_posts ?? 0,
          lastUpdated: m.last_updated ?? null,
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
      let since: Date;
      if (period === "daily") {
        const days = range === "7d" ? 6 : 29;
        since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
      } else if (range === "24h") {
        since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      } else if (range === "7d") {
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      const { data, error } = await supabase
        .from("vibes_scores")
        .select("*")
        .eq("model_id", modelId!)
        .eq("period", period)
        .gte("period_start", since.toISOString())
        .order("period_start", { ascending: true })
        .limit(90);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComplaintBreakdown(modelId: string | undefined) {
  return useQuery<ComplaintBreakdownItem[]>({
    queryKey: ["complaint-breakdown", modelId],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_complaint_breakdown", { p_model_id: modelId! });
      if (error) throw error;

      const normalizedRows = (data || [])
        .map((row) => ({
          category: normalizePublicComplaintCategory(row.category),
          count: Number(row.count),
        }))
        .filter((row): row is { category: NonNullable<typeof row.category>; count: number } => row.category !== null);

      const total = normalizedRows.reduce((sum, row) => sum + row.count, 0);

      return normalizedRows.map((row) => ({
        category: row.category,
        count: row.count,
        pct: total > 0 ? Math.round((row.count / total) * 100) : 0,
      }));
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

export function useModelPosts(modelId: string | undefined, limit = 25, enabled = true) {
  return useQuery<ScrapedPostRow[]>({
    queryKey: ["model-posts", modelId, limit],
    enabled: !!modelId && enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("*")
        .eq("model_id", modelId!)
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
        const now = new Date();
        const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29)).toISOString();
        const { data } = await supabase
          .from("vibes_scores")
          .select("*")
          .eq("model_id", modelId)
          .eq("period", "daily")
          .gte("period_start", since)
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
        const normalizedRows = (data || [])
          .map((row) => ({
            category: normalizePublicComplaintCategory(row.category),
            count: Number(row.count),
          }))
          .filter((row): row is { category: NonNullable<typeof row.category>; count: number } => row.category !== null);

        const total = normalizedRows.reduce((sum, row) => sum + row.count, 0);

        return normalizedRows.map((row) => ({
          category: row.category,
          count: row.count,
          pct: total > 0 ? Math.round((row.count / total) * 100) : 0,
        }));
      },
    });
  }, [queryClient]);
}
