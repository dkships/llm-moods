import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useModelsWithLatestVibes() {
  return useQuery({
    queryKey: ["models-with-vibes"],
    queryFn: async () => {
      const { data: models, error: mErr } = await supabase
        .from("models")
        .select("*")
        .order("name");
      if (mErr) throw mErr;

      const { data: scores, error: sErr } = await supabase
        .from("vibes_scores")
        .select("*")
        .eq("period", "daily")
        .order("period_start", { ascending: false });
      if (sErr) throw sErr;

      // Get today's report counts
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const { data: reports, error: rErr } = await supabase
        .from("user_reports")
        .select("model_id")
        .gte("created_at", todayStart.toISOString());
      if (rErr) throw rErr;

      const reportCounts: Record<string, number> = {};
      (reports || []).forEach((r) => {
        reportCounts[r.model_id] = (reportCounts[r.model_id] || 0) + 1;
      });

      return (models || []).map((model) => {
        const modelScores = (scores || []).filter((s) => s.model_id === model.id);
        const latest = modelScores[0];
        const yesterday = modelScores[1];
        const sparkline = modelScores.slice(0, 7).reverse();
        const trendPts = latest && yesterday ? latest.score - yesterday.score : 0;

        return {
          ...model,
          latestScore: latest?.score ?? 50,
          vibe: latest?.score ?? 50,
          trend: { direction: trendPts >= 0 ? ("up" as const) : ("down" as const), pts: Math.abs(trendPts) },
          sparkline: sparkline.map((s) => s.score),
          topComplaint: latest?.top_complaint ?? null,
          totalPosts: latest?.total_posts ?? 0,
          reportsToday: reportCounts[model.id] || 0,
        };
      });
    },
  });
}

export function useRecentChatter(limit = 8) {
  return useQuery({
    queryKey: ["recent-chatter", limit],
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
        .order("period_start", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
}

export function useComplaintBreakdown(modelId: string | undefined) {
  return useQuery({
    queryKey: ["complaint-breakdown", modelId],
    enabled: !!modelId,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("complaint_category")
        .eq("model_id", modelId!)
        .not("complaint_category", "is", null)
        .gte("posted_at", since);
      if (error) throw error;

      const counts: Record<string, number> = {};
      let total = 0;
      (data || []).forEach((p) => {
        if (p.complaint_category) {
          counts[p.complaint_category] = (counts[p.complaint_category] || 0) + 1;
          total++;
        }
      });

      return Object.entries(counts)
        .map(([cat, count]) => ({ category: cat, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
    },
  });
}

export function useSourceBreakdown(modelId: string | undefined) {
  return useQuery({
    queryKey: ["source-breakdown", modelId],
    enabled: !!modelId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("source")
        .eq("model_id", modelId!);
      if (error) throw error;

      const counts: Record<string, number> = {};
      let total = 0;
      (data || []).forEach((p) => {
        counts[p.source] = (counts[p.source] || 0) + 1;
        total++;
      });

      return Object.entries(counts)
        .map(([source, count]) => ({ source, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
    },
  });
}

export function useModelPosts(modelId: string | undefined, limit = 5) {
  return useQuery({
    queryKey: ["model-posts", modelId, limit],
    enabled: !!modelId,
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
