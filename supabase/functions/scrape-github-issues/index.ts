import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  createRunRecord,
  deriveRunMetrics,
  getConfigBoolean,
  getConfigNumber,
  getConfigValues,
  internalOnlyResponse,
  isInternalServiceRequest,
  isRunPipelineTriggerRequest,
  isSchedulerRequest,
  isUniqueViolation,
  loadScraperConfig,
  readJsonBody,
  type RunRecordRow,
  updateRunRecord,
} from "../_shared/runtime.ts";
import {
  corsHeaders,
  logToErrorLog,
  logZeroDataWarning,
  meetsMinLength,
  upsertPendingScrapedPost,
} from "../_shared/utils.ts";

const SOURCE = "scrape-github-issues";

// Issues on the vendors' own developer tools are pre-filtered complaints from
// paying users, free to read (GitHub REST, 60 req/h unauthenticated, 5,000 with
// GITHUB_TOKEN), and attribute directly: an issue on anthropics/claude-code is
// about Claude. Added 2026-08-22 when Mastodon was unscheduled (83% of its
// posts classified irrelevant) — this source replaces it with higher-signal
// text at zero cost. Override with scraper_config rows key='repo',
// value='owner/name=model_slug'. No xAI equivalent exists.
const DEFAULT_REPOS: Record<string, string> = {
  "anthropics/claude-code": "claude",
  "openai/codex": "chatgpt",
  "google-gemini/gemini-cli": "gemini",
};

// Per-repo per-run cap. claude-code alone opens ~100 issues/day; 25 × 3 runs
// keeps the source supplementary rather than letting one repo dominate a model.
const DEFAULT_MAX_ISSUES_PER_REPO = 25;
const ISSUE_MAX_AGE_MS = 3 * 24 * 3600000;
const BODY_MAX_CHARS = 1600;

interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  created_at: string;
  comments: number;
  pull_request?: unknown;
  user?: { login?: string; type?: string };
  reactions?: { total_count?: number };
  labels?: { name?: string }[];
}

async function fetchWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Issue bodies are markdown templates: strip HTML comments, code fences, image
// embeds and the template's boilerplate headings so the classifier sees the
// complaint, not the form.
function cleanIssueBody(body: string | null): string {
  if (!body) return "";
  return body
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/^\s*(?:\*\*)?(?:Environment|Version|Steps to reproduce|Expected behavior|Actual behavior|Additional context|Platform|Operating system|Terminal|Claude Code version|Model)\s*(?:\*\*)?:?\s*$/gim, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseRepoConfig(values: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const value of values) {
    const [repo, slug] = value.split("=").map((part) => part.trim());
    if (repo && slug) out[repo] = slug;
  }
  return Object.keys(out).length > 0 ? out : DEFAULT_REPOS;
}

export async function handleScrapeGithubIssues(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const body = await readJsonBody(req);
  if (
    !isInternalServiceRequest(req)
    && !isRunPipelineTriggerRequest(req)
    && !await isSchedulerRequest(body, "scrape-github-issues")
  ) {
    return internalOnlyResponse(corsHeaders);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runRecord: RunRecordRow | null = null;

  try {
    const config = await loadScraperConfig(supabase, SOURCE);
    if (!getConfigBoolean(config, "enabled", true)) {
      return new Response(JSON.stringify({ source: SOURCE, status: "skipped", skipped: true, reason: "disabled", errors: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const repos = parseRepoConfig(getConfigValues(config, "repo"));
    const maxPerRepo = getConfigNumber(config, "max_issues_per_repo", DEFAULT_MAX_ISSUES_PER_REPO);

    const { data: startedRun, error: runError } = await createRunRecord(supabase, {
      source: SOURCE,
      run_kind: "scraper",
      status: "running",
      parent_run_id: typeof body.parent_run_id === "string" ? body.parent_run_id : null,
      triggered_by: body.orchestrated ? "orchestrator" : "manual",
      window_label: typeof body.window_label === "string" ? body.window_label : null,
      window_local_date: typeof body.window_local_date === "string" ? body.window_local_date : null,
      timezone: typeof body.timezone === "string" ? body.timezone : null,
      started_at: new Date().toISOString(),
    });

    if (runError) {
      if (isUniqueViolation(runError)) {
        return new Response(JSON.stringify({ source: SOURCE, status: "skipped", skipped: true, reason: "already_running", errors: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw runError;
    }
    runRecord = startedRun;

    await logToErrorLog(supabase, SOURCE, "GitHub issues scraper started", "health-check");

    const { data: models } = await supabase.from("models").select("id, slug, name");
    const modelMap: Record<string, string> = {};
    const modelNames: Record<string, string> = {};
    for (const m of models || []) {
      modelMap[m.slug] = m.id;
      modelNames[m.slug] = m.name || m.slug;
    }

    const { data: existing } = await supabase
      .from("scraped_posts")
      .select("source_url")
      .eq("source", "github")
      .limit(10000);
    const existingUrls = new Set((existing || []).map((entry: { source_url: string | null }) => entry.source_url).filter(Boolean));

    const cutoff = new Date(Date.now() - ISSUE_MAX_AGE_MS);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "llmvibes.ai scraper (+https://llmvibes.ai)",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = Deno.env.get("GITHUB_TOKEN");
    if (token) headers.Authorization = `Bearer ${token}`;

    const summary = {
      source: SOURCE,
      posts_found: 0,
      filtered_candidates: 0,
      classified: 0,
      classification_success: 0,
      net_new_rows: 0,
      duplicate_conflicts: 0,
      irrelevant: 0,
      classifierErrors: 0,
      classifierRequestErrors: 0,
      classifierQuotaDeferred: 0,
      classificationQueued: 0,
      dedupSkipped: 0,
      contentSkipped: 0,
      errors: [] as string[],
    };

    for (const [repo, slug] of Object.entries(repos)) {
      const modelId = modelMap[slug];
      if (!modelId) {
        summary.errors.push(`${repo}: unknown model slug ${slug}`);
        continue;
      }

      let issues: GitHubIssue[] = [];
      try {
        const url = `https://api.github.com/repos/${repo}/issues?state=all&sort=created&direction=desc&per_page=60`;
        const res = await fetchWithTimeout(url, headers);
        if (!res.ok) {
          summary.errors.push(`${repo}: HTTP ${res.status} ${(await res.text()).slice(0, 120)}`);
          continue;
        }
        issues = await res.json();
      } catch (error) {
        summary.errors.push(`${repo}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }

      let ingested = 0;
      for (const issue of issues) {
        if (ingested >= maxPerRepo) break;
        if (issue.pull_request) continue;
        if (issue.user?.type === "Bot") continue;
        summary.posts_found++;

        const createdAt = new Date(issue.created_at);
        if (Number.isNaN(createdAt.getTime()) || createdAt < cutoff) continue;

        const title = (issue.title || "").replace(/^\[(?:bug|feature|feat|question|docs?)[^\]]*\]\s*/i, "").trim();
        const content = cleanIssueBody(issue.body).slice(0, BODY_MAX_CHARS);
        if (!meetsMinLength(title, content)) {
          summary.contentSkipped++;
          continue;
        }

        const sourceUrl = issue.html_url;
        if (existingUrls.has(sourceUrl)) {
          summary.dedupSkipped++;
          continue;
        }
        summary.filtered_candidates++;

        // Same implicit-target convention as App Store reviews: issues rarely
        // name the model, so the suffix tells the classifier what "it" is and
        // gives chatter readers provenance.
        const suffix = ` (GitHub issue on ${repo}, the ${modelNames[slug]} developer tool)`;
        const upsertResult = await upsertPendingScrapedPost(supabase, {
          model_id: modelId,
          source: "github",
          source_url: sourceUrl,
          title: title.slice(0, 120) || null,
          content: `${content || title}${suffix}`,
          content_type: "title_and_body",
          score: (issue.reactions?.total_count ?? 0) + (issue.comments ?? 0),
          posted_at: createdAt.toISOString(),
          author_handle: issue.user?.login ?? null,
        });

        if (upsertResult.error) {
          summary.errors.push(`Insert: ${upsertResult.error}`);
          continue;
        }
        if (upsertResult.inserted) {
          summary.net_new_rows++;
          summary.classificationQueued++;
          existingUrls.add(sourceUrl);
          ingested++;
        } else {
          summary.duplicate_conflicts++;
        }
      }

      await delay(1000);
    }

    const derived = deriveRunMetrics(summary);
    await updateRunRecord(supabase, runRecord!.id, {
      status: derived.status,
      posts_found: derived.posts_found,
      posts_classified: derived.posts_classified,
      filtered_candidates: derived.filtered_candidates,
      net_new_rows: derived.net_new_rows,
      duplicate_conflicts: derived.duplicate_conflicts,
      errors: derived.errors,
      metadata: {
        classification_queued: summary.classificationQueued,
        dedup_skipped: summary.dedupSkipped,
        content_skipped: summary.contentSkipped,
        repos: Object.keys(repos),
      },
      completed_at: new Date().toISOString(),
    });

    await logToErrorLog(
      supabase,
      SOURCE,
      `Completed: fetched=${summary.posts_found} filtered=${summary.filtered_candidates} inserted=${summary.net_new_rows} duplicateConflicts=${summary.duplicate_conflicts}`,
      "summary",
    );
    await logZeroDataWarning(supabase, SOURCE, summary.posts_found);

    return new Response(JSON.stringify({
      ...summary,
      classification_queued: summary.classificationQueued,
      status: derived.status,
      posts_classified: derived.posts_classified,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown";
    await logToErrorLog(supabase, SOURCE, message, "top-level error");
    if (runRecord) {
      await updateRunRecord(supabase, runRecord!.id, {
        status: "failed",
        errors: [message],
        metadata: { error: message },
        completed_at: new Date().toISOString(),
      });
    }
    return new Response(JSON.stringify({ source: SOURCE, status: "failed", error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

if (import.meta.main) {
  Deno.serve(handleScrapeGithubIssues);
}
