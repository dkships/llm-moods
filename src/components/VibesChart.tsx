import {
  ComposedChart,
  Area,
  Line,
  ResponsiveContainer,
  YAxis,
  XAxis,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { memo, useCallback, useId, useMemo, useState } from "react";
import { LIMITED_SAMPLE_THRESHOLD } from "@/lib/vibes";
import { computeYDomain, computeYTicks, type YDomain } from "@/lib/chart-scale";

// Theme colors — mapped from CSS variables (Recharts needs raw strings)
const CHART_COLORS = {
  mutedForeground: "hsl(var(--muted-foreground))",
  foreground: "hsl(var(--foreground))",
  card: "hsl(var(--card))",
  border: "hsl(var(--border))",
  referenceLine: "hsl(var(--border))",
} as const;

const MONO_FONT = "JetBrains Mono, monospace";

// Gradient under the line: a hint of the accent that fades to nothing, so the
// line reads as a surface rather than a wire. Opacity stays low on purpose —
// the accent hue is reserved for the stroke, this is its shadow.
const AREA_TOP_OPACITY = 0.22;
const AREA_BOTTOM_OPACITY = 0;

// Event labels sit at the top of the plot. Markers in the right third of the
// window flip their label to the left of the line so it never runs off the
// edge.
const LABEL_FLIP_FRACTION = 2 / 3;
const EVENT_LABEL_OFFSET = 6;
const EVENT_LABEL_FONT_SIZE = 10;

// In-chart event labels need room. Below this container width they are
// dropped entirely (the "Known events" legend under the chart still names
// every marker), and above it a label closer than MIN_EVENT_LABEL_GAP_PX to
// the previous kept label is dropped instead of drawn on top of it.
const MIN_LABELED_CHART_WIDTH = 500;
const MIN_EVENT_LABEL_GAP_PX = 90;

// The dashed 50 line is where positive and negative chatter balance out.
const MIDLINE_SCORE = 50;
const MIDLINE_LABEL = "balanced";

export type ChartEventKind = "launch" | "regression" | "incident" | "note";

export interface ChartEventMarker {
  /** X-axis label where the event starts (must match a `day` value in chartData). */
  startLabel: string;
  /** X-axis label where the event ends. If equal to startLabel, renders as a single line. */
  endLabel?: string;
  color: string;
  title: string;
  /** Drives the glyph in legends/tooltips. Defaults to "note". */
  kind?: ChartEventKind;
  /** Short text drawn on the chart next to the marker (e.g. "Fable 5.1"). Omit to draw no label. */
  shortLabel?: string;
}

export interface VibesChartDatum {
  day: string;
  score: number | null;
  isCarryForward?: boolean;
  /** The current Pacific day: posts are still arriving, so the point is
   * provisional and renders as a dashed tail with a hollow dot. */
  isProvisional?: boolean;
  eligiblePosts?: number | null;
  scoreBasisStatus?: string | null;
  queuedPosts?: number | null;
  failedPosts?: number | null;
  classificationCoverage?: number | null;
}

interface PlotDatum extends VibesChartDatum {
  /** Solid-line series: null on the provisional point so the tail is dashed. */
  settledScore: number | null;
  /** Dashed-tail series: the last settled point plus the provisional one. */
  provisionalScore: number | null;
}

interface VibesChartProps {
  chartData: VibesChartDatum[];
  accent: string;
  timeRange: string;
  events?: ChartEventMarker[];
  /** Shared y-domain so side-by-side charts use one scale (Compare). Defaults
   * to a domain fitted to this chart's own data. */
  yDomain?: YDomain;
}

// Split the series so the still-filling day draws as a dashed tail. Only the
// last point can be provisional; everything before it is settled history.
function toPlotData(chartData: VibesChartDatum[]): PlotDatum[] {
  const lastIndex = chartData.length - 1;
  const tailIsProvisional = lastIndex >= 0 && Boolean(chartData[lastIndex].isProvisional);
  return chartData.map((d, i) => {
    const isTail = tailIsProvisional && i === lastIndex;
    const isTailAnchor = tailIsProvisional && i === lastIndex - 1;
    return {
      ...d,
      settledScore: isTail ? null : d.score,
      provisionalScore: isTail || isTailAnchor ? d.score : null,
    };
  });
}

function isLimitedSample(datum: VibesChartDatum): boolean {
  return (
    !datum.isCarryForward
    && datum.eligiblePosts != null
    && datum.eligiblePosts > 0
    && datum.eligiblePosts < LIMITED_SAMPLE_THRESHOLD
  );
}

function eventsOnDay(events: ChartEventMarker[], dayIndex: Record<string, number>, day: string): ChartEventMarker[] {
  const i = dayIndex[day];
  if (i == null) return [];
  return events.filter((event) => {
    const start = dayIndex[event.startLabel];
    const end = event.endLabel ? dayIndex[event.endLabel] : start;
    if (start == null || end == null) return false;
    return i >= start && i <= end;
  });
}

interface VibesTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: PlotDatum }>;
  label?: string;
  accent: string;
  events: ChartEventMarker[];
  dayIndex: Record<string, number>;
}

const noteStyle = { color: CHART_COLORS.mutedForeground, fontSize: 11, margin: "5px 0 0" } as const;

const VibesTooltip = ({ active, payload, label, accent, events, dayIndex }: VibesTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  if (datum.score == null) return null;
  // Asymmetric warnings only — silence implies the data is fine. Mirrors the
  // carry-forward convention: a special note appears on the rare days that
  // need a caveat, normal days show only the score.
  const limited = isLimitedSample(datum);
  const queuedCount = datum.queuedPosts ?? 0;
  const failedCount = datum.failedPosts ?? 0;
  const isPartialCoverage = datum.scoreBasisStatus === "partial_coverage" || queuedCount > 0;
  const showAbandoned = failedCount > 0;
  const dayEvents = label ? eventsOnDay(events, dayIndex, label) : [];
  return (
    <div
      style={{
        background: CHART_COLORS.card,
        border: `1px solid ${CHART_COLORS.border}`,
        borderRadius: 8,
        boxShadow: "var(--shadow-elevated)",
        padding: "9px 12px",
        fontSize: 12,
        fontFamily: MONO_FONT,
        maxWidth: 260,
      }}
    >
      <p style={{ color: CHART_COLORS.mutedForeground, margin: 0 }}>{label}</p>
      <p style={{ color: accent, margin: "2px 0 0", fontVariantNumeric: "tabular-nums" }}>
        score: {datum.score}
      </p>
      {datum.isProvisional && (
        <p style={noteStyle}>
          Still filling — {datum.eligiblePosts ?? 0} posts scored so far
        </p>
      )}
      {datum.isCarryForward && (
        <p style={noteStyle}>No new posts — previous score carried forward</p>
      )}
      {limited && !datum.isProvisional && (
        <p style={noteStyle}>Limited sample — {datum.eligiblePosts} high-confidence posts</p>
      )}
      {isPartialCoverage && (
        <p style={noteStyle}>
          Partial data{queuedCount > 0 ? ` — ${queuedCount} posts still processing` : ""}
        </p>
      )}
      {showAbandoned && (
        <p style={noteStyle}>{failedCount} posts couldn't be classified</p>
      )}
      {dayEvents.length > 0 && (
        <ul style={{ listStyle: "none", margin: "7px 0 0", padding: "7px 0 0", borderTop: `1px solid ${CHART_COLORS.border}` }}>
          {dayEvents.map((event, i) => (
            <li key={`tip-evt-${i}`} style={{ display: "flex", gap: 6, alignItems: "baseline", color: CHART_COLORS.foreground, fontSize: 11, margin: i === 0 ? 0 : "3px 0 0" }}>
              <span aria-hidden="true" style={{ color: event.color }}>{eventGlyph(event.kind)}</span>
              <span>{event.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export function eventGlyph(kind: ChartEventKind | undefined): string {
  switch (kind) {
    case "launch":
      return "▲";
    case "incident":
      return "✕";
    case "regression":
      return "▬";
    default:
      return "●";
  }
}

interface DotProps {
  cx?: number;
  cy?: number;
  payload?: PlotDatum;
  index?: number;
}

// Recharts hands a synthetic `key` to its dot renderer as a real prop and
// also expects each returned element to carry its own key. We pluck it off
// and apply it directly to the SVG element to avoid React's key-in-spread
// and missing-key warnings.
//
// Dot vocabulary (all hollow rings so a caveat never reads as a data point):
//   provisional  r4, solid ring, 2px    — today, still filling
//   partial      r4, solid ring, 1.5px  — posts still queued for classification
//   carry-fwd    r4, dashed ring        — zero posts, yesterday's score copied
//   limited      r3, solid ring, 1.5px  — fewer than LIMITED_SAMPLE_THRESHOLD posts
//   normal       no dot
// The dashed tail shares its anchor point with the solid line, so the tail's
// renderer draws only the provisional point to avoid a doubled ring.
const renderStatusDot = (accent: string, series: "settled" | "tail") => (props: DotProps) => {
  const { cx, cy, payload, index } = props;
  const dotKey = `dot-${series}-${index ?? 0}`;
  if (cx == null || cy == null || payload?.score == null) {
    return <g key={dotKey} />;
  }
  if (series === "tail" && !payload.isProvisional) {
    return <g key={dotKey} />;
  }
  const ring = { cx, cy, fill: CHART_COLORS.card, stroke: accent } as const;
  if (payload.isProvisional) {
    return <circle key={dotKey} {...ring} r={4} strokeWidth={2} />;
  }
  if (payload.scoreBasisStatus === "partial_coverage" || (payload.queuedPosts ?? 0) > 0) {
    return <circle key={dotKey} {...ring} r={4} strokeWidth={1.5} />;
  }
  if (payload.isCarryForward) {
    return <circle key={dotKey} {...ring} r={4} strokeWidth={1.5} strokeDasharray="2 2" />;
  }
  if (isLimitedSample(payload)) {
    return <circle key={dotKey} {...ring} r={3} strokeWidth={1.5} />;
  }
  return <g key={dotKey} />;
};

function buildAriaLabel(chartData: VibesChartDatum[], timeRange: string): string {
  const scored = chartData.filter((d) => typeof d.score === "number");
  if (scored.length === 0) return "Sentiment score chart: no score data for this period.";
  const latest = scored[scored.length - 1];
  const first = scored[0];
  const delta = Math.round((latest.score as number) - (first.score as number));
  const trend = delta > 0 ? `up ${delta} points` : delta < 0 ? `down ${Math.abs(delta)} points` : "flat";
  const provisional = latest.isProvisional ? " The latest point is today's provisional score." : "";
  return `Sentiment score chart, ${timeRange} range: latest score ${latest.score} at ${latest.day}, ${trend} across the visible period.${provisional}`;
}

// Indexes of events whose label fits: none on a narrow chart, otherwise each
// label must sit at least MIN_EVENT_LABEL_GAP_PX right of the last kept one.
// X positions are approximated as evenly spaced days across the full width.
function labeledEventIndexes(
  events: ChartEventMarker[],
  dayIndex: Record<string, number>,
  dayCount: number,
  chartWidth: number,
): Set<number> {
  const labeled = new Set<number>();
  if (chartWidth < MIN_LABELED_CHART_WIDTH || dayCount === 0) {
    return labeled;
  }

  const pxPerDay = chartWidth / dayCount;
  const candidates = events
    .map((event, i) => ({ i, day: dayIndex[event.startLabel], hasLabel: Boolean(event.shortLabel) }))
    .filter((c) => c.hasLabel && c.day != null)
    .sort((a, b) => a.day - b.day);

  let lastDay: number | null = null;
  for (const { i, day } of candidates) {
    if (lastDay != null && (day - lastDay) * pxPerDay < MIN_EVENT_LABEL_GAP_PX) {
      continue;
    }
    labeled.add(i);
    lastDay = day;
  }
  return labeled;
}

function eventLabel(event: ChartEventMarker, flip: boolean) {
  if (!event.shortLabel) return undefined;
  return {
    value: event.shortLabel,
    position: flip ? "insideTopRight" : "insideTopLeft",
    offset: EVENT_LABEL_OFFSET,
    fill: event.color,
    fontSize: EVENT_LABEL_FONT_SIZE,
    fontFamily: MONO_FONT,
    opacity: 0.9,
  } as const;
}

const VibesChart = memo(({ chartData, accent, timeRange, events = [], yDomain }: VibesChartProps) => {
  const gradientId = useId();
  const [chartWidth, setChartWidth] = useState(0);
  const handleResize = useCallback((width: number) => setChartWidth(width), []);
  const [yMin, yMax] = yDomain ?? computeYDomain(chartData);
  const yTicks = computeYTicks([yMin, yMax]);
  const showMidlineRef = yMin <= MIDLINE_SCORE && yMax >= MIDLINE_SCORE;
  const plotData = useMemo(() => toPlotData(chartData), [chartData]);
  const dayIndex = useMemo(() => {
    const index: Record<string, number> = {};
    chartData.forEach((d, i) => {
      index[d.day] = i;
    });
    return index;
  }, [chartData]);
  const flipAfter = chartData.length * LABEL_FLIP_FRACTION;
  const labeledEvents = labeledEventIndexes(events, dayIndex, chartData.length, chartWidth);
  const tooltip = (props: unknown) => (
    <VibesTooltip {...(props as VibesTooltipProps)} accent={accent} events={events} dayIndex={dayIndex} />
  );

  return (
  // h-full w-full is load-bearing: consumers size the chart via wrapper divs,
  // and ResponsiveContainer's height:100% resolves to 0 in an unsized parent.
  <div role="img" aria-label={buildAriaLabel(chartData, timeRange)} className="h-full w-full">
  <ResponsiveContainer width="100%" height="100%" onResize={handleResize}>
    <ComposedChart data={plotData} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} accessibilityLayer>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity={AREA_TOP_OPACITY} />
          <stop offset="100%" stopColor={accent} stopOpacity={AREA_BOTTOM_OPACITY} />
        </linearGradient>
      </defs>
      <XAxis
        dataKey="day"
        tick={{ fill: CHART_COLORS.mutedForeground, fontFamily: MONO_FONT, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        tickMargin={8}
        // Width-aware thinning instead of a hardcoded nth-tick interval. The
        // old formula pinned 7d to interval={0} (every tick) and the others to
        // ~5 ticks regardless of width; at 320px that put "Jul 10"/"Jul 16"
        // labels 39px apart with a 40px glyph box, i.e. overlapping. minTickGap
        // lets Recharts drop labels only when they would actually collide, so
        // the chart stays dense on desktop and legible on a phone.
        interval="preserveStartEnd"
        minTickGap={56}
        padding={{ left: 10, right: 10 }}
      />
      <YAxis
        domain={[yMin, yMax]}
        ticks={yTicks}
        tick={{ fill: CHART_COLORS.mutedForeground, fontFamily: MONO_FONT, fontSize: 11 }}
        axisLine={false}
        tickLine={false}
        tickMargin={4}
        width={32}
      />
      <RechartsTooltip
        cursor={{ stroke: CHART_COLORS.border, strokeDasharray: "3 3" }}
        content={tooltip}
      />
      {showMidlineRef && (
        <ReferenceLine
          y={MIDLINE_SCORE}
          stroke={CHART_COLORS.referenceLine}
          strokeDasharray="4 4"
          label={{
            value: MIDLINE_LABEL,
            position: "insideBottomLeft",
            fill: CHART_COLORS.mutedForeground,
            fontSize: EVENT_LABEL_FONT_SIZE,
            fontFamily: MONO_FONT,
            opacity: 0.7,
          }}
        />
      )}
      {events.map((event, i) => {
        const isRange = event.endLabel && event.endLabel !== event.startLabel;
        const flip = (dayIndex[event.startLabel] ?? 0) >= flipAfter;
        if (isRange) {
          return (
            <ReferenceArea
              key={`evt-${i}`}
              x1={event.startLabel}
              x2={event.endLabel}
              y1={yMin}
              y2={yMax}
              fill={event.color}
              fillOpacity={0.08}
              stroke={event.color}
              strokeOpacity={0.35}
              ifOverflow="visible"
              label={labeledEvents.has(i) ? eventLabel(event, flip) : undefined}
            />
          );
        }
        return (
          <ReferenceLine
            key={`evt-${i}`}
            x={event.startLabel}
            stroke={event.color}
            strokeDasharray="3 3"
            strokeOpacity={0.7}
            ifOverflow="visible"
            label={labeledEvents.has(i) ? eventLabel(event, flip) : undefined}
          />
        );
      })}
      <Area
        type="monotone"
        dataKey="score"
        stroke="none"
        fill={`url(#${gradientId})`}
        connectNulls={false}
        dot={false}
        activeDot={false}
        isAnimationActive={false}
        tooltipType="none"
      />
      <Line
        type="monotone"
        dataKey="settledScore"
        stroke={accent}
        strokeWidth={2.5}
        dot={renderStatusDot(accent, "settled")}
        activeDot={{ r: 4, fill: accent, strokeWidth: 0 }}
        connectNulls={false}
        // Recharts animates via rAF, not CSS, so the global
        // prefers-reduced-motion rule in index.css can't reach it. It also
        // replayed the full ~1.5s draw-in on every 24h/7d/30d switch, which
        // read as the chart reloading rather than updating.
        isAnimationActive={false}
      />
      <Line
        type="monotone"
        dataKey="provisionalScore"
        stroke={accent}
        strokeWidth={2}
        strokeDasharray="4 3"
        strokeOpacity={0.8}
        dot={renderStatusDot(accent, "tail")}
        activeDot={{ r: 4, fill: accent, strokeWidth: 0 }}
        connectNulls={false}
        isAnimationActive={false}
      />
    </ComposedChart>
  </ResponsiveContainer>
  </div>
  );
});
VibesChart.displayName = "VibesChart";

export default VibesChart;
