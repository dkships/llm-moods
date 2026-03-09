import { TrendingUp, TrendingDown, MessageSquare, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";
import usePageTitle from "@/hooks/usePageTitle";
import Footer from "@/components/Footer";
import { useModelsWithLatestVibes, useRecentChatter } from "@/hooks/useVibesData";
import { getVibeStatus, fadeUp, COMPLAINT_LABELS, SENTIMENT_STYLES, formatTimeAgo, formatSourceDisplay, SOURCE_LABELS } from "@/lib/vibes";
import { DashboardCardSkeleton, ChatterSkeleton } from "@/components/Skeletons";

const Dashboard = () => {
  usePageTitle("Dashboard — LLM Vibes");
  const { data: models, isLoading: modelsLoading } = useModelsWithLatestVibes();
  const { data: chatter, isLoading: chatterLoading } = useRecentChatter(8);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />

        {/* Page Header */}
        <section className="container pt-10 pb-8">
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Current Vibes</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <p className="text-sm text-muted-foreground font-mono">
                {today} · Last updated: {(() => {
                  const latest = models?.reduce((newest, m) => {
                    if (!m.lastUpdated) return newest;
                    return !newest || new Date(m.lastUpdated) > new Date(newest) ? m.lastUpdated : newest;
                  }, null as string | null);
                  if (!latest) return "—";
                  return formatTimeAgo(latest);
                })()}
              </p>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary/50 px-2.5 py-0.5 text-[10px] font-mono text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/50 animate-pulse" />
                Data updates every hour
              </span>
            </div>
          </motion.div>
        </section>

        {/* Model Cards */}
        <section className="container pb-12">
          {modelsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 5 }).map((_, i) => <DashboardCardSkeleton key={i} />)}
            </div>
          ) : (
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            >
              {(models || []).map((m, i) => {
                const vibe = getVibeStatus(m.latestScore);
                const VibeIcon = vibe.icon;
                const accent = m.accent_color || "#888";
                return (
                  <Link key={m.id} to={`/model/${m.slug}`} className="block">
                    <motion.div
                      variants={fadeUp}
                      custom={i}
                      className="glass rounded-xl overflow-hidden transition-all duration-300 cursor-pointer h-full hover:-translate-y-1"
                      whileHover={{ boxShadow: `0 0 24px ${accent}25, 0 8px 32px ${accent}15` }}
                    >
                      <div className="h-1" style={{ background: accent }} />
                      <div className="p-6">
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="font-display text-base font-semibold text-foreground">{m.name}</p>
                            <div className="mt-2 flex items-center gap-2">
                              <VibeIcon className="h-5 w-5" style={{ color: accent }} />
                              <span className="font-mono text-sm text-foreground">{vibe.label}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-4xl font-bold font-mono text-foreground">{m.latestScore}</p>
                            <p className="text-xs text-muted-foreground font-mono mt-0.5">/ 100</p>
                          </div>
                        </div>

                        {/* Sparkline */}
                        {m.sparkline.length > 1 && (
                          <div className="mt-4 h-12">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={m.sparkline.map((v, idx) => ({ day: idx, score: v }))}>
                                <YAxis domain={["dataMin - 5", "dataMax + 5"]} hide />
                                <Line type="monotone" dataKey="score" stroke={accent} strokeWidth={2} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

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
                          <span className="text-muted-foreground">Based on {(m.totalPosts || 0).toLocaleString()} posts</span>
                        </div>

                        {m.topComplaint && (
                          <div className="mt-3 flex items-center gap-2 text-xs">
                            <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Top complaint:</span>
                            <span className="text-foreground font-medium">{COMPLAINT_LABELS[m.topComplaint] || m.topComplaint}</span>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  </Link>
                );
              })}
            </motion.div>
          )}
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

          {chatterLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => <ChatterSkeleton key={i} />)}
            </div>
          ) : (
            <motion.div
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: "-40px" }}
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.06 } } }}
              className="space-y-3"
            >
              {(chatter || []).map((post, i) => {
                const s = SENTIMENT_STYLES[post.sentiment || "neutral"];
                const src = formatSourceDisplay(post.source);
                const modelData = post.models as { name: string; accent_color: string | null; slug: string } | null;
                return (
                  <motion.div
                    key={post.id}
                    variants={fadeUp}
                    custom={i}
                    className="glass rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                  >
                    <div className="flex items-center gap-3 sm:w-28 shrink-0">
                      <span className="text-xs font-mono text-muted-foreground px-2 py-0.5 rounded bg-secondary border border-border">
                        {src.emoji} {src.label}
                      </span>
                    </div>
                    <p className="text-sm text-foreground/80 flex-1 leading-relaxed line-clamp-2">{post.content || post.title}</p>
                    <div className="flex items-center gap-2 shrink-0">
                      {modelData && (
                        <>
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: modelData.accent_color || "#888" }} />
                          <span className="text-xs font-mono text-muted-foreground">{modelData.name}</span>
                        </>
                      )}
                      <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${s.classes}`}>
                        {s.label}
                      </Badge>
                      {post.posted_at && (
                        <span className="text-xs text-muted-foreground font-mono">{formatTimeAgo(post.posted_at)}</span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          )}
        </section>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Dashboard;
