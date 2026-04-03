import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import { formatTimeAgo } from "@/lib/vibes";
import useHead from "@/hooks/useHead";
import type { Tables } from "@/integrations/supabase/types";

type ScraperRun = Tables<"scraper_runs">;

interface UnifiedRun {
  id: string;
  source: string;
  status: string;
  posts_found: number;
  posts_classified: number;
  errors: string[];
  started_at: string;
  via: "orchestrator" | "individual";
}

function parseCompletedMessage(msg: string): { found: number; classified: number; errors: number } {
  const fetched = msg.match(/(?:fetched|posts)=(\d+)/);
  const classified = msg.match(/(?:classified|inserted)=(\d+)/);
  // Use the second match for "inserted" if both "classified" and "inserted" exist
  const inserted = msg.match(/inserted=(\d+)/);
  const errors = msg.match(/errors=(\d+)/);
  return {
    found: fetched ? parseInt(fetched[1]) : 0,
    classified: inserted ? parseInt(inserted[1]) : (classified ? parseInt(classified[1]) : 0),
    errors: errors ? parseInt(errors[1]) : 0,
  };
}

function statusBadge(status: string) {
  if (status === "success") return "text-primary bg-primary/10 border-primary/20";
  if (status === "partial") return "text-yellow-400 bg-yellow-400/10 border-yellow-400/20";
  return "text-destructive bg-destructive/10 border-destructive/20";
}

const ScraperMonitor = () => {
  useHead({
    title: "Scraper Monitor — LLM Vibes",
    description: "Monitor scraper run status and health for LLM Vibes data collection.",
    url: "/admin/scrapers",
  });

  // Query scraper_runs (from run-scrapers orchestrator)
  const { data: orchestratorRuns, isLoading: loadingRuns } = useQuery({
    queryKey: ["scraper-runs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scraper_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as ScraperRun[];
    },
  });

  // Query error_log for individual scraper completions
  const { data: logRuns, isLoading: loadingLogs } = useQuery({
    queryKey: ["scraper-logs"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("error_log")
        .select("id, function_name, error_message, created_at")
        .eq("context", "summary")
        .like("error_message", "Completed%")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
  });

  const isLoading = loadingRuns || loadingLogs;

  // Convert orchestrator runs to unified format
  const unified: UnifiedRun[] = [];

  (orchestratorRuns || []).forEach((r) => {
    unified.push({
      id: r.id,
      source: r.source,
      status: r.status,
      posts_found: r.posts_found ?? 0,
      posts_classified: r.posts_classified ?? 0,
      errors: r.errors ?? [],
      started_at: r.started_at,
      via: "orchestrator",
    });
  });

  // Convert error_log entries to unified format
  (logRuns || []).forEach((log) => {
    const parsed = parseCompletedMessage(log.error_message);
    unified.push({
      id: log.id,
      source: log.function_name,
      status: parsed.errors > 0 ? "partial" : "success",
      posts_found: parsed.found,
      posts_classified: parsed.classified,
      errors: [],
      started_at: log.created_at,
      via: "individual",
    });
  });

  // Sort all by started_at descending
  unified.sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());

  // Latest per source (most recent from either data source)
  const latestBySource = new Map<string, UnifiedRun>();
  unified.forEach((r) => {
    if (!latestBySource.has(r.source)) latestBySource.set(r.source, r);
  });

  const allRuns = unified;
  const successCount = allRuns.filter((r) => r.status === "success").length;
  const partialCount = allRuns.filter((r) => r.status === "partial").length;
  const failedCount = allRuns.filter((r) => r.status === "failed").length;

  return (
    <PageTransition>
    <div className="min-h-screen bg-background">
      <NavBar />
      <main className="container py-12">
        <h1 className="text-2xl font-bold text-foreground mb-2">Scraper Monitor</h1>
        <p className="text-sm text-muted-foreground font-mono mb-8">
          Latest runs from automated scrapers. Refreshes every 30s.
        </p>

        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Total runs", value: isLoading ? "—" : allRuns.length },
              { label: "Succeeded", value: isLoading ? "—" : successCount },
              { label: "Partial", value: isLoading ? "—" : partialCount },
              { label: "Failed", value: isLoading ? "—" : failedCount },
            ].map((s) => (
              <div key={s.label} className="glass rounded-lg p-4">
                <p className="text-xs text-muted-foreground font-mono">{s.label}</p>
                <p className="text-xl font-bold text-foreground">{s.value}</p>
              </div>
            ))}
          </div>

          {/* Latest per source */}
          <h2 className="text-lg font-semibold text-foreground mb-3">Latest by Source</h2>
          <div className="glass rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-mono text-xs">
                  <th className="text-left px-4 py-3 whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Status</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Found</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Classified</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">When</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : (
                  Array.from(latestBySource.values()).map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-foreground">{r.source}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-mono border ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.posts_found}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.posts_classified}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono text-xs">
                        {r.started_at ? formatTimeAgo(r.started_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Full run history */}
          <h2 className="text-lg font-semibold text-foreground mb-3">Run History</h2>
          <div className="glass rounded-xl overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground font-mono text-xs">
                  <th className="text-left px-4 py-3 whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Status</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Found</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Classified</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Errors</th>
                  <th className="text-right px-4 py-3 whitespace-nowrap">Started</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Loading...</td></tr>
                ) : allRuns.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">No runs yet.</td></tr>
                ) : (
                  allRuns.map((r) => (
                    <tr key={r.id} className="border-b border-border/50 hover:bg-secondary/20">
                      <td className="px-4 py-3 font-mono text-foreground">{r.source}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-mono border ${statusBadge(r.status)}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.posts_found}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{r.posts_classified}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs max-w-[200px] truncate">
                        {r.errors.length > 0 ? r.errors.join("; ").slice(0, 100) : "—"}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground font-mono text-xs">
                        {r.started_at ? formatTimeAgo(r.started_at) : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      </main>
      <Footer />
    </div>
    </PageTransition>
  );
};

export default ScraperMonitor;
