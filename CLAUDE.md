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

Edge functions that hit paid APIs (Anthropic, Apify, Gemini, etc.) MUST keep their `isInternalServiceRequest` gate. The repo and the anon key are public, so an ungated function is a public quota-burner. Do NOT remove an application-layer gate to work around invocation friction.

Stay gated: `reclassify-posts` and anything that calls Anthropic/Gemini/Apify or performs unbounded writes. `aggregate-vibes`, `cleanup-old-posts`, `run-scrapers` accept service-role JWT **or** the pg_cron scheduler body `{scheduler:"pg_cron", pipeline:"<source>"}`; `reaggregate-vibes` requires service-role; bare anon gets 403.

One-shot invocations of gated functions go through a temporary helper edge function, never raw SQL — procedure, gate history, and why-not-SQL are in `AGENT-REFERENCE.md`.

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
| Sentiment AI | Claude Haiku 4.5 via Anthropic Messages API; provider pluggable via `CLASSIFIER_MODEL`, Gemini fallback |

## Key Routes

- `/` — Landing page (hero + model preview grid)
- `/dashboard` — All models with scores, trends, sparklines, chatter feed
- `/model/:slug` — Model detail (history chart, complaint/source breakdown, posts, vendor events overlay, recent-incident card, official status card with anomaly correlation, surface-tagged recent posts)
- `/research` — Research index (long-form articles index)
- `/research/:slug` — Research article (live embedded charts via `chart-model` markdown sentinel; first article ships with CSV download + Dataset JSON-LD)
- `/rumors` — Rumors radar: auto-aggregated community chatter about *unreleased* models (version + stage + hedged ETA + rumored benefit + signals), ranked by cross-platform corroboration. DB-driven via `get_public_rumors`; see "Rumors radar" below.
- `/privacy` — Privacy & data practices + content-removal channel (GitHub issues / LinkedIn; no email on public surfaces)
- `/admin/scrapers` — Scraper run monitor + score anomalies panel. **Dev-only** (gated on `import.meta.env.DEV`; production bundles physically exclude the chunk).
- `/og/:slug` — Dev-only OG card preview at fixed 1200×630 for capturing per-article share images.

## Database Schema

| Table | Purpose |
|-------|---------|
| `models` | Tracked LLM models (slug, name, accent_color) |
| `scraped_posts` | Raw posts with sentiment + complaint classification + translation |
| `vibes_scores` | Aggregated daily/hourly scores (0-100) |
| `model_keywords` | Keyword → model matching for scrapers (incl. upcoming-version + codename rows for the rumors radar) |
| `scraper_config` | Runtime scraper settings (subreddits, etc.) |
| `scraper_runs` | Audit log per scraper execution |
| `error_log` | Debug error tracking |
| `model_rumors` | Rumors-radar accumulator: one row per (model_slug, version_key), corroboration counts + hedged ETA + signals |

`scraped_posts` also carries `rumor_checked_at` / `rumor_data` (rumor-extraction state; see "Rumors radar").

**RPC Functions:** `get_landing_vibes()`, `get_sparkline_scores()`, `get_complaint_breakdown()`, `get_source_breakdown()`, `get_trending_complaints()`, `get_public_rumors()` (public read), `get_rumor_candidates()` (service-role only)

## Cron architecture (May 2026)

The pipeline runs as independent pg_cron rows, each within its own 400 s edge-function budget. No orchestrator. Migration: `20260508183000_decompose_pipeline_to_independent_crons.sql`.

| Cron | Schedule (UTC) | PT | Function |
|---|---|---|---|
| `scrape-reddit-apify-3x` | `0 4,16 * * *` | 21/09 PT | `scrape-reddit-apify` (now **2×/day** — cost; job name unchanged) |
| `scrape-hackernews-3x` | `2 4,12,21 * * *` | +2 min | `scrape-hackernews` |
| `scrape-bluesky-3x` | `4 4,12,21 * * *` | +4 min | `scrape-bluesky` |
| `scrape-twitter-3x` | `6 4,12,21 * * *` | +6 min | `scrape-twitter` |
| `scrape-mastodon-3x` | `8 4,12,21 * * *` | +8 min | `scrape-mastodon` |
| `drain-classification-queue-2min` | `*/2 * * * *` | every 2 min | `drain-classification-queue` (body: `limit=200`, `batch_size=20` → 10 classifier calls/pass) |
| `aggregate-vibes-q30` | `20,50 * * * *` | every 30 min, offset | `aggregate-vibes` (refreshes last 7 days; `queued_posts` heals as drain catches up, `failed_posts` only via `reclassify-posts?mode=reset_failed`) |
| `pipeline-watchdog-1h` | `17 * * * *` | hourly at :17 | `pipeline-watchdog` |
| `cleanup-stuck-scraper-runs` | `*/30 * * * *` | every 30 min | (SQL only — marks runs >30 min as failed) |
| `cleanup-old-posts-weekly` | `0 8 * * 0` | Sun 01:00 PT | `cleanup-old-posts` |
| `aggregate-rumors-2x` | `40 4,16 * * *` | ~21:40/09:40 PT | `aggregate-rumors` (rumors radar; ~40 min after the Reddit windows) |

`run-pipeline` and `run-scrapers` are kept in code as manual debug tools but are not scheduled (the merged pipeline blew the 400s edge-function budget — see commit history for the May 8 rebuild and decomposition).

Scraper auth gates accept three callers: service-role JWT, `RUN_PIPELINE_TRIGGER_SECRET` header, or anon JWT with body `{scheduler:"pg_cron", pipeline:"scrape-..."}`. The third path lets pg_cron invoke each scraper directly without leaking service-role into a public-repo migration.

Drain/queue mechanics, failed-vs-queued semantics, and watchdog thresholds: `AGENT-REFERENCE.md`. Quick facts: drain runs every 2 min (`limit=200`, `batch_size=20`, ~6,000 posts/hr capacity); recover transient classification failures with `reclassify-posts?mode=reset_failed&error_pattern=transient` (confirm with `dry_run=1` first); the watchdog writes `severity='critical'` rows into `error_log`. Live cron diverges from migration history per the established pattern — check `cron.job` for actual state.

## Known reliability issues

- **Reddit scraper swapped to `harshmaur/reddit-scraper` (June 2026, bake-off winner).** Root cause of the old failures: `trudax~reddit-scraper-lite` relied on Reddit's public `.json` API, which Reddit shut down (403) in May 2026 → ~75% degraded runs / ~14 items. harshmaur is HTML-parsing on residential proxies (bake-off: 100% success, fast, posts+comments). Actor is config-driven (`scraper_config.actor_id`); revert by setting it back to `trudax/reddit-scraper-lite`.

## Audit log

Audit records and one-time investigations: `OPERATIONS-HISTORY.md`. Deep operational reference (classifier, scrapers, rumors pipeline, frontend catalog): `AGENT-REFERENCE.md`. Open follow-up: `scraper_runs` + `error_log` return `[]` HTTP 200 to anon (RLS denial assumed, not yet investigated).

## Scrapers (Edge Functions)

Reddit (Apify), Hacker News (Algolia API), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (public API, 5 instances). Lemmy was dropped in Phase 12 (yielded 0.4 posts/run for 18 wasted Gemini calls; mostly Reddit cross-posts). Each scraper runs on its own pg_cron row at the three Pacific-time windows (05:00, 14:00, 21:00 PT), staggered by minute — see "Cron architecture" above. Scrapers insert posts as `classification_status='pending'`; classification is drained by the separate `drain-classification-queue` cron, and `aggregate-vibes` runs independently to refresh scores.

Shared utilities (keyword matching, dedup, error logging) are in `_shared/utils.ts` — scrapers import from there instead of duplicating code.

Classifier routing/retry/spillover and per-scraper actor details (Reddit harshmaur fan-out, Twitter apidojo, Apify budget caps): `AGENT-REFERENCE.md` — read it before changing `_shared/classifier.ts` or any scraper. Invariants that must hold:
- Classifier is Claude Haiku 4.5; a model swap is a pure config flip via `CLASSIFIER_MODEL` — rollback = `CLASSIFIER_MODEL=gemini-2.5-flash` (no redeploy, both providers stay live)
- Strict tool use (`strict:true`) stays OFF — nullable-union schema 400s under the structured-output subset (verified in prod 2026-06-02)
- Reddit comment ingestion stays disabled (`include_comments=false`) until a comment→parent-post attribution fix exists
- `maxTotalChargeUsd` is the authoritative Apify cost cap ($29/mo budget; in-code guard in `_shared/apify-budget.ts`)
- There is no `GEMINI_FREE_API_KEY` — spillover and the self-bias oracle use the paid `GEMINI_API_KEY`

`reclassify-posts` supports `?mode=multi_model` to fix historical multi-model posts; run `reaggregate-vibes` after.

**Tracked models:** Claude, ChatGPT, Gemini, Grok (DeepSeek and Perplexity were removed 2026-03-21).

## Rumors radar (`/rumors`)

Automated board of community chatter about *unreleased* model versions, ranked by cross-platform corroboration. Migration: `20260623120000_rumors_radar.sql`. Full pipeline detail (intake, canonicalization in `_shared/rumor-canon.ts`, `aggregate-rumors` phases, auto-release detection) is in `AGENT-REFERENCE.md` — read it before touching anything rumor-related.

Recurring manual touch: refresh the codename/next-version `model_keywords` rows each cycle, alongside `RELEASED_SET` in `aggregate-rumors/index.ts` and the `FAMILY_ALIASES` + `COMPETITOR_DENY` seeds in `_shared/rumor-canon.ts`. To hide a just-launched model instantly with zero backend deploy, set `released: true` on its `FAMILY_ALIASES` entry. ETAs are always framed as unconfirmed community estimates, never forecasts.

## Frontend design rules

Full pattern catalog (vendor events overlay, surface tagging, anomaly detection, status integration, research-article system, prerender/OG pipeline, primitive APIs) is in `AGENT-REFERENCE.md` — read the relevant entry before touching those areas. Always-on rules:

- Use the shared primitives, don't re-inline: `Surface.tsx` (card wrapper), `FilterChip.tsx`/`Tag.tsx` (the only two pills), `ModelCard.tsx`, `ChatterPost.tsx`, `SectionHeader.tsx`/`PageHeader.tsx`, `BarList.tsx`.
- **Type ladder** is 8 rungs (`hero / score-xl / score / page / section / body / meta / mono-cap`, in `src/index.css`) — pick a rung, never hand-rolled `text-[Npx]` / `text-lg` / `text-xs uppercase tracking-wide`.
- **Sentiment colors** derive only from `SENTIMENT_HSL` in `src/lib/vibes.ts` — no hex literals or palette classes.
- **Accent (primary) hue** is reserved for chart stroke, hero "bad day" glow, NavBar, and the TrendingComplaints %-change number. Severity/staleness read through `--destructive`/`--warning` *tints* with neutral text. The research-article surface is a deliberate editorial exception — don't neutralize it to match the dashboard.
- Aesthetic direction is **restraint**: one page-level fade per render, no per-section staggers, single calm border-color hover.
- Data-quality warnings are **asymmetric** — shown only when something is off; silence implies the data is fine.
- New public routes must be added to the `scripts/prerender-routes.ts` route table AND `public/sitemap.xml`; social shares must use the literal `.html` path form (Lovable host quirk).

**Edge Function deployment:** Pushing to `main` triggers Lovable auto-sync for frontend. Edge Functions require a Lovable-side redeploy — prompt Lovable to sync from GitHub and redeploy the affected functions. Do not use `supabase` CLI (no independent Supabase account exists).

## Environment Variables & Secrets

**Frontend (VITE_ prefix):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — public anon credentials, hardcoded as fallbacks in `src/integrations/supabase/client.ts`. Safe to expose (RLS enforces security).
- `.env` is gitignored; `.env.example` has placeholder structure for local overrides.

**Edge Functions (Supabase secrets — never commit these):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — production sentiment classifier (Claude Haiku 4.5); dedicated `llm-moods-classifier` key
- `CLASSIFIER_MODEL` — active classifier model id (`claude-haiku-4-5-20251001`); the cutover/rollback switch
- `GEMINI_API_KEY` — the **paid spillover / second-opinion grader**, not the primary classifier (the only Gemini key; billing must stay active on its Google project — pacing details in `AGENT-REFERENCE.md`).
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
