import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flame, TrendingUp, TrendingDown } from "lucide-react";
import Surface from "@/components/Surface";
import SectionHeader from "@/components/SectionHeader";
import { formatComplaintLabel } from "@/lib/vibes";
import { normalizePublicComplaintCategory } from "@/shared/public-taxonomy";

interface TrendingItem {
  model_id: string;
  model_name: string;
  model_slug: string;
  accent_color: string;
  category: string;
  this_week: number;
  last_week: number;
  pct_change: number;
}

function useTrendingComplaints() {
  return useQuery({
    queryKey: ["trending-complaints"],
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_trending_complaints");
      if (error) throw error;
      return (data || []) as TrendingItem[];
    },
  });
}

// Pick the biggest mover per model
function pickTopPerModel(items: TrendingItem[]): TrendingItem[] {
  const seen = new Map<string, TrendingItem>();
  for (const item of items) {
    if (!seen.has(item.model_id)) {
      seen.set(item.model_id, item);
    }
  }
  return Array.from(seen.values());
}

const TrendingComplaints = () => {
  const { data, isLoading } = useTrendingComplaints();

  if (isLoading) {
    return (
      <Surface size="tight" className="animate-pulse">
        <div className="h-5 w-48 bg-secondary/50 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-secondary/40 rounded" />)}
        </div>
      </Surface>
    );
  }

  const topMovers = pickTopPerModel(
    (data || []).filter((item) => normalizePublicComplaintCategory(item.category) !== null),
  );

  if (topMovers.length === 0) {
    return null;
  }

  return (
    <Surface size="tight" motion="fade">
      <SectionHeader
        title="Trending Complaints"
        icon={Flame}
        action={<span className="font-mono text-[10px] text-text-tertiary">vs last week</span>}
      />

      <div className="max-h-[280px] overflow-y-auto scrollbar-thin space-y-2">
        {topMovers.map((item) => {
          const isSpike = item.pct_change > 50;
          const isUp = item.pct_change > 0;
          const label = formatComplaintLabel(item.category);

          return (
            <div
              key={`${item.model_id}-${item.category}`}
              className="flex items-center gap-3 py-2 px-3 rounded-lg bg-secondary/30 border border-border/50"
            >
              <div className="flex items-center gap-2 shrink-0 w-24">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: item.accent_color || "#888" }} />
                <span className="text-xs font-mono text-foreground truncate">{item.model_name}</span>
              </div>

              <span className="text-xs text-text-secondary flex-1 truncate">{label}</span>

              <div className="flex items-center gap-1.5 shrink-0">
                {isSpike && <span className="text-xs">🔥</span>}
                {isUp ? (
                  <TrendingUp className="h-3 w-3 text-destructive" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-primary" />
                )}
                <span className={`text-xs font-mono font-medium ${
                  isUp ? "text-destructive" : "text-primary"
                }`}>
                  {isUp ? "↑" : "↓"} {Math.abs(item.pct_change)}%
                </span>
              </div>

              <span className="text-[10px] font-mono text-text-tertiary shrink-0 w-16 text-right">
                {item.this_week} posts
              </span>
            </div>
          );
        })}
      </div>
    </Surface>
  );
};

export default TrendingComplaints;
