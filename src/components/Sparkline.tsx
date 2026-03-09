import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { memo } from "react";

interface SparklineProps {
  data: number[];
  accent: string;
}

const Sparkline = memo(({ data, accent }: SparklineProps) => (
  <ResponsiveContainer width="100%" height="100%">
    <LineChart data={data.map((v, idx) => ({ day: idx, score: v }))}>
      <YAxis domain={["dataMin - 5", "dataMax + 5"]} hide />
      <Line type="monotone" dataKey="score" stroke={accent} strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
));
Sparkline.displayName = "Sparkline";

export default Sparkline;
