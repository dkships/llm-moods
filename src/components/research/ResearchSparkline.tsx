/**
 * Static score line for the featured post on /research. Draws the post's
 * frozen series (src/data/research-sparklines.ts) with its key events
 * labelled, so the page opens on the shape the article is about. No Recharts and no data fetch: the
 * index stays light and renders the same way for crawlers and readers.
 *
 * The line and area are an SVG stretched to the box; text is positioned in
 * HTML on top, so labels keep their size at any width.
 */

import { useId } from "react";
import type { ResearchSparkline as SparklineData } from "@/data/research-sparklines";
import { VENDOR_EVENTS } from "@/data/vendor-events";

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;
// Headroom above/below the data so the stroke never kisses the edge.
const Y_PAD_SCORE = 4;
const MIDLINE_SCORE = 50;
const MS_PER_DAY = 86_400_000;
// Hero labels closer than this (as a share of width) drop to a second row.
const LABEL_CROWD_FRACTION = 0.14;
// Past this share of the width a label hangs left of its marker.
const LABEL_FLIP_FRACTION = 0.7;

const ACCENT = "hsl(var(--primary))";
const MUTED_STROKE = "hsl(var(--muted-foreground) / 0.3)";
const MARKER_STROKE = "hsl(var(--muted-foreground) / 0.5)";
const MIDLINE_STROKE = "hsl(var(--border))";

interface PlacedMarker {
  label: string;
  x: number;
  row: number;
}

function dayOffset(startDate: string, date: string): number {
  return Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / MS_PER_DAY);
}

function formatDay(startDate: string, offset: number): string {
  const date = new Date(Date.parse(`${startDate}T12:00:00Z`) + offset * MS_PER_DAY);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function yDomain(data: SparklineData): [number, number] {
  const scores = data.series.flatMap((s) => s.scores).filter((v): v is number => v != null);
  const min = Math.max(0, Math.min(...scores) - Y_PAD_SCORE);
  const max = Math.min(100, Math.max(...scores) + Y_PAD_SCORE);
  return [min, max];
}

// A preview, not the article's chart: days with no score are bridged so a
// sparse series still reads as one line. The articles show the gaps.
function scoredPoints(scores: (number | null)[]): [number, number][] {
  return scores.flatMap((score, i) => (score == null ? [] : [[i, score] as [number, number]]));
}

function linePath(scores: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  return scoredPoints(scores)
    .map(([i, score], n) => `${n === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(score).toFixed(1)}`)
    .join("");
}

// Area under the line, closed to the bottom edge.
function areaPath(scores: (number | null)[], x: (i: number) => number, y: (v: number) => number, floor: number): string {
  const points = scoredPoints(scores);
  if (points.length < 2) {
    return "";
  }
  const first = points[0][0];
  const last = points[points.length - 1][0];
  return `${linePath(scores, x, y)}L${x(last).toFixed(1)},${floor}L${x(first).toFixed(1)},${floor}Z`;
}

function placeMarkers(data: SparklineData, dayCount: number): PlacedMarker[] {
  const placed: PlacedMarker[] = [];
  for (const marker of data.markers) {
    const event = VENDOR_EVENTS.find((e) => e.id === marker.eventId);
    if (!event) {
      continue;
    }
    const day = dayOffset(data.startDate, event.eventDate);
    if (day < 0 || day >= dayCount) {
      continue;
    }
    const x = day / (dayCount - 1);
    const crowded = placed.some((p) => p.row === 0 && Math.abs(p.x - x) < LABEL_CROWD_FRACTION);
    placed.push({ label: marker.label, x, row: crowded ? 1 : 0 });
  }
  return placed;
}

interface ResearchSparklineProps {
  data: SparklineData;
  className?: string;
}

const ResearchSparkline = ({ data, className = "" }: ResearchSparklineProps) => {
  const gradientId = useId();
  const height = VIEW_HEIGHT;
  const dayCount = Math.max(...data.series.map((s) => s.scores.length));
  const [yMin, yMax] = yDomain(data);
  const x = (i: number) => (i / (dayCount - 1)) * VIEW_WIDTH;
  const y = (v: number) => height - ((v - yMin) / (yMax - yMin)) * height;
  const markers = placeMarkers(data, dayCount);

  // Muted comparison lines first so the primary line draws on top.
  const ordered = [
    ...data.series.filter((s) => s.emphasis === "muted"),
    ...data.series.filter((s) => s.emphasis === "primary"),
  ];
  const primary = data.series.find((s) => s.emphasis === "primary");
  const lastIndex = primary ? primary.scores.length - 1 : -1;
  const lastScore = primary ? primary.scores[lastIndex] : null;
  const showMidline = yMin < MIDLINE_SCORE && yMax > MIDLINE_SCORE;

  return (
    <figure className={className}>
      {/* The hero reserves a right gutter for the last-value label. */}
      <div className="relative mr-8 h-56 sm:h-64">
        <svg
          viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          role="img"
          aria-label={data.caption}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
              <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
            </linearGradient>
          </defs>
          {showMidline && (
            <line
              x1={0}
              x2={VIEW_WIDTH}
              y1={y(MIDLINE_SCORE)}
              y2={y(MIDLINE_SCORE)}
              stroke={MIDLINE_STROKE}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {markers.map((m) => (
            <line
              key={m.label}
              x1={m.x * VIEW_WIDTH}
              x2={m.x * VIEW_WIDTH}
              y1={0}
              y2={height}
              stroke={MARKER_STROKE}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {/* One line gets a soft fill; with comparison lines it would muddy them. */}
          {primary && data.series.length === 1 && (
            <path d={areaPath(primary.scores, x, y, height)} fill={`url(#${gradientId})`} stroke="none" />
          )}
          {ordered.map((s) => (
            <path
              key={s.label}
              d={linePath(s.scores, x, y)}
              fill="none"
              stroke={s.emphasis === "primary" ? ACCENT : MUTED_STROKE}
              strokeWidth={s.emphasis === "primary" ? 2.5 : 1.25}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {markers.map((m) => (
          <span
            key={`label-${m.label}`}
            aria-hidden="true"
            className="absolute whitespace-nowrap px-1.5 text-meta text-text-secondary"
            style={{
              left: `${m.x * 100}%`,
              top: m.row === 0 ? 0 : "1.25rem",
              transform: m.x > LABEL_FLIP_FRACTION ? "translateX(-100%)" : undefined,
            }}
          >
            {m.label}
          </span>
        ))}

        {lastScore != null && (
          <span
            aria-hidden="true"
            className="absolute flex -translate-y-1/2 items-center gap-2"
            style={{ left: `${(lastIndex / (dayCount - 1)) * 100}%`, top: `${(y(lastScore) / height) * 100}%` }}
          >
            <span className="h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 border-card" style={{ background: ACCENT }} />
            <span className="-ml-1 text-meta text-foreground">{lastScore}</span>
          </span>
        )}
      </div>

      <figcaption className="mr-8 mt-3 flex items-baseline justify-between gap-4 text-meta text-text-tertiary">
        <span>{formatDay(data.startDate, 0)}</span>
        <span className="text-center">{data.subject}</span>
        <span>{formatDay(data.startDate, dayCount - 1)}</span>
      </figcaption>
    </figure>
  );
};

export default ResearchSparkline;
