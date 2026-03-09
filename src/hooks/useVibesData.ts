import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";

export function useModelsWithLatestVibes() {
  return useQuery({
    queryKey: ["models-with-vibes"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      // Single RPC call for landing/dashboard data
      const { data: landing, error: lErr } = await supabase.rpc("get_landing_vibes");
      if (lErr) throw lErr;

      // Single RPC call for sparklines (7 scores per model)
      const { data: sparklines, error: sErr } = await supabase.rpc("get_sparkline_scores");
      if (sErr) throw sErr;

      const sparkMap = new Map<string, number[]>();
      (sparklines || []).forEach((s: { model_id: string; score: number }) => {
        const arr = sparkMap.get(s.model_id) || [];
        arr.push(s.score);
        sparkMap.set(s.model_id, arr);
      });

      return (landing || []).map((m: any) => {
        const sparkline = sparkMap.get(m.model_id) || [];
        const trendPts = m.previous_score != null ? m.latest_score - m.previous_score : 0;

        return {
          id: m.model_id,
          name: m.model_name,
          slug: m.model_slug,
          accent_color: m.accent_color,
          latestScore: m.latest_score ?? 50,
          vibe: m.latest_score ?? 50,
          trend: { direction: trendPts >= 0 ? ("up" as const) : ("down" as const), pts: Math.abs(trendPts) },
          sparkline,
          topComplaint: m.top_complaint ?? null,
          totalPosts: m.total_posts ?? 0,
          lastUpdated: m.last_updated ?? null,
        };
      });
    },
  });
}

export function useRecentChatter(limit = 12, enabled = true) {
  return useQuery({
    queryKey: ["recent-chatter", limit],
    staleTime: 60_000,
    enabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("*, models(name, accent_color, slug)")
        .order("posted_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return data || [];
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
      if (range === "24h") {
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
        .limit(200);
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComplaintBreakdown(modelId: string | undefined) {
  return useQuery({
    queryKey: ["complaint-breakdown", modelId],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_complaint_breakdown", { p_model_id: modelId! });
      if (error) throw error;

      const total = (data || []).reduce((sum: number, r: any) => sum + Number(r.count), 0);
      return (data || []).map((r: any) => ({
        category: r.category,
        count: Number(r.count),
        pct: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
      }));
    },
  });
}

export function useSourceBreakdown(modelId: string | undefined) {
  return useQuery({
    queryKey: ["source-breakdown", modelId],
    enabled: !!modelId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_source_breakdown", { p_model_id: modelId! });
      if (error) throw error;

      const total = (data || []).reduce((sum: number, r: any) => sum + Number(r.count), 0);
      return (data || []).map((r: any) => ({
        source: r.source,
        count: Number(r.count),
        pct: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
      }));
    },
  });
}

export function useModelPosts(modelId: string | undefined, limit = 10, enabled = true) {
  return useQuery({
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
      return data || [];
    },
  });
}

/** Prefetch model detail data on hover */
export function usePrefetchModelDetail() {
  const queryClient = useQueryClient();

  return useCallback((slug: string, modelId: string) => {
    // Prefetch vibes history
    queryClient.prefetchQuery({
      queryKey: ["vibes-history", modelId, "daily", "30d"],
      staleTime: 60_000,
      queryFn: async () => {
        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const { data } = await supabase
          .from("vibes_scores")
          .select("*")
          .eq("model_id", modelId)
          .eq("period", "daily")
          .gte("period_start", since)
          .order("period_start", { ascending: true })
          .limit(200);
        return data || [];
      },
    });

    // Prefetch complaint breakdown
    queryClient.prefetchQuery({
      queryKey: ["complaint-breakdown", modelId],
      staleTime: 60_000,
      queryFn: async () => {
        const { data } = await supabase.rpc("get_complaint_breakdown", { p_model_id: modelId });
        const total = (data || []).reduce((sum: number, r: any) => sum + Number(r.count), 0);
        return (data || []).map((r: any) => ({
          category: r.category,
          count: Number(r.count),
          pct: total > 0 ? Math.round((Number(r.count) / total) * 100) : 0,
        }));
      },
    });
  }, [queryClient]);
}
