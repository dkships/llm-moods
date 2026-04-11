import { memo, useState, useEffect } from "react";
import { formatTimeAgo } from "@/lib/vibes";

interface DataFreshnessIndicatorProps {
  lastUpdated: string | null;
}

const DataFreshnessIndicator = memo(({ lastUpdated }: DataFreshnessIndicatorProps) => {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!lastUpdated) return;
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, [lastUpdated]);

  if (!lastUpdated) return null;

  const diffMs = Date.now() - new Date(lastUpdated).getTime();
  const diffHours = diffMs / (1000 * 60 * 60);

  let colorClass = "text-foreground/70";
  let dotClass = "bg-primary/50";
  let text = `Scores updated ${formatTimeAgo(lastUpdated)}`;
  if (diffHours > 24) {
    colorClass = "text-red-200";
    dotClass = "bg-red-300";
    text = `Scores are stale: last updated ${formatTimeAgo(lastUpdated)}`;
  } else if (diffHours > 6) {
    colorClass = "text-yellow-400";
    dotClass = "bg-yellow-400";
    text = `Scores lagging: last updated ${formatTimeAgo(lastUpdated)}`;
  } else if (diffHours > 1) {
    colorClass = "text-yellow-300";
    dotClass = "bg-yellow-300";
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs sm:text-[11px] font-mono ${colorClass}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass} ${diffHours <= 1 ? "animate-pulse" : ""}`} />
      {text}
    </span>
  );
});
DataFreshnessIndicator.displayName = "DataFreshnessIndicator";

export default DataFreshnessIndicator;
