import { Sun, CloudSun, CloudLightning, TrendingUp, TrendingDown, MessageSquare, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const MODELS = [
  {
    slug: "claude",
    name: "Claude",
    accent: "#E87B35",
    vibe: "Mixed Signals",
    vibeIcon: CloudSun,
    score: 68,
    trend: { direction: "down" as const, pts: 3 },
    sparkline: [72, 75, 71, 74, 70, 66, 68],
    topComplaint: "Lazy responses",
    posts: 847,
  },
  {
    slug: "chatgpt",
    name: "ChatGPT",
    accent: "#10A37F",
    vibe: "Good Vibes",
    vibeIcon: Sun,
    score: 84,
    trend: { direction: "up" as const, pts: 5 },
    sparkline: [78, 76, 80, 79, 82, 81, 84],
    topComplaint: "Hallucinations",
    posts: 1243,
  },
  {
    slug: "gemini",
    name: "Gemini",
    accent: "#4285F4",
    vibe: "Good Vibes",
    vibeIcon: Sun,
    score: 79,
    trend: { direction: "up" as const, pts: 2 },
    sparkline: [74, 73, 76, 75, 77, 78, 79],
    topComplaint: "Slow speed",
    posts: 612,
  },
  {
    slug: "grok",
    name: "Grok",
    accent: "#FF0000",
    vibe: "Bad Vibes",
    vibeIcon: CloudLightning,
    score: 41,
    trend: { direction: "down" as const, pts: 8 },
    sparkline: [55, 52, 50, 48, 46, 44, 41],
    topComplaint: "Over-safety refusals",
    posts: 389,
  },
];

const CHATTER = [
  {
    source: "Reddit",
    sub: "r/ClaudeAI",
    snippet: "Is it just me or has Claude been incredibly lazy today? Asked it to write a function and it gave me pseudocode with \"implement the rest here\"...",
    model: "Claude",
    sentiment: "negative" as const,
    time: "2h ago",
  },
  {
    source: "HN",
    sub: "Hacker News",
    snippet: "GPT-4o has been really solid this week. Complex refactoring tasks that used to fail are working first try now.",
    model: "ChatGPT",
    sentiment: "positive" as const,
    time: "3h ago",
  },
  {
    source: "Reddit",
    sub: "r/GoogleGemini",
    snippet: "Gemini 2.0 is genuinely impressive for multimodal tasks. Fed it a diagram and it understood the architecture perfectly.",
    model: "Gemini",
    sentiment: "positive" as const,
    time: "4h ago",
  },
  {
    source: "Reddit",
    sub: "r/ChatGPT",
    snippet: "Anyone else notice ChatGPT hallucinating more links lately? Third time today it gave me a URL that doesn't exist.",
    model: "ChatGPT",
    sentiment: "negative" as const,
    time: "5h ago",
  },
  {
    source: "HN",
    sub: "Hacker News",
    snippet: "Tried Grok for coding and it refused to help me write a web scraper because it might \"violate terms of service.\" Come on.",
    model: "Grok",
    sentiment: "negative" as const,
    time: "6h ago",
  },
  {
    source: "Reddit",
    sub: "r/LocalLLaMA",
    snippet: "Claude's analysis quality is still best-in-class when it actually tries. The inconsistency is what kills me.",
    model: "Claude",
    sentiment: "neutral" as const,
    time: "7h ago",
  },
  {
    source: "Reddit",
    sub: "r/GoogleGemini",
    snippet: "Gemini's context window handling has gotten noticeably better. Ran a 90k token doc through it with no issues.",
    model: "Gemini",
    sentiment: "positive" as const,
    time: "8h ago",
  },
  {
    source: "HN",
    sub: "Hacker News",
    snippet: "Grok keeps generating wrong import statements for Python packages. Basic stuff that worked fine last week.",
    model: "Grok",
    sentiment: "negative" as const,
    time: "9h ago",
  },
];

const MODEL_COLORS: Record<string, string> = {
  Claude: "#E87B35",
  ChatGPT: "#10A37F",
  Gemini: "#4285F4",
  Grok: "#FF0000",
};

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

const Dashboard = () => {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <Link to="/" className="font-display text-lg font-bold tracking-tight text-foreground">
            🌊 LLM <span className="text-primary">Vibes</span>
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-sm text-foreground font-medium">Dashboard</span>
            <Button size="sm" className="font-mono text-xs">Report a Vibe</Button>
          </div>
        </div>
      </header>

      {/* Page Header */}
      <section className="container pt-10 pb-8">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
          <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Current Vibes</h1>
          <p className="mt-2 text-sm text-muted-foreground font-mono">
            {today} · Last updated: 4 minutes ago
          </p>
        </motion.div>
      </section>

      {/* Model Cards */}
      <section className="container pb-12">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {MODELS.map((m, i) => (
            <Link key={m.name} to={`/model/${m.slug}`}>
              <motion.div
                variants={fadeUp}
                custom={i}
                className="glass rounded-xl overflow-hidden hover:glow-border transition-all duration-300 cursor-pointer h-full"
              >
              <div className="h-1" style={{ background: m.accent }} />
              <div className="p-6">
                {/* Top row */}
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-display text-base font-semibold text-foreground">{m.name}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <m.vibeIcon className="h-5 w-5" style={{ color: m.accent }} />
                      <span className="font-mono text-sm text-foreground">{m.vibe}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-4xl font-bold font-mono text-foreground">{m.score}</p>
                    <p className="text-xs text-muted-foreground font-mono mt-0.5">/ 100</p>
                  </div>
                </div>

                {/* Sparkline */}
                <div className="mt-4 h-12">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={m.sparkline.map((v, idx) => ({ day: idx, score: v }))}>
                      <YAxis domain={["dataMin - 5", "dataMax + 5"]} hide />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke={m.accent}
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                {/* Bottom row */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                  <div className="flex items-center gap-1.5">
                    {m.trend.direction === "up" ? (
                      <TrendingUp className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-destructive" />
                    )}
                    <span className={m.trend.direction === "up" ? "text-primary" : "text-destructive"}>
                      {m.trend.direction === "up" ? "up" : "down"} {m.trend.pts} pts from yesterday
                    </span>
                  </div>
                  <span className="text-muted-foreground">Based on {m.posts.toLocaleString()} posts</span>
                </div>

                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Top complaint:</span>
                  <span className="text-foreground font-medium">{m.topComplaint}</span>
                </div>
              </div>
            </motion.div>
            </Link>
          ))}
        </motion.div>
      </section>

      {/* Community Chatter */}
      <section className="container pb-20">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.4 }}
        >
          <div className="flex items-center gap-2 mb-6">
            <MessageSquare className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-bold text-foreground">Recent Community Chatter</h2>
          </div>
        </motion.div>

        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-40px" }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
          className="space-y-3"
        >
          {CHATTER.map((post, i) => {
            const s = SENTIMENT_STYLES[post.sentiment];
            return (
              <motion.div
                key={i}
                variants={fadeUp}
                custom={i}
                className="glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
              >
                {/* Source badge */}
                <div className="flex items-center gap-3 sm:w-28 shrink-0">
                  <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary border border-border">
                    {post.source === "Reddit" ? "🟠" : "🟡"} {post.sub}
                  </span>
                </div>

                {/* Snippet */}
                <p className="text-sm text-foreground/80 flex-1 leading-relaxed line-clamp-2">{post.snippet}</p>

                {/* Meta */}
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ background: MODEL_COLORS[post.model] }}
                  />
                  <span className="text-xs font-mono text-muted-foreground">{post.model}</span>
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
  );
};

export default Dashboard;
