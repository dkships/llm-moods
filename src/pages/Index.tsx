import { Sun, CloudSun, CloudLightning, TrendingUp, TrendingDown, Minus, Monitor, Brain, CheckCircle, ArrowRight, Github, Twitter } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";

const MODELS = [
  {
    name: "Claude",
    accent: "#E87B35",
    vibe: "Mixed Signals",
    icon: CloudSun,
    trend: "down",
    reports: 34,
  },
  {
    name: "ChatGPT",
    accent: "#10A37F",
    vibe: "Good Vibes",
    icon: Sun,
    trend: "up",
    reports: 12,
  },
  {
    name: "Gemini",
    accent: "#4285F4",
    vibe: "Good Vibes",
    icon: Sun,
    trend: "up",
    reports: 8,
  },
  {
    name: "Grok",
    accent: "#FF0000",
    vibe: "Bad Vibes",
    icon: CloudLightning,
    trend: "down",
    reports: 57,
  },
];

const HOW_IT_WORKS = [
  {
    icon: Monitor,
    title: "We Scrape",
    description: "We scan Reddit, Hacker News, and social platforms for real-time chatter about AI models.",
  },
  {
    icon: Brain,
    title: "We Analyze",
    description: "AI-powered sentiment analysis categorizes complaints by type and severity.",
  },
  {
    icon: CheckCircle,
    title: "You Decide",
    description: "See real-time vibes at a glance and report your own experience to the community.",
  },
];

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0, 0, 0.2, 1] as const },
  }),
};

const TrendIcon = ({ trend }: { trend: string }) => {
  if (trend === "up") return <TrendingUp className="h-4 w-4 text-primary" />;
  if (trend === "down") return <TrendingDown className="h-4 w-4 text-destructive" />;
  return <Minus className="h-4 w-4 text-muted-foreground" />;
};

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between">
          <span className="font-display text-lg font-bold tracking-tight text-foreground">
            🌊 LLM <span className="text-primary">Vibes</span>
          </span>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-sm text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
              Dashboard
            </span>
            <Button size="sm" className="font-mono text-xs">
              Report a Vibe
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="container py-24 sm:py-32">
        <motion.div
          className="max-w-3xl"
          initial="hidden"
          animate="visible"
          variants={{
            hidden: {},
            visible: { transition: { staggerChildren: 0.12 } },
          }}
        >
          <motion.div variants={fadeUp} custom={0} className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-mono text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
            Tracking 4 models live
          </motion.div>
          <motion.h1 variants={fadeUp} custom={1} className="text-4xl sm:text-6xl font-bold tracking-tight text-foreground leading-[1.1]">
            Is your AI having<br />
            a <span className="text-primary glow-text">bad day</span>?
          </motion.h1>
          <motion.p variants={fadeUp} custom={2} className="mt-5 text-lg sm:text-xl text-muted-foreground max-w-xl leading-relaxed">
            Real-time community sentiment tracking for Claude, ChatGPT, Gemini, Grok, and more. Know when the vibes are off.
          </motion.p>
          <motion.div variants={fadeUp} custom={3}>
            <Button size="lg" className="mt-8 font-mono text-sm gap-2 group">
              Check the Vibes
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Button>
          </motion.div>
        </motion.div>
      </section>

      {/* Live Vibes Preview */}
      <section className="container pb-24">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-80px" }}
          variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          {MODELS.map((m, i) => (
            <motion.div
              key={m.name}
              variants={fadeUp}
              custom={i}
              className="glass rounded-xl overflow-hidden hover:glow-border transition-all duration-300 cursor-pointer group"
            >
              <div className="h-1" style={{ background: m.accent }} />
              <div className="p-5">
                <p className="font-display text-sm font-semibold text-foreground">{m.name}</p>
                <div className="mt-3 flex items-center gap-2">
                  <m.icon className="h-5 w-5" style={{ color: m.accent }} />
                  <span className="font-mono text-sm text-foreground">{m.vibe}</span>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <TrendIcon trend={m.trend} />
                  <span className="text-xs font-mono text-muted-foreground">
                    +{m.reports} reports today
                  </span>
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </section>

      {/* How It Works */}
      <section className="border-y border-border bg-card/30">
        <div className="container py-24">
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center text-2xl sm:text-3xl font-bold text-foreground mb-16"
          >
            How it works
          </motion.h2>
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-60px" }}
            variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.12 } } }}
            className="grid grid-cols-1 sm:grid-cols-3 gap-8"
          >
            {HOW_IT_WORKS.map((step, i) => (
              <motion.div key={step.title} variants={fadeUp} custom={i} className="text-center">
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10 border border-primary/20">
                  <step.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-display text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border">
        <div className="container flex flex-col sm:flex-row items-center justify-between gap-4 py-8">
          <p className="text-sm text-muted-foreground font-mono">
            Built for the AI-obsessed. LLM Vibes 2025.
          </p>
          <div className="flex items-center gap-4">
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
              <Twitter className="h-4 w-4" />
            </a>
            <a href="#" className="text-muted-foreground hover:text-foreground transition-colors">
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;
