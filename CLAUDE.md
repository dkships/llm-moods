# LLM Moods (LLM Vibes)

@../AGENTS.md

## Project Overview

Real-time AI sentiment dashboard tracking community vibes for LLM models (Claude, ChatGPT, Gemini, Grok, DeepSeek, Perplexity, etc.) across 12+ social platforms. Scores models 0-100 daily based on scraped post sentiment.

**Live at:** llmvibes.ai (Lovable-hosted)

## Lovable Project

This is a Lovable-generated app synced bi-directionally with GitHub on `main`. The Supabase instance is created and managed entirely through Lovable — there is no independent Supabase account. When editing locally:
- Push to `main` → Lovable auto-syncs frontend (other branches don't sync)
- **Edge Function deploys require a Lovable-side trigger** — pushing to `main` syncs the code but may not redeploy edge functions automatically. Give the user a Lovable chat prompt to trigger redeployment.
- Never suggest `supabase` CLI commands or Supabase dashboard steps — the user has no direct Supabase access
- Avoid restructuring directories or renaming files that Lovable manages
- Don't edit auto-generated files: `src/integrations/supabase/types.ts`, Lovable OAuth bridge files
- `lovable-tagger` dev dependency is required for Lovable's visual editor — don't remove
- Never enter API keys directly in Lovable — use Supabase Edge Function secrets or Lovable Cloud secrets

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
| Edge Functions | 13 Deno functions (scrapers + aggregation) |
| Sentiment AI | Gemini 3.1 Flash-Lite via Google AI API (batch classification, 25 posts/call) |

## Key Routes

- `/` — Landing page (hero + model preview grid)
- `/dashboard` — All models with scores, trends, sparklines, chatter feed
- `/model/:slug` — Model detail (history chart, complaint/source breakdown, posts)
- `/admin/scrapers` — Scraper run monitor (public, no auth)

## Database Schema

| Table | Purpose |
|-------|---------|
| `models` | Tracked LLM models (slug, name, accent_color) |
| `scraped_posts` | Raw posts with sentiment + complaint classification |
| `vibes_scores` | Aggregated daily/hourly scores (0-100) |
| `model_keywords` | Keyword → model matching for scrapers |
| `scraper_config` | Runtime scraper settings (subreddits, etc.) |
| `scraper_runs` | Audit log per scraper execution |
| `error_log` | Debug error tracking |

**RPC Functions:** `get_landing_vibes()`, `get_sparkline_scores()`, `get_complaint_breakdown()`, `get_source_breakdown()`, `get_trending_complaints()`

## Scrapers (Edge Functions)

Reddit (Apify), Hacker News, Bluesky, Twitter/X, Mastodon, Lobsters, Lemmy, Dev.to, Stack Overflow, Medium, Discourse. Orchestrated by `run-scrapers` (batches of 3, cron `0 6,14,22 * * *` — 3x/day at 6AM, 2PM, 10PM UTC). GitHub scraper exists but is not in the orchestrator.

Sentiment classified via Google Gemini API (`generativelanguage.googleapis.com`) using `gemini-3.1-flash-lite-preview`. All scrapers use batch classification (25 posts per API call) via `classifyBatch()` in `_shared/classifier.ts`. Classifier has 429 retry logic (3 attempts with exponential backoff) and 2s inter-batch delay. Gemini free tier is ~1,000 RPD (resets midnight Pacific Time). At 3x/day with ~21 calls/run, usage is ~63 calls/day — well within limits.

**Twitter/X scraper** uses `apidojo~tweet-scraper` Apify actor with `searchTerms` array input. Has a dormant Grok/xAI fallback path (requires `XAI_API_KEY`). Do NOT change the actor — `scrape.badger~twitter-tweets-scraper` was tried and returns 400.

**Edge Function deployment:** Pushing to `main` triggers Lovable auto-sync for frontend. Edge Functions require a Lovable-side redeploy — prompt Lovable to sync from GitHub and redeploy the affected functions. Do not use `supabase` CLI (no independent Supabase account exists).

## Environment Variables & Secrets

**Frontend (VITE_ prefix):**
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — public anon credentials, hardcoded as fallbacks in `src/integrations/supabase/client.ts`. Safe to expose (RLS enforces security).
- `.env` is gitignored; `.env.example` has placeholder structure for local overrides.

**Edge Functions (Supabase secrets — never commit these):**
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY` — Google AI API key for sentiment classification (all scrapers)
- `LOVABLE_API_KEY` — Lovable AI gateway key (no longer used by scrapers, kept for Lovable platform)
- `APIFY_API_TOKEN`, `BSKY_HANDLE`, `BSKY_APP_PASSWORD`
- `MASTODON_URL`, `MASTODON_TOKEN`, `LEMMY_INSTANCE_URL`
- `MEDIUM_TOKEN`, `DISCOURSE_INSTANCE`, `DISCOURSE_API_KEY`, `GITHUB_TOKEN`

**Security notes:**
- Repo is **public** on GitHub — never commit service role keys, API tokens, or passwords
- `.gitignore` uses `.env*` glob with `!.env.example` whitelist
- All tables have RLS enabled; anon key can only SELECT (no write policies)
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
- **Sentiment scale:** 0-40 bad (red), 41-65 mixed (amber), 66-100 good (green)

## Known Limitations

- TypeScript config is loose (`strictNullChecks: false`, `noImplicitAny: false`)
- `/admin/scrapers` is public — no auth required
- All Edge Functions have `verify_jwt = false`
- Sentiment classification prompt is centralized in `_shared/classifier.ts` (batch + single)
- Minimal test coverage (example test only)
- Error handling in scrapers silently logs to `error_log` table

## Working Here with Claude Code

Focus areas for local edits:
- Bug fixes in frontend components (`src/components/`, `src/pages/`)
- Query logic in `src/hooks/useVibesData.ts`
- Scraper logic in `supabase/functions/`
- Constants/labels in `src/lib/vibes.ts`
- Database migrations in `supabase/migrations/`

Don't modify: `src/integrations/supabase/types.ts` (auto-generated), `src/components/ui/` (shadcn managed)

Always commit after completing work — don't leave a dirty branch on `main` (Lovable syncs from it).
