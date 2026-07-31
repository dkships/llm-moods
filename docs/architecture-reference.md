# Architecture Reference

Reference material moved out of `CLAUDE.md` (2026-07-07). Operating rules live in `CLAUDE.md` and `AGENTS.md`; deep pipeline detail (classifier, scrapers, rumors, frontend catalog) in `AGENT-REFERENCE.md`; audit records in `OPERATIONS-HISTORY.md`.

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
| Edge Functions | 16 Deno functions (5 active scrapers + utilities) |
| Sentiment AI | Claude Haiku 4.5 via Anthropic Messages API; provider pluggable via `CLASSIFIER_MODEL`, Gemini fallback |

## Key Routes

- `/` — Landing page (hero + model preview grid)
- `/dashboard` — All models with scores, trends, sparklines, chatter feed
- `/model/:slug` — Model detail (history chart, complaint/source breakdown, posts, vendor events overlay, recent-incident card, official status card with anomaly correlation, surface-tagged recent posts)
- `/research` — Research index (long-form articles index)
- `/research/:slug` — Research article (live embedded charts via `chart-model` markdown sentinel; first article ships with CSV download + Dataset JSON-LD)
- `/benchmark` — Ship Sense benchmark leaderboard (static snapshot from github.com/dkships/ship-sense; regenerate via `npm run sync:shipsense` after each official run)
- `/rumors` — Rumors radar: auto-aggregated community chatter about *unreleased* models (version + stage + hedged ETA + rumored benefit + signals), ranked by cross-platform corroboration. DB-driven via `get_public_rumors`.
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

`scraped_posts` also carries `rumor_checked_at` / `rumor_data` (rumor-extraction state).

**RPC Functions:** `get_landing_vibes()`, `get_complaint_breakdown()`, `get_source_breakdown()`, `get_trending_complaints()`, `get_public_rumors()` (public read), `get_rumor_candidates()` (service-role only)

## Cron architecture (May 2026)

The pipeline runs as independent pg_cron rows, each within its own 400 s edge-function budget. No orchestrator. Migration: `20260508183000_decompose_pipeline_to_independent_crons.sql`.

| Cron | Schedule (UTC) | PT | Function |
|---|---|---|---|
| `scrape-reddit-apify-3x` | `0 4,16 * * *` | 21/09 PT | `scrape-reddit-apify` (now **2×/day** — cost; job name unchanged) |
| `scrape-hackernews-3x` | `2 4,12,21 * * *` | +2 min | `scrape-hackernews` |
| `scrape-bluesky-3x` | `4 4,12,21 * * *` | +4 min | `scrape-bluesky` |
| `scrape-twitter-3x` | `6 4,12,21 * * *` | +6 min | `scrape-twitter` |
| `scrape-mastodon-3x` | `8 4,12,21 * * *` | +8 min | `scrape-mastodon` |
| `scrape-appstore-3x` | `10 4,12,21 * * *` | +10 min | `scrape-appstore` (Apple review RSS, free/keyless; added 2026-07-10) |
| `drain-classification-queue-2min` | `*/2 * * * *` | every 2 min | `drain-classification-queue` (body: `limit=200`, `batch_size=20` → 10 classifier calls/pass) |
| `aggregate-vibes-q30` | `20,50 * * * *` | every 30 min, offset | `aggregate-vibes` (refreshes last 7 days; `queued_posts` heals as drain catches up, `failed_posts` only via `reclassify-posts?mode=reset_failed`) |
| `pipeline-watchdog-1h` | `17 * * * *` | hourly at :17 | `pipeline-watchdog` |
| `cleanup-stuck-scraper-runs` | `*/30 * * * *` | every 30 min | (SQL only — marks runs >30 min as failed) |
| `cleanup-old-posts-weekly` | `0 8 * * 0` | Sun 01:00 PT | `cleanup-old-posts` |
| `aggregate-rumors-hourly` | `40 * * * *` | hourly at :40 | `aggregate-rumors` (rumors radar; hourly fast lane since `20260711210000_rumor_discovery_fast_lane.sql` — replaced the 2×/day `aggregate-rumors-2x` row) |

Drain capacity: every 2 min at `limit=200`, `batch_size=20` ≈ 6,000 posts/hr. The watchdog writes `severity='critical'` rows into `error_log`. Drain/queue mechanics, failed-vs-queued semantics, and watchdog thresholds: `AGENT-REFERENCE.md`.

## Scrapers (Edge Functions)

Reddit (Apify), Hacker News (Algolia API — stories + comments since 2026-07-10), Bluesky (AT Protocol), Twitter/X (Apify), Mastodon (public API, 5 instances; hashtag timelines only — unauthenticated phrase search was dead and removed 2026-07-10), App Store reviews (Apple RSS, free/keyless, added 2026-07-10). Lemmy was dropped in Phase 12 (yielded 0.4 posts/run for 18 wasted Gemini calls; mostly Reddit cross-posts). Each scraper runs on its own pg_cron row at the three Pacific-time windows (05:00, 14:00, 21:00 PT), staggered by minute. Scrapers insert posts as `classification_status='pending'`; classification is drained by the separate `drain-classification-queue` cron, and `aggregate-vibes` runs independently to refresh scores.

**Tracked models:** Claude, ChatGPT, Gemini, Grok (DeepSeek and Perplexity were removed 2026-03-21).

### Known reliability issues

- **Reddit scraper swapped to `harshmaur/reddit-scraper` (June 2026, bake-off winner).** Root cause of the old failures: `trudax~reddit-scraper-lite` relied on Reddit's public `.json` API, which Reddit shut down (403) in May 2026 → ~75% degraded runs / ~14 items. harshmaur is HTML-parsing on residential proxies (bake-off: 100% success, fast, posts+comments). Actor is config-driven (`scraper_config.actor_id`); revert by setting it back to `trudax/reddit-scraper-lite`.

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
- `.gitignore` uses `.env*` glob with `!.env.example` whitelist
- All tables have RLS enabled. As of PR #38 (2026-05-24) there are **no anon read policies** on `models` / `scraped_posts` / `vibes_scores` / `model_keywords` — a direct anon `.from()` SELECT returns `[]`. Public reads go through `SECURITY DEFINER` `get_public_*` RPCs (defined in `20260523120000_public_rpc_security_hardening.sql`); any new public data needs a new such RPC, not a direct table read.
- All edge functions use service role key via `Deno.env.get()`, never hardcoded

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
- All Edge Functions have `verify_jwt = false` (application-layer gates instead — see CLAUDE.md)
- Sentiment classification prompt is centralized in `_shared/classifier.ts` (batch + single)
- Minimal test coverage (example test only)
- Error handling in scrapers silently logs to `error_log` table
- Open follow-up: `scraper_runs` + `error_log` return `[]` HTTP 200 to anon (RLS denial assumed, not yet investigated)
