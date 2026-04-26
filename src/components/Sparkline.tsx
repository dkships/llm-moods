import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { memo } from "react";

export interface SparklinePoint {
  score: number;
  isCarryForward: boolean;
}

interface SparklineProps {
  data: SparklinePoint[];
  accent: string;
}

interface CarryForwardDotProps {
  cx?: number;
  cy?: number;
  payload?: { score: number; isCarryForward: boolean };
  index?: number;
}

// Recharts hands a synthetic `key` as a real prop and expects each returned
// element to carry its own key. Apply it directly to the SVG element to
// avoid React's key-in-spread and missing-key warnings.
const renderCarryForwardDot = (accent: string) => (props: CarryForwardDotProps) => {
  const { cx, cy, payload, index } = props;
  const dotKey = `spark-${index ?? 0}`;
  if (cx == null || cy == null || !payload?.isCarryForward) return <g key={dotKey} />;
  return (
    <circle
      key={dotKey}
      cx={cx}
      cy={cy}
      r={2.5}
      fill="none"
      stroke={accent}
      strokeWidth={1}
      strokeDasharray="2 1.5"
    />
  );
};

const Sparkline = memo(({ data, accent }: SparklineProps) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data.map((p, idx) => ({ day: idx, ...p }))}>
      <YAxis domain={["dataMin - 5", "dataMax + 5"]} hide />
      <Line
        type="monotone"
        dataKey="score"
        stroke={accent}
        strokeWidth={2}
        dot={renderCarryForwardDot(accent)}
      />
    </LineChart>
  </ResponsiveContainer>
));
Sparkline.displayName = "Sparkline";

export default Sparkline;
