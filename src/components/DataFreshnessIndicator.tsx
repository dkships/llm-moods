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

  const lastUpdatedDate = new Date(lastUpdated);
  const absoluteTimestamp = Number.isNaN(lastUpdatedDate.getTime())
    ? lastUpdated
    : new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(lastUpdatedDate);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs sm:text-[11px] font-mono text-foreground/65"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      title={`Last updated ${absoluteTimestamp}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
      Updated {formatTimeAgo(lastUpdated)}
    </span>
  );
});
DataFreshnessIndicator.displayName = "DataFreshnessIndicator";

export default DataFreshnessIndicator;
