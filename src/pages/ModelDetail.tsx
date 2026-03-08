import { useParams, Link } from "react-router-dom";
import { Sun, CloudSun, CloudLightning, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import {
  LineChart, Line, ResponsiveContainer, YAxis, XAxis, Tooltip, ReferenceLine,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import usePageTitle from "@/hooks/usePageTitle";

// Seed-based pseudo-random for consistent mock data
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

const generateSparkline = (base: number, volatility: number, days: number, seed: number) =>
  Array.from({ length: days }, (_, i) => ({
    day: `Day ${i + 1}`,
    score: Math.round(base + (seededRandom(seed + i) - 0.5) * volatility * 2),
  }));

const MODEL_DATA: Record<string, {
  name: string;
  accent: string;
  vibe: string;
  vibeIcon: typeof Sun;
  score: number;
  trend: { direction: "up" | "down"; pts: number };
  posts24h: number;
  complaints: { label: string; pct: number }[];
  sources: { name: string; pct: number }[];
  sparkSeed: number;
  sparkBase: number;
  recentPosts: { source: string; sub: string; snippet: string; sentiment: "positive" | "negative" | "neutral"; time: string }[];
}> = {
  claude: {
    name: "Claude",
    accent: "#E87B35",
    vibe: "Mixed Signals",
    vibeIcon: CloudSun,
    score: 68,
    trend: { direction: "down", pts: 3 },
    posts24h: 847,
    sparkSeed: 42,
    sparkBase: 68,
    complaints: [
      { label: "Lazy responses", pct: 34 },
      { label: "Refusals", pct: 22 },
      { label: "Coding quality", pct: 18 },
      { label: "Hallucinations", pct: 12 },
      { label: "Speed", pct: 9 },
      { label: "General drop", pct: 5 },
    ],
    sources: [
      { name: "Reddit", pct: 62 },
      { name: "Hacker News", pct: 38 },
    ],
    recentPosts: [
      { source: "Reddit", sub: "r/ClaudeAI", snippet: "Is it just me or has Claude been incredibly lazy today? Asked it to write a function and it gave me pseudocode with \"implement the rest here\"...", sentiment: "negative", time: "2h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Claude's analysis quality is still best-in-class when it actually tries. The inconsistency is what kills me.", sentiment: "neutral", time: "4h ago" },
      { source: "Reddit", sub: "r/ClaudeAI", snippet: "Claude 3.5 Sonnet just helped me refactor an entire codebase in one shot. When it's on, it's ON.", sentiment: "positive", time: "5h ago" },
      { source: "Reddit", sub: "r/ClaudeAI", snippet: "Got another refusal for a completely benign creative writing prompt. This over-safety stuff is getting worse.", sentiment: "negative", time: "7h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Compared Claude vs GPT-4o on 50 coding tasks. Claude won 32, but had 8 tasks where it just gave up midway.", sentiment: "neutral", time: "9h ago" },
    ],
  },
  chatgpt: {
    name: "ChatGPT",
    accent: "#10A37F",
    vibe: "Good Vibes",
    vibeIcon: Sun,
    score: 84,
    trend: { direction: "up", pts: 5 },
    posts24h: 1243,
    sparkSeed: 99,
    sparkBase: 82,
    complaints: [
      { label: "Hallucinations", pct: 28 },
      { label: "Lazy responses", pct: 20 },
      { label: "Speed", pct: 18 },
      { label: "Coding quality", pct: 16 },
      { label: "Refusals", pct: 11 },
      { label: "General drop", pct: 7 },
    ],
    sources: [
      { name: "Reddit", pct: 71 },
      { name: "Hacker News", pct: 29 },
    ],
    recentPosts: [
      { source: "HN", sub: "Hacker News", snippet: "GPT-4o has been really solid this week. Complex refactoring tasks that used to fail are working first try now.", sentiment: "positive", time: "3h ago" },
      { source: "Reddit", sub: "r/ChatGPT", snippet: "Anyone else notice ChatGPT hallucinating more links lately? Third time today it gave me a URL that doesn't exist.", sentiment: "negative", time: "5h ago" },
      { source: "Reddit", sub: "r/ChatGPT", snippet: "The new memory feature is actually game-changing. It remembered my project context across sessions perfectly.", sentiment: "positive", time: "6h ago" },
      { source: "Reddit", sub: "r/ChatGPT", snippet: "GPT-4o mini is surprisingly good for quick tasks. Fast and accurate for 90% of what I need.", sentiment: "positive", time: "8h ago" },
      { source: "HN", sub: "Hacker News", snippet: "OpenAI's API latency has gotten noticeably worse this week. Anyone else seeing 5+ second response times?", sentiment: "negative", time: "10h ago" },
    ],
  },
  gemini: {
    name: "Gemini",
    accent: "#4285F4",
    vibe: "Good Vibes",
    vibeIcon: Sun,
    score: 79,
    trend: { direction: "up", pts: 2 },
    posts24h: 612,
    sparkSeed: 17,
    sparkBase: 76,
    complaints: [
      { label: "Speed", pct: 26 },
      { label: "Hallucinations", pct: 24 },
      { label: "Coding quality", pct: 19 },
      { label: "Lazy responses", pct: 14 },
      { label: "General drop", pct: 10 },
      { label: "Refusals", pct: 7 },
    ],
    sources: [
      { name: "Reddit", pct: 55 },
      { name: "Hacker News", pct: 45 },
    ],
    recentPosts: [
      { source: "Reddit", sub: "r/GoogleGemini", snippet: "Gemini 2.0 is genuinely impressive for multimodal tasks. Fed it a diagram and it understood the architecture perfectly.", sentiment: "positive", time: "4h ago" },
      { source: "Reddit", sub: "r/GoogleGemini", snippet: "Gemini's context window handling has gotten noticeably better. Ran a 90k token doc through it with no issues.", sentiment: "positive", time: "8h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Google's API keeps timing out during peak hours. The model is great when it works, but reliability is an issue.", sentiment: "negative", time: "6h ago" },
      { source: "Reddit", sub: "r/GoogleGemini", snippet: "Tried Gemini for SQL generation and it nailed every query. Better than GPT for database stuff honestly.", sentiment: "positive", time: "10h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Gemini still hallucinates package names that don't exist. Cost me an hour debugging phantom imports.", sentiment: "negative", time: "12h ago" },
    ],
  },
  grok: {
    name: "Grok",
    accent: "#FF0000",
    vibe: "Bad Vibes",
    vibeIcon: CloudLightning,
    score: 41,
    trend: { direction: "down", pts: 8 },
    posts24h: 389,
    sparkSeed: 73,
    sparkBase: 48,
    complaints: [
      { label: "Refusals", pct: 31 },
      { label: "Coding quality", pct: 25 },
      { label: "Hallucinations", pct: 19 },
      { label: "Lazy responses", pct: 12 },
      { label: "General drop", pct: 8 },
      { label: "Speed", pct: 5 },
    ],
    sources: [
      { name: "Reddit", pct: 48 },
      { name: "Hacker News", pct: 52 },
    ],
    recentPosts: [
      { source: "HN", sub: "Hacker News", snippet: "Tried Grok for coding and it refused to help me write a web scraper because it might \"violate terms of service.\" Come on.", sentiment: "negative", time: "6h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Grok keeps generating wrong import statements for Python packages. Basic stuff that worked fine last week.", sentiment: "negative", time: "9h ago" },
      { source: "Reddit", sub: "r/grok", snippet: "Grok's humor mode is actually funny sometimes. Asked it to roast my code and it found a real bug while doing it.", sentiment: "positive", time: "5h ago" },
      { source: "Reddit", sub: "r/grok", snippet: "The X integration is cool in theory but Grok's answers about current events are often just wrong.", sentiment: "negative", time: "11h ago" },
      { source: "HN", sub: "Hacker News", snippet: "Grok 2 was promising but the latest update feels like a regression. Simple math errors I didn't see before.", sentiment: "negative", time: "13h ago" },
    ],
  },
};

const TIME_RANGES = ["24h", "7d", "30d"] as const;
const DAYS_MAP: Record<string, number> = { "24h": 24, "7d": 7, "30d": 30 };

const SENTIMENT_STYLES: Record<string, { label: string; classes: string }> = {
  positive: { label: "Positive", classes: "bg-primary/15 text-primary border-primary/20" },
  negative: { label: "Negative", classes: "bg-destructive/15 text-destructive border-destructive/20" },
  neutral: { label: "Neutral", classes: "bg-muted text-muted-foreground border-border" },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.45, ease: [0, 0, 0.2, 1] as const },
  }),
};

const ModelDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const [timeRange, setTimeRange] = useState<typeof TIME_RANGES[number]>("30d");

  const model = slug ? MODEL_DATA[slug] : undefined;

  usePageTitle(model ? `${model.name} Vibes — LLM Vibes` : "Model Not Found — LLM Vibes");

  if (!model) {
    return (
      <PageTransition>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-foreground mb-4">Model not found</p>
            <Link to="/dashboard">
              <Button variant="outline" className="font-mono text-sm">Back to Dashboard</Button>
            </Link>
          </div>
        </div>
      </PageTransition>
    );
  }

  const chartData = generateSparkline(model.sparkBase, 12, DAYS_MAP[timeRange], model.sparkSeed);
  const VibeIcon = model.vibeIcon;

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />

      {/* Model Header */}
      <section className="container pt-10 pb-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="h-4 w-4" />
            Back to Dashboard
          </Link>
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-3">
              <div className="h-10 w-1.5 rounded-full" style={{ background: model.accent }} />
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground">{model.name}</h1>
            </div>
            <div className="flex items-center gap-2">
              <VibeIcon className="h-5 w-5" style={{ color: model.accent }} />
              <span className="font-mono text-sm text-foreground">{model.vibe}</span>
            </div>
          </div>
          <div className="mt-4 flex flex-col sm:flex-row sm:items-end gap-4">
            <p className="text-6xl font-bold font-mono text-foreground">{model.score}<span className="text-xl text-muted-foreground ml-1">/ 100</span></p>
            <div className="flex items-center gap-2 pb-2">
              {model.trend.direction === "up" ? (
                <TrendingUp className="h-4 w-4 text-primary" />
              ) : (
                <TrendingDown className="h-4 w-4 text-destructive" />
              )}
              <span className={`text-sm font-mono ${model.trend.direction === "up" ? "text-primary" : "text-destructive"}`}>
                {model.trend.direction === "up" ? "up" : "down"} {model.trend.pts} pts from yesterday
              </span>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground font-mono">
            Based on {model.posts24h.toLocaleString()} posts in the last 24 hours
          </p>
        </motion.div>
      </section>

      {/* Main Content: Two Columns */}
      <section className="container pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column — Chart */}
          <motion.div
            className="lg:col-span-2 glass rounded-xl p-6"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.45 }}
          >
            <h2 className="text-lg font-semibold text-foreground mb-1">Vibes Over Time</h2>
            <p className="text-xs text-muted-foreground font-mono mb-4">Daily vibes score</p>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <XAxis
                    dataKey="day"
                    tick={{ fill: "hsl(220 10% 50%)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval={timeRange === "30d" ? 4 : timeRange === "7d" ? 0 : 3}
                  />
                  <YAxis
                    domain={[20, 100]}
                    tick={{ fill: "hsl(220 10% 50%)", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    width={30}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(220 18% 10%)",
                      border: "1px solid hsl(220 14% 18%)",
                      borderRadius: 8,
                      fontSize: 12,
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                    labelStyle={{ color: "hsl(220 10% 50%)" }}
                    itemStyle={{ color: model.accent }}
                  />
                  <ReferenceLine
                    y={50}
                    stroke="hsl(220 10% 25%)"
                    strokeDasharray="4 4"
                    label={{ value: "Neutral", fill: "hsl(220 10% 35%)", fontSize: 10, position: "right" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="score"
                    stroke={model.accent}
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 4, fill: model.accent, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex gap-2">
              {TIME_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setTimeRange(r)}
                  className={`px-3 py-1.5 rounded-md text-xs font-mono transition-colors ${
                    timeRange === r
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          </motion.div>

          {/* Right Column — Complaints + Sources */}
          <div className="space-y-6">
            <motion.div
              className="glass rounded-xl p-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.45 }}
            >
              <h2 className="text-lg font-semibold text-foreground mb-4">Complaint Breakdown</h2>
              <div className="space-y-3">
                {model.complaints.map((c) => (
                  <div key={c.label}>
                    <div className="flex justify-between text-xs font-mono mb-1">
                      <span className="text-muted-foreground">{c.label}</span>
                      <span className="text-foreground">{c.pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${c.pct}%`, background: model.accent }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <motion.div
              className="glass rounded-xl p-6"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.45 }}
            >
              <h2 className="text-lg font-semibold text-foreground mb-4">Sources</h2>
              <div className="space-y-3">
                {model.sources.map((s) => (
                  <div key={s.name}>
                    <div className="flex justify-between text-xs font-mono mb-1">
                      <span className="text-muted-foreground">{s.name}</span>
                      <span className="text-foreground">{s.pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${s.pct}%`, background: model.accent, opacity: 0.7 }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* Recent Posts */}
      <section className="container pb-20">
        <motion.h2
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
          className="text-xl font-bold text-foreground mb-6"
        >
          Recent Posts about {model.name}
        </motion.h2>
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
          className="space-y-3"
        >
          {model.recentPosts.map((post, i) => {
            const s = SENTIMENT_STYLES[post.sentiment];
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                custom={i}
                className="glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary border border-border shrink-0">
                  {post.source === "Reddit" ? "🟠" : "🟡"} {post.sub}
                </span>
                <p className="text-sm text-foreground/80 flex-1 leading-relaxed line-clamp-2">{post.snippet}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.classes}`}>
                    {s.label}
                  </Badge>
                  <span className="text-xs text-muted-foreground font-mono">{post.time}</span>
                </div>
              </motion.div>
            );
          })}
        </motion.div>
      </section>
    </div>
    </PageTransition>
  );
};

export default ModelDetail;
