# LLM Moods (LLM Vibes)

@AGENTS.md

## Project Overview

Real-time AI sentiment dashboard tracking community vibes for 4 LLM models (Claude, ChatGPT, Gemini, Grok) across 5 social platforms. Scores models 0-100 daily based on scraped post sentiment.

**Live at:** llmvibes.ai (Lovable-hosted)

## Lovable Project

This is a Lovable-generated app synced bi-directionally with GitHub on `main`. The Supabase instance is created and managed entirely through Lovable — there is no independent Supabase account. When editing locally:
- **Push without being asked**: after a change builds (`npm run build`), commit AND push to `main` — Lovable only syncs from `main`, so unpushed work is invisible to David. Tell him it's pushed and whether an edge-function redeploy prompt is needed.
- Push to `main` → Lovable auto-syncs frontend (other branches don't sync)
- **Edge Function deploys require a Lovable-side trigger** — pushing to `main` syncs the code but may not redeploy edge functions automatically. Give the user a Lovable chat prompt to trigger redeployment.
- Never suggest `supabase` CLI commands or Supabase dashboard steps — the user has no direct Supabase access
- Avoid restructuring directories or renaming files that Lovable manages
- Don't edit auto-generated files: `src/integrations/supabase/types.ts`, Lovable OAuth bridge files
- `lovable-tagger` dev dependency is required for Lovable's visual editor — don't remove
- Never enter API keys directly in Lovable — use Supabase Edge Function secrets or Lovable Cloud secrets

### Edge function auth gates: keep them

Edge functions that hit paid APIs (Anthropic, Apify, Gemini, etc.) MUST keep their `isInternalServiceRequest` gate. The repo and the anon key are public, so an ungated function is a public quota-burner. This came up in Phase 10B when Lovable's curl tool removed the gate from `reclassify-posts` to invoke it (the tool sends user JWT, not service-role) — Phase 11B re-added the gate after a $0.01-per-call attack vector was identified.

If a one-shot reclassify or backfill is needed, the supported invocation path is a **temporary helper edge function**, not raw SQL:

1. Create an ephemeral edge function (slug must NOT start with underscore) that reads `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env` and forwards a Bearer-authenticated POST to the gated function (e.g. `reclassify-posts?mode=multi_model`).
2. Invoke the helper via Lovable's `curl_edge_functions` (which sends user JWT, but the helper itself uses the service-role key for the downstream call).
3. Delete the helper from the deployed function list after the run completes.

**Why not raw SQL:** `current_setting('app.settings.service_role_key', true)` returns NULL in this Supabase environment, and Vault is empty. Pg_cron jobs invoke their target endpoints (`run-scrapers`, `aggregate-vibes`, `cleanup-old-posts`) with the anon key plus an explicit `{scheduler:"pg_cron", pipeline:"<source>"}` body that each function's `isSchedulerRequest` gate accepts — those three were hardened from ungated to this scheduler-body gate in PR #38 (2026-05-24). The service-role key lives only in the edge-function runtime — verified Phase 12.

Do NOT remove the application-layer gate from these functions to work around invocation friction.

Functions that should stay gated: `reclassify-posts`, anything else that calls Anthropic/Gemini/Apify or performs unbounded writes.

Functions gated against bare anon (as of PR #38, 2026-05-24): `aggregate-vibes`, `cleanup-old-posts`, and `run-scrapers` accept a service-role JWT **or** the pg_cron scheduler body `{scheduler:"pg_cron", pipeline:"<source>"}` (via `isSchedulerRequest` in `_shared/runtime.ts`); `reaggregate-vibes` requires service-role. A bare anon call with no scheduler body returns 403. The scheduler-body path is what lets the public-repo migration schedule these crons without leaking service-role — see the cron bodies in `20260523120000_public_rpc_security_hardening.sql`. Their operations are still bounded and idempotent, so an attacker who forged the body couldn't escalate beyond the public RPCs anyway.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 18.3 + TypeScript 5.8 |
| Build | Vite 5.4 (SWC plugin) |
| Routing | React Router 6.30 (lazy-loaded pages) |
| UI | shadcn/ui (Radix + Tailwind 3.4) |
| Charts | Recharts 2.15 |
| State | TanStack React Query 5.83 |
| Animations | Framer Motion 12.35 |
| Backend | Supabase (PostgreSQL + Edge Functions) |
| Edge Functions | 15 Deno functions (5 active scrapers + utilities) |
| Sentiment AI | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) via Anthropic Messages API (batch classification). Provider is pluggable via `CLASSIFIER_MODEL`; free-tier Gemini kept as fallback |

## Key Routes

- `/` — Landing page (hero + model preview grid)
- `/dashboard` — All models with scores, trends, sparklines, chatter feed
- `/model/:slug` — Model detail (history chart, complaint/source breakdown, posts, vendor events overlay, recent-incident card, official status card with anomaly correlation, surface-tagged recent posts)
- `/research` — Research index (long-form articles index)
- `/research/:slug` — Research article (live embedded charts via `chart-model` markdown sentinel; first article ships with CSV download + Dataset JSON-LD)
- `/privacy` — Privacy & data practices + content-removal channel (GitHub issues / LinkedIn; no email on public surfaces)
- `/admin/scrapers` — Scraper run monitor + score anomalies panel. **Dev-only** (gated on `import.meta.env.DEV`; production bundles physically exclude the chunk).
- `/og/:slug` — Dev-only OG card preview at fixed 1200×630 for capturing per-article share images.

## Database Schema

| Table | Purpose |
|-------|---------|
| `models` | Tracked LLM models (slug, name, accent_color) |
| `scraped_posts` | Raw posts with sentiment + complaint classification + translation |
| `vibes_scores` | Aggregated daily/hourly scores (0-100) |
| `model_keywords` | Keyword → model matching for scrapers |
| `scraper_config` | Runtime scraper settings (subreddits, etc.) |
| `scraper_runs` | Audit log per scraper execution |
| `error_log` | Debug error tracking |

**RPC Functions:** `get_landing_vibes()`, `get_sparkline_scores()`, `get_complaint_breakdown()`, `get_source_breakdown()`, `get_trending_complaints()`

## Cron architecture (May 2026)

The pipeline runs as independent pg_cron rows, each within its own 400 s edge-function budget. No orchestrator. Migration: `20260508183000_decompose_pipeline_to_independent_crons.sql`.

| Cron | Schedule (UTC) | PT | Function |
|---|---|---|---|
| `scrape-reddit-apify-3x` | `0 4,12,21 * * *` | 21/05/14 | `scrape-reddit-apify` |
| `scrape-hackernews-3x` | `2 4,12,21 * * *` | +2 min | `scrape-hackernews` |
| `scrape-bluesky-3x` | `4 4,12,21 * * *` | +4 min | `scrape-bluesky` |
| `scrape-twitter-3x` | `6 4,12,21 * * *` | +6 min | `scrape-twitter` |
| `scrape-mastodon-3x` | `8 4,12,21 * * *` | +8 min | `scrape-mastodon` |
| `drain-classification-queue-2min` | `*/2 * * * *` | every 2 min | `drain-classification-queue` (body: `limit=200`, `batch_size=20` → 10 classifier calls/pass) |
| `aggregate-vibes-q30` | `20,50 * * * *` | every 30 min, offset | `aggregate-vibes` (refreshes last 7 days; `queued_posts` heals as drain catches up, `failed_posts` only via `reclassify-posts?mode=reset_failed`) |
| `pipeline-watchdog-1h` | `17 * * * *` | hourly at :17 | `pipeline-watchdog` |
| `cleanup-stuck-scraper-runs` | `*/30 * * * *` | every 30 min | (SQL only — marks runs >30 min as failed) |
| `cleanup-old-posts-weekly` | `0 8 * * 0` | Sun 01:00 PT | `cleanup-old-posts` |

`run-pipeline` and `run-scrapers` are kept in code as manual debug tools but are not scheduled (the merged pipeline blew the 400s edge-function budget — see commit history for the May 8 rebuild and decomposition).

Scraper auth gates accept three callers: service-role JWT, `RUN_PIPELINE_TRIGGER_SECRET` header, or anon JWT with body `{scheduler:"pg_cron", pipeline:"scrape-..."}`. The third path lets pg_cron invoke each scraper directly without leaking service-role into a public-repo migration.

**Drain throughput (June 1 update — classifier on Claude).** Production classifier is Claude Haiku 4.5 via the Anthropic Messages API (`CLASSIFIER_MODEL=claude-haiku-4-5-20251001`, `ANTHROPIC_API_KEY`). Anthropic Tier 1 limits dwarf our ~30 calls/day, so the Anthropic path has no Supabase quota gate. Drain cadence is 2 min, `limit=200`, `batch_size=20` (~6,000 posts/hr capacity vs ~500-650/day actual ingest — single-scraper-run dumps clear in one pass; current-day score is accurate within ~5 min of the last scraper). `batch_size` was halved from 40 to 20 on May 15 (`20260515160000_drain_batch_size_20.sql`) to cap batch JSON output size. (History: through May the classifier ran on Gemini 2.5 Flash paid Tier 1 with `GEMINI_DAILY_REQUEST_LIMIT`/`GEMINI_MINUTE_REQUEST_LIMIT` raised to 5000/300; those secrets now pace only the free-tier Gemini fallback.) `partial_coverage` is no longer the structural default — `score-refresh.ts` treats `queuedPosts > 5 || classification_coverage < 0.85` as the partial threshold, and `aggregate-vibes` refreshes the last 7 days so those flags heal once the queue catches up. Live cron diverges from migration history per the established pattern; check `cron.job` for actual state.

**Failed-vs-queued split (May 15 update).** `vibes_scores.queued_posts` now counts only `pending + retry` (work the drain will attempt); `vibes_scores.failed_posts` is the dead-letter count (max attempts exhausted, drain ignores). `classification_coverage = classified / (classified + pending + retry)` so the ratio heals when failed posts are recovered. Recover transient failures with `reclassify-posts?mode=reset_failed&error_pattern=transient` (skips deterministic `parse_error`/`missing_*` patterns); confirm with `dry_run=1` first. UI surfaces `failed_posts` as an asymmetric "X abandoned" chip on `/model/:slug` and a top-5-error breakdown panel on `/admin/scrapers`. Pipeline watchdog alerts when posts hit failed status faster than 20/24h.

**Watchdog.** `pipeline-watchdog-1h` writes `severity='critical'` rows into `error_log` on scraper-stale (>12h since last success), drain backlog (>500 queued or oldest queued >60 min), aggregate-vibes lag (>90 min), or classification failures piling up (>50). Surfaced via `get_critical_alerts(hours_back)` RPC into the `/admin/scrapers` banner and a calm `StalenessBanner` on the public dashboard when the newest `score_computed_at` is >3h old. `error_log` gained a `severity` column ('info' | 'warning' | 'critical', default 'info') in migration `20260510120100_pipeline_watchdog.sql`.

## Known reliability issues

- **`scrape-reddit-apify` fails ~57%** of recent windows. The `trudax~reddit-scraper-lite` Apify actor times out or returns 0 items intermittently. Investigate before relying on Reddit-only signals.

## Audit log

Historical audit records and one-time investigations live in `OPERATIONS-HISTORY.md`
(most recent: 2026-05-16 methodology/scoring/scraper audit). Open follow-up from that
audit: `scraper_runs` + `error_log` return `[]` HTTP 200 to anon (RLS denial assumed,
not yet investigated).

## Scrapers (Edge Functions)

Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (public API, 5 instances). Lemmy was dropped in Phase 12 (yielded 0.4 posts/run for 18 wasted Gemini calls; mostly Reddit cross-posts). Each scraper runs on its own pg_cron row at the three Pacific-time windows (05:00, 14:00, 21:00 PT), staggered by minute — see "Cron architecture" above. Scrapers insert posts as `classification_status='pending'`; classification is drained by the separate `drain-classification-queue` cron, and `aggregate-vibes` runs independently to refresh scores.

Shared utilities (keyword matching, dedup, error logging) are in `_shared/utils.ts` — scrapers import from there instead of duplicating code.

Sentiment is classified by **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via the Anthropic Messages API (forced-JSON via tool use; `temperature` is omitted — current Claude models reject it). `_shared/classifier.ts` routes by model-id prefix: `claude-*` → Anthropic native path, everything else → Gemini's OpenAI-compatible endpoint. The active model is `CLASSIFIER_MODEL` (falls back to legacy `GEMINI_CLASSIFIER_MODEL`, then `gemini-2.5-flash`); `getClassifierApiKey()` picks `ANTHROPIC_API_KEY` vs `GEMINI_API_KEY` to match — so a model swap is a pure config flip and **rollback = set `CLASSIFIER_MODEL=gemini-2.5-flash` (no redeploy; both providers stay live)**. Single-model posts use `classifyBatch()`; multi-model posts use `classifyBatchTargeted()` for per-model sentiment (e.g., "DeepSeek fixed Gemini's mess" → negative Gemini, positive DeepSeek). Retry: 3 attempts, exponential backoff; Anthropic 429/529 are treated transient. The Anthropic path runs batches with bounded concurrency (`ANTHROPIC_BATCH_CONCURRENCY`, default 4) and no inter-batch sleep, and the drain writes rows back concurrently; the Gemini path stays serial with a 2s inter-batch delay and its quota early-break (commit 091310c). Strict tool use (`strict:true`) is intentionally NOT enabled — our nullable-union / null-in-enum schema 400s under the structured-output JSON-Schema subset (verified in prod 2026-06-02); forced `tool_choice` carries the JSON shape. Re-enabling needs an `anyOf`-based nullable rewrite plus live-API testing. Non-English posts are translated by the classifier prompt; original in `content`, translation in `translated_content`, language code in `original_language`. Prompt caching applies on Sonnet/Opus (≥1024-token cacheable prefix) but not Haiku (4096-token minimum) — fine, Haiku is cheap (~$8/mo modeled vs ~$22/mo Sonnet). Known limitation: the classifier (Claude) is itself a tracked model, so pro-Claude self-bias is the measurement risk; cross-checked via the Gemini second grader in `check-gemini-self-bias` (run around classifier changes, not always-on). On transient Claude errors `classification-state.ts` spills failed items over to Gemini using `GEMINI_API_KEY`. **There is no separate `GEMINI_FREE_API_KEY`** — the spillover and the `check-gemini-self-bias` oracle both use the paid `GEMINI_API_KEY` (owner accepts the small cost; Gemini is cheap). The spillover is bounded by its own quota bucket (`GEMINI_FREE_MINUTE_REQUEST_LIMIT`/`GEMINI_FREE_DAILY_REQUEST_LIMIT`, default 8/min, 200/day — raise via Lovable env if a prolonged Claude incident needs more headroom). Both depend on billing being active on the `GEMINI_API_KEY` Google project. Claude-path classification verified live 2026-06-01 (131 posts, 0 errors).

`reclassify-posts` edge function supports `?mode=multi_model` to find and fix historical multi-model posts with identical sentiment. Run `reaggregate-vibes` after to recalculate scores.

**Reddit scraper** uses `trudax~reddit-scraper-lite` Apify actor. Fetches from 5 subreddits (ClaudeAI, ChatGPT, LocalLLaMA, GoogleGemini, artificial), maxItems 40.

**Twitter/X scraper** uses `apidojo~tweet-scraper` Apify actor with `searchTerms` array input (4 terms, maxItems 50). Has a dormant Grok/xAI fallback path (requires `XAI_API_KEY`). Apify budget: $29/month, used for Reddit and Twitter.

**Tracked models:** Claude, ChatGPT, Gemini, Grok (DeepSeek and Perplexity were removed 2026-03-21).

## Frontend patterns added in 2026

- **Vendor events overlay on charts:** `src/data/vendor-events.ts` exports `VENDOR_EVENTS[]` (typed-TS, frontend-only). `VibesChart` accepts an optional `events` prop and renders Recharts `<ReferenceArea>` / `<ReferenceLine>` for each one. Used to mark Anthropic / OpenAI / Google / xAI bug windows, model launches, and postmortems.
- **Per-model product surface tagging:** `src/lib/product-surface.ts` carries a per-model regex map (e.g. Claude → Claude Code / Claude.ai / API / SDK). Display-only — applied client-side to recent posts; no schema change.
- **Anomaly detection:** `src/hooks/useScoreAnomalies.ts` runs a 14-day rolling z-score in the browser over `vibes_scores`. Surfaced in the dev-only `/admin/scrapers` Anomalies panel and cross-referenced against Official Status events on `/model/:slug` via `src/lib/status-correlation.ts`.
- **Official Status integration:** `supabase/functions/fetch-vendor-status` parses Anthropic + OpenAI Atom feeds and Google Cloud incidents.json, returns the last 30 days. `useVendorStatus()` + `<StatusCard />` render the result in the left column under the chart for all four model pages. xAI shows a "no public status feed" empty state.
- **Research articles:** `src/data/research-posts.ts` carries typed-TS `ResearchPost` entries with markdown bodies. The body's ```chart-model``` fenced code block is intercepted by `src/components/research/EmbeddedModelChart.tsx` and replaced with a live model chart. Article + Dataset JSON-LD emitted via the extended `useHead.jsonLd` field. `src/components/research/AuthorBio.tsx` is the single source of truth for David's bio + contact links — its `BIO_LINKS` array drives every article's footer; update there, not per-article. `src/components/research/PullQuote.tsx` styles verbatim social-post citations (handle / platform / timestamp meta + optional `archivedHref` for Wayback backups); use in place of `<blockquote>` when the quote is load-bearing evidence. **The research surface is a deliberate editorial register, not dashboard chrome:** `src/lib/prose-styles.ts` keeps accent inline links / code, an accent blockquote left-rule, and 17px paragraphs by design (a Tailwind-Typography scale, not drift). The four research components (`PullQuote`, `StatCallout`, `AuthorBio`, `EmbeddedModelChart`) use the global type ladder for their chrome labels (`text-mono-cap` / `text-meta`, standardized in Round 3 PR #36) but keep that editorial accent on links / quote marks / citation links — don't neutralize it to match the calmer dashboard, which would flatten the articles (the portfolio surface).
- **Per-route static OG HTML (prerender):** `scripts/prerender-routes.ts` is a Vite plugin (`closeBundle`) that writes a transformed copy of `dist/index.html` for every public route (articles, model pages, dashboard, research index, privacy) in both `<route>/index.html` and `<route>.html` forms, so LinkedIn/Slack crawlers (no JS) see per-route title/OG/canonical/JSON-LD. **Lovable's host serves these only at the literal `.html` paths** (extensionless and trailing-slash URLs always get the SPA shell — verified in prod 2026-06-12), so social shares must use the `.html` form (e.g. `llmvibes.ai/research/<slug>.html`); an inline head shim rewrites the path back to the clean route via `history.replaceState` before React boots. Contracts: the prerendered JSON-LD script must keep `id="page-json-ld"` (that's how `useHead.setJsonLd` updates instead of duplicating on hydration); head substitution is fail-loud — editing `index.html`'s head tags incompatibly fails the build by design; article metadata comes from `RESEARCH_POSTS` (keep `src/data/research-posts.ts` JSX-free) and author constants from `src/data/author.ts` (not the AuthorBio component). New public routes must be added to the plugin's route table AND `public/sitemap.xml`.
- **OG image generator:** `src/pages/OgPreview.tsx` (dev-only `/og/:slug`) renders a 1200×630 card; we capture screenshots into `public/research/<slug>/og.png` and reference via `ResearchPost.ogImage`. Colors are pinned in a top-of-file `OG_THEME` constant — intentionally decoupled from runtime CSS vars (capture path is fragile across viewport changes); update by hand and re-capture if the runtime palette shifts.
- **Shared design primitives — use them, don't re-inline.** (PR-round provenance: `OPERATIONS-HISTORY.md`.)
  - `Surface.tsx`: canonical card wrapper around `glass` (sizes `default | compact | bare`; `motion="fade"` opts into `animate-fade-in`; calm `hover:border-border/80` baked in). One tone only.
  - Two pills: `FilterChip.tsx` (interactive, one shape `rounded-md px-3 py-1.5 font-mono text-xs`, quiet neutral pressed fill `bg-foreground/10` — never a primary tint) and `Tag.tsx` (display-only metadata pill: `shape` square|pill, `tone` neutral|destructive|warning with neutral/foreground text, always `text-mono-cap`). Tag replaced every shadcn `<Badge>` and hand-rolled pill.
  - `ModelCard.tsx` (`showSparkline`) and `ChatterPost.tsx` (`extraMeta`, `hideModel`) are the single sources for the model card and chatter row — don't re-inline. `SectionHeader.tsx` (sentence-case titles) / `PageHeader.tsx` standardize H2/H1. `BarList.tsx` is the canonical labeled-progress list (`{label, value, secondary?}`, optional `max`/`accent`/`ramp`; pass `max={100}` for percentages). Don't reintroduce `ScoreMetaBadge` / `DataFreshnessIndicator` (status/freshness fold into the mono-cap meta line as text-tertiary suffixes).
  - **Type ladder** is 8 rungs (`hero / score-xl / score / page / section / body / meta / mono-cap`, defined in `src/index.css`) — pick a rung, never hand-rolled `text-[Npx]` / `text-lg` / `text-xs uppercase tracking-wide`.
  - **Sentiment colors** derive only from `SENTIMENT_HSL` in `src/lib/vibes.ts` — no hex literals or palette classes (`#EF4444`, `text-red-200`).
  - **Accent (primary) hue** is reserved for: chart stroke, hero "bad day" glow, NavBar wordmark/wave/active-link, and the TrendingComplaints %-change number. Severity (StatusCard) and staleness (StalenessBanner) read through `--destructive` / `--warning` *tints* with neutral text, never colored body text. Research article surface is a deliberate exception (see Research articles).
  - Aesthetic direction is **restraint**: one page-level fade per render, no per-section staggers, single calm border-color hover.
- **Asymmetric data-quality warnings:** sample-size and freshness caveats appear *only* when something is off — silence implies the data is fine. The two patterns: carry-forward days render a dashed hollow dot on charts plus a `Carry-forward — 0 posts scraped` tooltip line (`src/components/VibesChart.tsx`). Days with `vibes_scores.eligible_posts < LIMITED_SAMPLE_THRESHOLD` (=5, in `src/lib/vibes.ts`) render a `Limited sample today` note below the description on `/model/:slug` and a parallel `Limited sample — N high-confidence posts` line in chart tooltips. No equivalent chip on dashboard cards — the existing 7d post count is enough volume signal at scan depth.

**Edge Function deployment:** Pushing to `main` triggers Lovable auto-sync for frontend. Edge Functions require a Lovable-side redeploy — prompt Lovable to sync from GitHub and redeploy the affected functions. Do not use `supabase` CLI (no independent Supabase account exists).

## Environment Variables & Secrets

**Frontend (VITE_ prefix):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — public anon credentials, hardcoded as fallbacks in `src/integrations/supabase/client.ts`. Safe to expose (RLS enforces security).
- `.env` is gitignored; `.env.example` has placeholder structure for local overrides.

**Edge Functions (Supabase secrets — never commit these):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — production sentiment classifier (Claude Haiku 4.5); dedicated `llm-moods-classifier` key
- `CLASSIFIER_MODEL` — active classifier model id (`claude-haiku-4-5-20251001`); the cutover/rollback switch
- `GEMINI_API_KEY` — the **paid spillover / second-opinion grader**, not the primary classifier. Used by `classification-state.ts` spillover and the `check-gemini-self-bias` oracle. There is **no `GEMINI_FREE_API_KEY`** — this paid key is the only Gemini key; billing must stay active on its Google project. Spillover is paced by `GEMINI_FREE_MINUTE_REQUEST_LIMIT`/`GEMINI_FREE_DAILY_REQUEST_LIMIT` (default 8/min, 200/day) to keep cost minimal.
- `LOVABLE_API_KEY` — Lovable AI gateway key (no longer used by scrapers, kept for Lovable platform)
- `APIFY_API_TOKEN` — Apify token (Reddit + Twitter, and any future Apify-based source); `BLUESKY_HANDLE`, `BLUESKY_APP_PASSWORD`
- Actual secret store (verified 2026-06-20) is exactly: `CLASSIFIER_MODEL`, `ANTHROPIC_API_KEY`, `RUN_PIPELINE_TRIGGER_SECRET`, `GEMINI_API_KEY`, `APIFY_API_TOKEN`, `BLUESKY_APP_PASSWORD`, `BLUESKY_HANDLE`, `LOVABLE_API_KEY`. Earlier-documented `MASTODON_URL/TOKEN`, `DISCOURSE_*`, `GITHUB_TOKEN`, `LEMMY_*` are **not** present — Mastodon runs on public endpoints (no token); those integrations are inert.

**Security notes:**
- Repo is **public** on GitHub — never commit service role keys, API tokens, or passwords
- `.gitignore` uses `.env*` glob with `!.env.example` whitelist
- All tables have RLS enabled. As of PR #38 (2026-05-24) there are **no anon read policies** on `models` / `scraped_posts` / `vibes_scores` / `model_keywords` — a direct anon `.from()` SELECT returns `[]`. Public reads go through `SECURITY DEFINER` `get_public_*` RPCs (defined in `20260523120000_public_rpc_security_hardening.sql`); any new public data needs a new such RPC, not a direct table read.
- All edge functions use service role key via `Deno.env.get()`, never hardcoded

## Development

```bash
npm run dev          # Vite dev server (localhost:8080)
npm run build        # Production build
npm run lint         # ESLint
npm run test         # Vitest
```

## Code Patterns

- **Memoization:** `memo()` on model cards and list items
- **Lazy loading:** Routes, Recharts, Sparkline components
- **Prefetching:** Hover on model cards prefetches detail data
- **React Query:** 60s stale time for most queries, 30s for scraper monitor
- **Infinite scroll:** Chatter posts (25/page cursor-based on `posted_at`)
- **Sentiment scale:** 0-40 bad (red), 41-65 mixed (amber), 66-100 good (green) — colors flow through `SENTIMENT_HSL` in `src/lib/vibes.ts`
- **Muted text convention:** `text-foreground` for primary statements / scores / headings, `text-text-secondary` for body, `text-text-tertiary` for meta / captions / labels. Avoid arbitrary `text-foreground/{60..90}` opacities in new code (Tailwind aliases live in `tailwind.config.ts`).
- **Head management:** `useHead` hook (`src/hooks/useHead.ts`) sets per-route title, description, OG tags, and canonical URL by mutating existing `<head>` tags in `index.html`
- **Sitemap:** `public/sitemap.xml` is static — update manually when adding/removing tracked models

## Known Limitations

- TypeScript config is loose (`strictNullChecks: false`, `noImplicitAny: false`)
- `/admin/scrapers` is public — no auth required
- All Edge Functions have `verify_jwt = false`
- Sentiment classification prompt is centralized in `_shared/classifier.ts` (batch + single)
- Minimal test coverage (example test only)
- Error handling in scrapers silently logs to `error_log` table

## Accuracy

- Verify Supabase tables, RPC functions, and edge functions in `supabase/functions/` before referencing them.
- Check the `_shared/` modules before claiming scraper/classifier behavior; many features moved out of per-scraper files.

Hallucination prevention: see `~/.agents/AGENTS.md`.

## Working Here with Claude Code

Focus areas for local edits:
- Bug fixes in frontend components (`src/components/`, `src/pages/`)
- Query logic in `src/hooks/useVibesData.ts`
- Scraper logic in `supabase/functions/`
- Constants/labels in `src/lib/vibes.ts`
- Database migrations in `supabase/migrations/`

Don't modify: `src/integrations/supabase/types.ts` (auto-generated), `src/components/ui/` (shadcn managed)

Always commit after completing work — don't leave a dirty branch on `main` (Lovable syncs from it).
