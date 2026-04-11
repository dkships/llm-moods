import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Flame, TrendingUp, TrendingDown } from "lucide-react";
import { motion } from "framer-motion";
import { formatComplaintLabel } from "@/lib/vibes";

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
    staleTime: 60_000,
    refetchInterval: 120_000,
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
      <div className="glass rounded-xl p-5 animate-pulse">
        <div className="h-5 w-48 bg-secondary/60 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-10 bg-secondary/40 rounded" />)}
        </div>
      </div>
    );
  }

  const topMovers = pickTopPerModel(data || []);

  if (topMovers.length === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.4 }}
      className="glass rounded-xl overflow-hidden"
    >
      <div className="px-5 pt-5 pb-4 flex items-center gap-2">
        <Flame className="h-4 w-4 text-destructive" />
        <h3 className="text-sm font-semibold text-foreground">Trending Complaints</h3>
        <span className="text-[10px] font-mono text-foreground/60 ml-auto">vs last week</span>
      </div>

      <div className="max-h-[280px] overflow-y-auto scrollbar-thin px-5 pb-5 space-y-2">
        {topMovers.map((item) => {
          const isSpike = item.pct_change > 50;
          const isUp = item.pct_change > 0;
          const label = formatComplaintLabel(item.category);

          return (
            <div
              key={`${item.model_id}-${item.category}`}
              className="flex items-center gap-3 py-2 px-3 rounded-lg bg-secondary/30 border border-border/50"
            >
              {/* Model indicator */}
              <div className="flex items-center gap-2 shrink-0 w-24">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ background: item.accent_color || "#888" }} />
                <span className="text-xs font-mono text-foreground truncate">{item.model_name}</span>
              </div>

              {/* Category */}
              <span className="text-xs text-foreground/70 flex-1 truncate">{label}</span>

              {/* Change indicator */}
              <div className="flex items-center gap-1.5 shrink-0">
                {isSpike && <span className="text-xs">🔥</span>}
                {isUp ? (
                  <TrendingUp className="h-3 w-3 text-destructive" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-primary" />
                )}
                <span className={`text-xs font-mono font-medium ${
                  isSpike ? "text-destructive" : isUp ? "text-destructive" : "text-primary"
                }`}>
                  {isUp ? "↑" : "↓"} {Math.abs(item.pct_change)}%
                </span>
              </div>

              {/* Volume */}
              <span className="text-[10px] font-mono text-foreground/60 shrink-0 w-16 text-right">
                {item.this_week} posts
              </span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default TrendingComplaints;
