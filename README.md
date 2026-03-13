# LLM Vibes 🌊

Real-time community sentiment tracking for AI models. Is your AI having a bad day?

[llmvibes.ai](https://llmvibes.ai)

## What is this?

LLM Vibes automatically scrapes social platforms (Reddit, Bluesky, Mastodon, Hacker News, Lobsters, Dev.to, Stack Overflow, Medium, and Discourse forums) to track how people feel about major AI models — Claude, ChatGPT, Gemini, Grok, DeepSeek, and Perplexity.

No surveys. No voting. Just real conversations, classified by AI.

## Tech Stack

- **Frontend:** React + TypeScript + Tailwind CSS + Recharts
- **Backend:** Supabase (Lovable Cloud) — database, edge functions, cron jobs
- **Data Pipeline:** 11 scraper edge functions running on cron schedules
- **Sentiment Analysis:** LLM-powered classification via Lovable AI
- **Hosting:** Lovable Cloud

## Features

- Real-time vibes dashboard for 6 AI models
- Per-model detail pages with 30-day historical charts
- Complaint category breakdowns (lazy responses, hallucinations, refusals, coding quality, speed, general drop)
- Source diversity tracking across 9+ platforms
- Automated hourly data pipeline — no manual intervention needed
- English language filtering for clean data
- Two-tier keyword matching to reduce false positives
- Relevance filtering via AI to skip off-topic posts

## Data Sources

| Source | Method | Auth Required |
|--------|--------|--------------|
| Bluesky | AT Protocol search (authenticated) | App password |
| Mastodon | Public hashtag timelines | None |
| Hacker News | Algolia Search API + Firebase API | None |
| Reddit | Apify scraper | API token |
| Lobsters | Public JSON API | None |
| Dev.to | Public API | None |
| Stack Overflow | Public API | None |
| Medium | RSS feeds | None |
| Discourse | Public JSON (OpenAI + Anthropic forums) | None |

## Getting Started

1. Clone the repo
2. Copy `.env.example` to `.env` and fill in your Supabase credentials
3. `npm install`
4. `npm run dev`

Note: The scraping edge functions run on Supabase/Lovable Cloud and require their own setup with secrets for API keys (Bluesky, Apify).

## Contributing

Contributions welcome! Some ideas:

- Add new data sources
- Improve sentiment classification accuracy
- Add new models to track
- UI/UX improvements
- Performance optimizations

## License

MIT

## Author

Built by [David Kelly](https://dmkthinks.org)
