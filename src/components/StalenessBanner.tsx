import { formatTimeAgo } from "@/lib/vibes";

interface Props {
  mostRecentScoreAt: string | null;
  /** Hours after which the banner appears. Default 3h matches the watchdog
   *  aggregate-stale threshold (90 min) plus a buffer for the public surface. */
  staleAfterHours?: number;
}

const STALENESS_HOURS = 3;

export default function StalenessBanner({ mostRecentScoreAt, staleAfterHours = STALENESS_HOURS }: Props) {
  if (!mostRecentScoreAt) return null;
  const hoursSince = (Date.now() - new Date(mostRecentScoreAt).getTime()) / 3_600_000;
  if (hoursSince < staleAfterHours) return null;

  return (
    <div
      role="status"
      className="border-l-2 border-yellow-400/60 bg-yellow-400/5 px-4 py-3 font-mono text-xs text-yellow-200/90"
    >
      Scores last refreshed {formatTimeAgo(mostRecentScoreAt)}. Pipeline may be catching up — newer numbers will appear automatically.
    </div>
  );
}
