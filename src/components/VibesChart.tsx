import { LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceLine, ReferenceArea } from "recharts";
import { memo } from "react";
import { ConfidenceChip } from "@/components/ConfidenceChip";

// Theme colors — mapped from CSS variables (Recharts needs raw strings)
const CHART_COLORS = {
  mutedForeground: "hsl(220 10% 50%)",  // --muted-foreground
  card: "hsl(220 18% 10%)",             // --card
  border: "hsl(220 14% 18%)",           // --border
  referenceLine: "hsl(220 10% 25%)",    // between --border and --muted-foreground
} as const;

export interface ChartEventMarker {
  /** X-axis label where the event starts (must match a `day` value in chartData). */
  startLabel: string;
  /** X-axis label where the event ends. If equal to startLabel, renders as a single line. */
  endLabel?: string;
  color: string;
  title: string;
}

export interface VibesChartDatum {
  day: string;
  score: number | null;
  isCarryForward?: boolean;
  eligiblePosts?: number | null;
}

interface VibesChartProps {
  chartData: VibesChartDatum[];
  accent: string;
  timeRange: string;
  events?: ChartEventMarker[];
}

function computeYDomain(data: { score: number | null }[]): [number, number] {
  // Auto-scale around the visible data with a 5-point pad and snap to multiples of 5.
  // Always cap to [0, 100] since scores can never exceed that range.
  const scores = data.map((d) => d.score).filter((v): v is number => typeof v === "number");
  if (scores.length === 0) return [20, 100];
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const lo = Math.max(0, Math.floor((min - 5) / 5) * 5);
  const hi = Math.min(100, Math.ceil((max + 5) / 5) * 5);
  // Keep at least a 30-point span so a flat day doesn't crush the line.
  if (hi - lo < 30) {
    const mid = (hi + lo) / 2;
    return [Math.max(0, Math.round((mid - 15) / 5) * 5), Math.min(100, Math.round((mid + 15) / 5) * 5)];
  }
  return [lo, hi];
}

interface CarryForwardTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: VibesChartDatum; value: number | null }>;
  label?: string;
  accent: string;
}

const CarryForwardTooltip = ({ active, payload, label, accent }: CarryForwardTooltipProps) => {
  if (!active || !payload || payload.length === 0) return null;
  const datum = payload[0].payload;
  if (datum.score == null) return null;
  // Carry-forward days don't carry an authentic eligible-posts count; suppress
  // the confidence chip on those (it'd always read "Preliminary" because
  // total_posts=0 → eligible_posts=0, and we already mark them with the
  // dashed dot + carry-forward note).
  const showConfidence = !datum.isCarryForward && datum.eligiblePosts != null;
  return (
    <div
      style={{
        background: CHART_COLORS.card,
        border: `1px solid ${CHART_COLORS.border}`,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      <p style={{ color: CHART_COLORS.mutedForeground, margin: 0 }}>{label}</p>
      <p style={{ color: accent, margin: "2px 0 0" }}>score: {datum.score}</p>
      {showConfidence && (
        <div style={{ marginTop: 4 }}>
          <ConfidenceChip eligiblePosts={datum.eligiblePosts} size="sm" />
        </div>
      )}
      {datum.isCarryForward && (
        <p style={{ color: CHART_COLORS.mutedForeground, fontSize: 10, margin: "4px 0 0" }}>
          Carry-forward — 0 posts scraped
        </p>
      )}
    </div>
  );
};

interface CarryForwardDotProps {
  cx?: number;
  cy?: number;
  payload?: VibesChartDatum;
  index?: number;
}

// Recharts hands a synthetic `key` to its dot renderer as a real prop and
// also expects each returned element to carry its own key. We pluck it off
// and apply it directly to the SVG element to avoid React's key-in-spread
// and missing-key warnings.
const renderCarryForwardDot = (accent: string) => (props: CarryForwardDotProps) => {
  const { cx, cy, payload, index } = props;
  const dotKey = `dot-${index ?? 0}`;
  if (cx == null || cy == null || !payload?.isCarryForward || payload.score == null) {
    return <g key={dotKey} />;
  }
  return (
    <circle
      key={dotKey}
      cx={cx}
      cy={cy}
      r={4}
      fill={CHART_COLORS.card}
      stroke={accent}
      strokeWidth={1.5}
      strokeDasharray="2 2"
    />
  );
};

const VibesChart = memo(({ chartData, accent, timeRange, events = [] }: VibesChartProps) => {
  const [yMin, yMax] = computeYDomain(chartData);
  const showMidlineRef = yMin <= 50 && yMax >= 50;
  return (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 0, left: 0 }}>
      <XAxis
        dataKey="day"
        tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        interval={timeRange === "30d" ? Math.max(Math.floor(chartData.length / 5) - 1, 0) : timeRange === "7d" ? 0 : Math.max(Math.floor(chartData.length / 5) - 1, 0)}
        padding={{ left: 10, right: 10 }}
      />
      <YAxis
        domain={[yMin, yMax]}
        tick={{ fill: CHART_COLORS.mutedForeground, fontSize: 10 }}
        axisLine={false}
        tickLine={false}
        width={30}
      />
      <Tooltip
        content={(props) => <CarryForwardTooltip {...(props as CarryForwardTooltipProps)} accent={accent} />}
      />
      {showMidlineRef && (
        <ReferenceLine y={50} stroke={CHART_COLORS.referenceLine} strokeDasharray="4 4" />
      )}
      {events.map((event, i) => {
        const isRange = event.endLabel && event.endLabel !== event.startLabel;
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
          />
        );
      })}
      <Line
        type="monotone"
        dataKey="score"
        stroke={accent}
        strokeWidth={2.5}
        dot={renderCarryForwardDot(accent)}
        activeDot={{ r: 4, fill: accent, strokeWidth: 0 }}
        connectNulls={false}
      />
    </LineChart>
  </ResponsiveContainer>
  );
});
VibesChart.displayName = "VibesChart";

export default VibesChart;
