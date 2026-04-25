# LLM Moods (LLM Vibes) — Agent Instructions

## What This Is
Real-time AI sentiment dashboard tracking community vibes for 4 LLM models (Claude, ChatGPT, Gemini, Grok) across 7 social platforms. Scores models 0-100 daily. Live at llmvibes.ai.

## Tech Stack
- React 18 + TypeScript + Vite (SWC) + shadcn/ui + Tailwind + Recharts
- Supabase (PostgreSQL + Edge Functions)
- Sentiment: Gemini 3.1 Flash-Lite via Google AI API (batch classification)
- Scrapers (6 active): Reddit (Apify), HN, Bluesky, Twitter/X (Apify), Mastodon, Lemmy

## Scope And Boundaries
- Lovable-generated app synced bi-directionally with GitHub on `main`
- Supabase instance managed entirely through Lovable — no independent Supabase account
- Never suggest `supabase` CLI commands or dashboard steps
- Don't edit auto-generated files: `src/integrations/supabase/types.ts`
- Repo is public — never commit service role keys or API tokens

## Working Rules
- Push to `main` triggers Lovable auto-sync for frontend
- Edge Function deploys may require a Lovable-side trigger
- Always commit after completing work — don't leave dirty `main`
- Shared scraper utilities in `supabase/functions/_shared/utils.ts`

## Public App Guardrails
- Public route inventory is fixed to `/`, `/dashboard`, `/model/:slug`, `/research`, `/research/:slug`, and `*` (404)
- Dev-only routes (gated on `import.meta.env.DEV` so production bundles physically exclude them): `/admin/scrapers` (scraper monitor + anomalies panel), `/og/:slug` (OG card generator)
- Public complaint taxonomy must flow through `src/shared/public-taxonomy.ts`; do not hardcode labels or aliases in page components
- Unknown complaint categories must be filtered or shown as `Other` — never expose raw backend taxonomy strings in the UI
- Public freshness states use three buckets only: fresh, lagging, stale. Preserve the copy and semantics in `DataFreshnessIndicator`
- Public pages must keep a skip link, `main#main-content`, visible keyboard focus styles, and reduced-motion support
- Keep the dark-only public theme contract in `src/index.css` unless a deliberate theming project changes it end-to-end

## Hallucination Prevention
See `~/.agents/AGENTS.md`. For llm-moods: sources = code and model API responses.

## Definition Of Done
- Changes build successfully (`npm run build`)
- All tables have RLS enabled; anon key can only SELECT
- Edge functions use service role key via `Deno.env.get()`, never hardcoded

## Maintenance
- Owner: David Kelly
- Last Updated: 2026-04-25
