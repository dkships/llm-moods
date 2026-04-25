import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import { formatTimeAgo } from "@/lib/vibes";
import useHead from "@/hooks/useHead";
import { useScoreAnomalies, type AnomalySeverity } from "@/hooks/useScoreAnomalies";
import { getPublicComplaintLabel } from "@/shared/public-taxonomy";

interface MonitorRun {
  id: string;
  source: string;
  run_kind: "scraper" | "orchestrator";
  parent_run_id: string | null;
  triggered_by: string | null;
  window_label: string | null;
  window_local_date: string | null;
  timezone: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  posts_found: number | null;
  posts_classified: number | null;
  apify_items_fetched: number | null;
  filtered_candidates: number | null;
  net_new_rows: number | null;
  duplicate_conflicts: number | null;
  errors: string[] | null;
  metadata: Record<string, unknown> | null;
}

interface MonitorRpcClient {
  rpc: (
    fn: "get_scraper_monitor_runs",
    args: { limit_count: number },
  ) => Promise<{ data: MonitorRun[] | null; error: { message: string } | null }>;
}

function statusBadge(status: string) {
  if (status === "success") return "text-primary bg-primary/10 border-primary/20";
  if (status === "partial") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  if (status === "skipped") return "text-muted-foreground bg-secondary/40 border-border";
  return "text-destructive bg-destructive/10 border-destructive/20";
}

function severityBadge(severity: AnomalySeverity) {
  if (severity === "breach") return "text-destructive bg-destructive/10 border-destructive/20";
  if (severity === "watch") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  return "text-muted-foreground bg-secondary/40 border-border";
}

function renderWindowLabel(run: MonitorRun) {
  if (!run.window_label) return "—";
  const label = run.window_label === "nightly"
    ? "nightly"
    : `${run.window_label} (${run.window_local_date ?? "—"})`;
  return label;
}

const ScraperMonitor = () => {
  useHead({
    title: "Scraper Monitor — LLM Vibes",
    description: "Monitor scraper run status and health for LLM Vibes data collection.",
    url: "/admin/scrapers",
  });

  const { data: runs, isLoading } = useQuery({
    queryKey: ["scraper-monitor-runs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as MonitorRpcClient).rpc("get_scraper_monitor_runs", { limit_count: 120 });
      if (error) throw error;
      return (data || []) as MonitorRun[];
    },
  });

  const { data: anomalies, isLoading: anomaliesLoading } = useScoreAnomalies();
  const surfacedAnomalies = (anomalies ?? []).filter((a) => a.severity !== "normal");

  const allRuns = runs || [];
  const orchestratorRuns = allRuns.filter((run) => run.run_kind === "orchestrator");
  const scraperRuns = allRuns.filter((run) => run.run_kind === "scraper");
  const latestBySource = new Map<string, MonitorRun>();
  scraperRuns.forEach((run) => {
    if (!latestBySource.has(run.source)) latestBySource.set(run.source, run);
  });

  const summaryCards = [
    { label: "Total runs", value: isLoading ? "—" : allRuns.length },
    { label: "Succeeded", value: isLoading ? "—" : allRuns.filter((run) => run.status === "success").length },
    { label: "Partial", value: isLoading ? "—" : allRuns.filter((run) => run.status === "partial").length },
    { label: "Failed", value: isLoading ? "—" : allRuns.filter((run) => run.status === "failed").length },
  ];

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="container py-12">
          <h1 className="mb-2 text-2xl font-bold text-foreground">Scraper Monitor</h1>
          <p className="mb-8 font-mono text-sm text-muted-foreground">
            Window runs and scraper-level summaries. Refreshes every 30s.
          </p>

          <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="glass rounded-lg p-4">
                <p className="font-mono text-xs text-muted-foreground">{card.label}</p>
                <p className="text-xl font-bold text-foreground">{card.value}</p>
              </div>
            ))}
          </div>

          <h2 className="mb-3 text-lg font-semibold text-foreground">Score Anomalies</h2>
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            Daily scores that deviate from their trailing 14-day baseline. Watch = |z| ≥ 2, breach = |z| ≥ 3.
          </p>
          <div className="glass mb-8 overflow-x-auto rounded-xl">
            <table className="min-w-[840px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Severity</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Model</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Date</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Score</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Baseline</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">z</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Top complaint</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Posts</th>
                </tr>
              </thead>
              <tbody>
                {anomaliesLoading ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : surfacedAnomalies.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No anomalies in the last 30 days.</td></tr>
                ) : (
                  surfacedAnomalies.map((a) => (
                    <tr key={`${a.modelId}-${a.periodStart}`} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-xs ${severityBadge(a.severity)}`}>
                          {a.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        <Link to={`/model/${a.modelSlug}`} className="hover:underline">
                          {a.modelName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {a.periodStart.slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">{a.score}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {a.baselineMean.toFixed(1)} ± {a.baselineStddev.toFixed(1)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono ${a.z < 0 ? "text-destructive" : "text-primary"}`}>
                        {a.z >= 0 ? "+" : ""}{a.z.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {a.topComplaint ? getPublicComplaintLabel(a.topComplaint) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{a.totalPosts}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 text-lg font-semibold text-foreground">Coordinated Windows</h2>
          <div className="glass mb-8 overflow-x-auto rounded-xl">
            <table className="min-w-[840px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Window</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Net New</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Duplicates</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Aggregate</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Started</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : orchestratorRuns.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No window runs yet.</td></tr>
                ) : (
                  orchestratorRuns.map((run) => (
                    <tr key={run.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-foreground">{renderWindowLabel(run)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-xs ${statusBadge(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.net_new_rows ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.duplicate_conflicts ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {String((run.metadata?.aggregate_status as string | undefined) ?? run.status)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {run.started_at ? formatTimeAgo(run.started_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 text-lg font-semibold text-foreground">Latest By Scraper</h2>
          <div className="glass mb-8 overflow-x-auto rounded-xl">
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Source</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Found</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Filtered</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Classified</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Net New</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Duplicates</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">When</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : (
                  Array.from(latestBySource.values()).map((run) => (
                    <tr key={run.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-foreground">{run.source}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-xs ${statusBadge(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.posts_found ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.filtered_candidates ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.posts_classified ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.net_new_rows ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.duplicate_conflicts ?? 0}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {run.started_at ? formatTimeAgo(run.started_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h2 className="mb-3 text-lg font-semibold text-foreground">Run History</h2>
          <div className="glass overflow-x-auto rounded-xl">
            <table className="min-w-[980px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Kind</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Source</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Status</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Net New</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Duplicates</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Errors</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Started</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : allRuns.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No runs yet.</td></tr>
                ) : (
                  allRuns.map((run) => (
                    <tr key={run.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-foreground">{run.run_kind}</td>
                      <td className="px-4 py-3 font-mono text-foreground">
                        {run.run_kind === "orchestrator" ? renderWindowLabel(run) : run.source}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full border px-2 py-0.5 font-mono text-xs ${statusBadge(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.net_new_rows ?? 0}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{run.duplicate_conflicts ?? 0}</td>
                      <td className="max-w-[240px] truncate px-4 py-3 text-xs text-muted-foreground">
                        {run.errors && run.errors.length > 0 ? run.errors.join("; ").slice(0, 140) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                        {run.started_at ? formatTimeAgo(run.started_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ScraperMonitor;
