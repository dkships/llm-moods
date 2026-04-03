import { memo, useState, useEffect } from "react";
import { useDataFreshness } from "@/hooks/useVibesData";
import { formatTimeAgo } from "@/lib/vibes";

const DataFreshnessIndicator = memo(() => {
  const { data: lastScraped } = useDataFreshness();
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastScraped) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [lastScraped]);

  if (!lastScraped) return null;

  const diffMs = Date.now() - new Date(lastScraped).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let colorClass = "text-muted-foreground";
  let dotClass = "bg-primary/50";
  if (diffHours > 6) {
    colorClass = "text-destructive";
    dotClass = "bg-destructive";
  } else if (diffHours > 1) {
    colorClass = "text-yellow-500";
    dotClass = "bg-yellow-500";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs sm:text-[11px] font-mono ${colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass} ${diffHours <= 1 ? "animate-pulse" : ""}`} />
      Data updated {formatTimeAgo(lastScraped)}
    </span>
  );
});
DataFreshnessIndicator.displayName = "DataFreshnessIndicator";

export default DataFreshnessIndicator;
