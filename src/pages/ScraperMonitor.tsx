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

interface RecentError {
  function_name: string;
  context: string | null;
  error_count: number;
  last_seen: string;
  sample_message: string | null;
}

interface QueueHealth {
  queued: number | null;
  retrying: number | null;
  failed: number | null;
  oldest_queued_at: string | null;
  next_attempt_at: string | null;
}

interface FailedPostRow {
  last_classification_error: string | null;
  posted_at: string;
  models: { slug: string | null } | { slug: string | null }[] | null;
}

interface FailedPostsByError {
  error: string;
  count: number;
  models: string[];
  oldestFailedAt: string | null;
}

interface CriticalAlert {
  id: string;
  function_name: string;
  error_message: string;
  context: string | null;
  created_at: string;
}

interface MonitorRpcClient {
  rpc: ((
    fn: "get_scraper_monitor_runs",
    args: { limit_count: number },
  ) => Promise<{ data: MonitorRun[] | null; error: { message: string } | null }>) &
    ((
      fn: "get_recent_errors",
      args: { hours_back: number },
    ) => Promise<{ data: RecentError[] | null; error: { message: string } | null }>) &
    ((
      fn: "get_classification_queue_health",
      args?: Record<string, never>,
    ) => Promise<{ data: QueueHealth[] | null; error: { message: string } | null }>) &
    ((
      fn: "get_critical_alerts",
      args: { hours_back: number },
    ) => Promise<{ data: CriticalAlert[] | null; error: { message: string } | null }>);
}

// Contexts logged to error_log that aren't actually errors — completion
// summaries, debug breadcrumbs, retry-attempt notices. These are useful in
// raw error_log inspection but noise on the dashboard.
const NON_ERROR_CONTEXTS = new Set(["summary", "match-debug"]);

// Classifier failure contexts — the canonical "classifier just stopped
// producing useful output" signal we want to surface separately. Includes
// API errors AND parse errors AND exhausted-retry events.
const CLASSIFIER_ERROR_CONTEXTS = new Set([
  "classify-error",
  "classify-parse-error",
  "classify-exception",
  "batch-classify-error",
  "batch-classify-parse",
]);

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

  const { data: rawErrors, isLoading: errorsLoading } = useQuery({
    queryKey: ["recent-errors"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as MonitorRpcClient).rpc("get_recent_errors", { hours_back: 24 });
      if (error) throw error;
      return (data || []) as RecentError[];
    },
  });
  const { data: queueHealth, isLoading: queueLoading } = useQuery({
    queryKey: ["classification-queue-health"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as MonitorRpcClient).rpc("get_classification_queue_health");
      if (error) throw error;
      return (data || [])[0] as QueueHealth | undefined;
    },
  });
  const { data: criticalAlerts } = useQuery({
    queryKey: ["critical-alerts"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as unknown as MonitorRpcClient).rpc("get_critical_alerts", { hours_back: 24 });
      if (error) throw error;
      return (data || []) as CriticalAlert[];
    },
  });
  const { data: failedPostsRows, isLoading: failedLoading } = useQuery({
    queryKey: ["failed-classifications-14d"],
    refetchInterval: 60_000,
    staleTime: 60_000,
    queryFn: async () => {
      const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from("scraped_posts")
        .select("last_classification_error, posted_at, models(slug)")
        .eq("classification_status", "failed")
        .gte("posted_at", sinceIso)
        .order("posted_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as FailedPostRow[];
    },
  });
  const failedSummary: { total: number; byError: FailedPostsByError[] } = (() => {
    const rows = failedPostsRows ?? [];
    const buckets = new Map<string, { count: number; models: Set<string>; oldestFailedAt: string | null }>();
    for (const row of rows) {
      const key = (row.last_classification_error ?? "(no error string)").slice(0, 120);
      const bucket = buckets.get(key) ?? { count: 0, models: new Set<string>(), oldestFailedAt: null };
      bucket.count++;
      const modelSlug = Array.isArray(row.models) ? row.models[0]?.slug : row.models?.slug;
      if (modelSlug) bucket.models.add(modelSlug);
      if (!bucket.oldestFailedAt || new Date(row.posted_at) < new Date(bucket.oldestFailedAt)) {
        bucket.oldestFailedAt = row.posted_at;
      }
      buckets.set(key, bucket);
    }
    const byError = Array.from(buckets.entries())
      .map(([error, b]) => ({ error, count: b.count, models: Array.from(b.models).sort(), oldestFailedAt: b.oldestFailedAt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return { total: rows.length, byError };
  })();
  const latestCritical = criticalAlerts?.[0];
  const recentErrors = (rawErrors ?? []).filter(
    (e) => !NON_ERROR_CONTEXTS.has(e.context ?? "") && !(e.context ?? "").endsWith("-retry"),
  );
  const classifierErrorCount = recentErrors
    .filter((e) => CLASSIFIER_ERROR_CONTEXTS.has(e.context ?? ""))
    .reduce((sum, e) => sum + Number(e.error_count), 0);
  const classifierStatus =
    classifierErrorCount === 0 ? "ok" :
    classifierErrorCount > 50 ? "breach" :
    classifierErrorCount > 10 ? "watch" : "ok";

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
  const queuedFromRuns = scraperRuns.reduce((sum, run) => sum + Number(run.metadata?.classification_queued ?? 0), 0);
  const deferredFromRuns = scraperRuns.reduce((sum, run) => sum + Number(run.metadata?.classifier_quota_deferred ?? 0), 0);
  const latestApifyBudget = scraperRuns
    .map((run) => run.metadata?.apify_budget as Record<string, unknown> | undefined)
    .find(Boolean);
  const apifyMonthlyUsage = latestApifyBudget?.monthly_usage_usd;
  const apifyMonthlyLimit = latestApifyBudget?.monthly_limit_usd;
  const pipelineCards = [
    {
      label: "Queue",
      value: queueLoading ? "—" : `${queueHealth?.queued ?? 0} queued`,
      detail: queueHealth?.oldest_queued_at ? `oldest ${formatTimeAgo(queueHealth.oldest_queued_at)}` : "no backlog",
    },
    {
      label: "Deferred",
      value: isLoading ? "—" : deferredFromRuns.toLocaleString(),
      detail: "recent run metadata",
    },
    {
      label: "Queued from runs",
      value: isLoading ? "—" : queuedFromRuns.toLocaleString(),
      detail: "preserved candidates",
    },
    {
      label: "Apify budget",
      value: typeof apifyMonthlyUsage === "number" && typeof apifyMonthlyLimit === "number"
        ? `$${apifyMonthlyUsage.toFixed(2)} / $${apifyMonthlyLimit.toFixed(0)}`
        : "—",
      detail: "$24 internal monthly cap",
    },
  ];

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main className="container py-12">
          <h1 className="mb-2 text-page text-foreground">Scraper Monitor</h1>
          <p className="mb-8 font-mono text-sm text-muted-foreground">
            Window runs and scraper-level summaries. Refreshes every 30s.
          </p>

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {summaryCards.map((card) => (
              <div key={card.label} className="glass rounded-lg p-4">
                <p className="font-mono text-xs text-muted-foreground">{card.label}</p>
                <p className="text-section text-foreground">{card.value}</p>
              </div>
            ))}
          </div>

          {latestCritical && (
            <div
              className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive"
              role="alert"
            >
              <p className="font-semibold uppercase tracking-wide">Pipeline alert · {latestCritical.function_name}</p>
              <p className="mt-1 whitespace-pre-wrap">{latestCritical.error_message}</p>
              <p className="mt-2 text-[11px] opacity-80">
                {formatTimeAgo(latestCritical.created_at)}
                {criticalAlerts && criticalAlerts.length > 1 ? ` · ${criticalAlerts.length} critical alerts in last 24h` : null}
              </p>
            </div>
          )}

          <div
            className={`mb-8 rounded-lg border px-4 py-3 font-mono text-xs ${
              classifierStatus === "breach"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : classifierStatus === "watch"
                ? "border-yellow-400/30 bg-yellow-400/10 text-yellow-400"
                : "border-border bg-secondary/30 text-muted-foreground"
            }`}
            role="status"
          >
            Classifier health (24h):{" "}
            <span className="font-semibold">{errorsLoading ? "—" : classifierErrorCount}</span>{" "}
            API/parse failures across all scrapers.
            {classifierStatus === "breach" && " — investigate Gemini quota or model rotation."}
            {classifierStatus === "watch" && " — elevated error rate, monitor."}
            {classifierStatus === "ok" && classifierErrorCount === 0 && " — clean."}
          </div>

          <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {pipelineCards.map((card) => (
              <div key={card.label} className="glass rounded-lg p-4">
                <p className="font-mono text-xs text-muted-foreground">{card.label}</p>
                <p className="text-lg font-bold text-foreground">{card.value}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">{card.detail}</p>
              </div>
            ))}
          </div>

          <h2 className="mb-3 text-lg font-semibold text-foreground">Abandoned classifications (14d)</h2>
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            Posts in <code className="rounded bg-secondary/40 px-1">classification_status = 'failed'</code> that the drain ignores.
            Recover transient failures via <code className="rounded bg-secondary/40 px-1">reclassify-posts?mode=reset_failed&error_pattern=transient</code>.
          </p>
          <div className="glass mb-8 overflow-x-auto rounded-xl">
            <table className="min-w-[840px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Last error</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Count</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Models affected</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Oldest post</th>
                </tr>
              </thead>
              <tbody>
                {failedLoading ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : failedSummary.total === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">No abandoned classifications in the last 14 days.</td></tr>
                ) : (
                  <>
                    <tr className="border-b border-border/50 bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">Total (top 5 below)</td>
                      <td className="px-4 py-3 text-right font-mono text-foreground">{failedSummary.total}</td>
                      <td className="px-4 py-3" colSpan={2}></td>
                    </tr>
                    {failedSummary.byError.map((row) => (
                      <tr key={row.error} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs text-foreground break-all max-w-[440px]">{row.error}</td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">{row.count}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{row.models.join(", ") || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {row.oldestFailedAt ? formatTimeAgo(row.oldestFailedAt) : "—"}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
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

          <h2 className="mb-3 text-lg font-semibold text-foreground">Recent Pipeline Errors</h2>
          <p className="mb-3 font-mono text-xs text-muted-foreground">
            Aggregated <code>error_log</code> entries from the last 24h. Excludes completion summaries, debug breadcrumbs, and retry-attempt notices.
          </p>
          <div className="glass mb-8 overflow-x-auto rounded-xl">
            <table className="min-w-[900px] w-full text-sm">
              <thead>
                <tr className="border-b border-border font-mono text-xs text-muted-foreground">
                  <th className="px-4 py-3 text-left whitespace-nowrap">Function</th>
                  <th className="px-4 py-3 text-left whitespace-nowrap">Context</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Count</th>
                  <th className="px-4 py-3 text-right whitespace-nowrap">Last seen</th>
                  <th className="px-4 py-3 text-left">Sample message</th>
                </tr>
              </thead>
              <tbody>
                {errorsLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : recentErrors.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">No errors in the last 24h.</td></tr>
                ) : (
                  recentErrors.map((e) => {
                    const isClassifierFailure = CLASSIFIER_ERROR_CONTEXTS.has(e.context ?? "");
                    return (
                      <tr key={`${e.function_name}-${e.context}`} className="border-b border-border/50 hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-foreground">{e.function_name}</td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <span
                            className={`inline-block rounded-full border px-2 py-0.5 ${
                              isClassifierFailure
                                ? "text-destructive bg-destructive/10 border-destructive/20"
                                : "text-muted-foreground bg-secondary/40 border-border"
                            }`}
                          >
                            {e.context ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-foreground">{e.error_count}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                          {formatTimeAgo(e.last_seen)}
                        </td>
                        <td className="max-w-[420px] truncate px-4 py-3 text-xs text-muted-foreground" title={e.sample_message ?? ""}>
                          {e.sample_message ?? "—"}
                        </td>
                      </tr>
                    );
                  })
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
