import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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

const GRID_COLS = "grid grid-cols-[1.4fr_88px_1fr_56px] items-center gap-4";

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

function pickTopPerModel(items: TrendingItem[]): TrendingItem[] {
  const seen = new Map<string, TrendingItem>();
  for (const item of items) {
    if (!seen.has(item.model_id)) {
      seen.set(item.model_id, item);
    }
  }
  return Array.from(seen.values());
}

function changeToneClass(pct: number): string {
  if (pct > 30) return "text-destructive";
  if (pct > 0) return "text-warning";
  if (pct < 0) return "text-primary";
  return "text-text-secondary";
}

const TrendingComplaints = () => {
  const { data, isLoading } = useTrendingComplaints();

  if (isLoading) {
    return (
      <Surface size="tight" className="animate-pulse">
        <div className="mb-4 h-5 w-48 rounded bg-secondary/50" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-8 rounded bg-secondary/40" />)}
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

  const maxVolume = topMovers.reduce((m, row) => Math.max(m, row.this_week), 0);

  return (
    <Surface size="tight" motion="fade">
      <SectionHeader
        title="Trending complaints"
        action={<span className={`text-mono-cap text-text-tertiary`}>vs prior week</span>}
      />

      <div className="mt-2">
        <div className={`${GRID_COLS} border-b border-border pb-2 text-mono-cap text-text-tertiary`}>
          <span>Topic</span>
          <span className="text-right">Mentions</span>
          <span>Volume</span>
          <span className="text-right">Change</span>
        </div>

        <ul className="divide-y divide-border/60">
          {topMovers.map((item) => {
            const label = formatComplaintLabel(item.category);
            const pct = item.pct_change;
            const sign = pct > 0 ? "+" : pct < 0 ? "" : "";
            const widthPct = maxVolume > 0 ? Math.max(4, (item.this_week / maxVolume) * 100) : 0;

            return (
              <li
                key={`${item.model_id}-${item.category}`}
                className={`${GRID_COLS} py-2.5`}
              >
                <div className="min-w-0">
                  <p className="truncate text-body font-medium text-foreground">{label}</p>
                  <p className="text-mono-cap text-text-tertiary">{item.model_name}</p>
                </div>

                <span className={`text-right text-mono-cap text-text-secondary`}>
                  {item.this_week.toLocaleString()}
                </span>

                <div
                  className="h-1 w-full overflow-hidden rounded-full bg-border/60"
                  aria-hidden="true"
                >
                  <div
                    className="h-full rounded-full bg-foreground/30"
                    style={{ width: `${widthPct}%` }}
                  />
                </div>

                <span
                  className={`text-right text-meta font-semibold ${changeToneClass(pct)}`}
                  aria-label={`${pct >= 0 ? "up" : "down"} ${Math.abs(pct)} percent`}
                >
                  {sign}{pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Surface>
  );
};

export default TrendingComplaints;
