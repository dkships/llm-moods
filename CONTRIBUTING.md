# Contributing to LLM Vibes

Thanks for your interest in contributing! LLM Vibes is an open-source AI sentiment dashboard and we welcome contributions of all kinds.

## Development Setup

1. Fork and clone the repo
   ```bash
   git clone https://github.com/YOUR_USERNAME/llm-moods.git
   cd llm-moods
   ```
2. Copy `.env.example` to `.env` and fill in your Supabase credentials
3. Install dependencies
   ```bash
   npm install
   ```
4. Start the dev server
   ```bash
   npm run dev
   ```

## Contribution Ideas

- **New data sources** — add scrapers for platforms we don't cover yet
- **New models** — add LLM models to track
- **Sentiment accuracy** — improve classification prompts or add post-processing
- **UI/UX** — better visualizations, accessibility, mobile experience
- **Performance** — optimize queries, reduce bundle size, improve load times

## How to Add a New Scraper

Look at any existing scraper in `supabase/functions/scrape-*` as a template. Each scraper:

1. Fetches posts from a platform API
2. Matches posts to models using keywords from the `model_keywords` table
3. Classifies sentiment via the AI gateway
4. Upserts results into `scraped_posts`
5. Logs the run to `scraper_runs`

## How to Add a New Model

1. Insert a row into the `models` table (slug, name, accent color)
2. Add keyword entries in `model_keywords` for the new model
3. The scrapers will automatically pick up the new model on the next run

## Lovable Sync Warning

This project uses Lovable for hosting and has bi-directional GitHub sync. To avoid breaking the sync:

- **Don't** restructure directories or rename files that Lovable manages
- **Don't** edit `src/integrations/supabase/types.ts` (auto-generated)
- **Don't** edit files in `src/components/ui/` (managed by shadcn)
- **Don't** remove the `lovable-tagger` dev dependency

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm run build` to verify
4. Open a PR against `main` with a clear description
5. Respond to any review feedback

## Code of Conduct

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before contributing.

---

Maintained by [David Kelly](https://dmkthinks.org)
