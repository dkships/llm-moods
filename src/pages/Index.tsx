import { Activity, BarChart3, Zap } from "lucide-react";

const MODELS = [
  { name: "GPT-4o", vibe: 92, trend: "+3" },
  { name: "Claude 3.5", vibe: 88, trend: "+7" },
  { name: "Gemini 2.0", vibe: 74, trend: "-2" },
  { name: "Llama 3.1", vibe: 81, trend: "+1" },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="border-b border-border">
        <div className="container flex h-16 items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <span className="font-display text-lg font-bold tracking-tight text-foreground">
              LLM <span className="text-primary">Vibes</span>
            </span>
          </div>
          <nav className="flex items-center gap-6 text-sm text-muted-foreground">
            <span className="text-foreground">Dashboard</span>
            <span className="cursor-pointer hover:text-foreground transition-colors">Models</span>
            <span className="cursor-pointer hover:text-foreground transition-colors">Community</span>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="container py-20">
        <div className="max-w-2xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-mono text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse-glow" />
            Live tracking
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-foreground leading-tight">
            Real-time sentiment<br />
            on <span className="text-primary glow-text">AI models</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-lg">
            Community-powered quality scores for the models that matter. See what builders actually think.
          </p>
        </div>
      </section>

      {/* Stats row */}
      <section className="container pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: Activity, label: "Active Voters", value: "12,847" },
            { icon: BarChart3, label: "Votes Today", value: "3,291" },
            { icon: Zap, label: "Models Tracked", value: "24" },
          ].map(({ icon: Icon, label, value }) => (
            <div key={label} className="glass rounded-lg p-5">
              <div className="flex items-center gap-3">
                <Icon className="h-4 w-4 text-primary" />
                <span className="text-sm text-muted-foreground">{label}</span>
              </div>
              <p className="mt-2 text-2xl font-bold font-mono text-foreground">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Model cards */}
      <section className="container pb-20">
        <h2 className="text-xl font-semibold text-foreground mb-4">Trending Models</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MODELS.map((m) => (
            <div
              key={m.name}
              className="glass rounded-lg p-5 hover:glow-border transition-shadow cursor-pointer"
            >
              <p className="font-mono text-sm text-muted-foreground">{m.name}</p>
              <p className="mt-2 text-3xl font-bold text-foreground">{m.vibe}</p>
              <p className={`mt-1 text-sm font-mono ${m.trend.startsWith("+") ? "text-primary" : "text-destructive"}`}>
                {m.trend} this week
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Index;
