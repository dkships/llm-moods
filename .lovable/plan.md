
# SEO / AEO / GEO Audit — LLM Vibes

Acting as your SEO consultant: the foundation here is genuinely strong. You already have canonical tags, per-route titles/descriptions, OG + Twitter cards, Organization + WebSite + Article + Dataset JSON-LD, an RSS feed, a sitemap, a sensible robots.txt, and AI-markdown rendering. This is well ahead of most sites.

The gaps are in the finer technical layer and in AEO/GEO (how answer engines like Google AI Overviews, ChatGPT, Perplexity, and Claude understand and cite you). Below is what I'd fix. **None of this touches front-facing user copy** — where a metadata value currently doubles as on-page text, I'll decouple them so the visible copy stays untouched.

## What's wrong today

```text
Severity   Issue
────────   ─────────────────────────────────────────────────────────
MID        Research posts emit og:type "website" (should be "article")
MID        Meta descriptions exceed 160 chars on 2 research posts
MID        404 page reuses the homepage meta description
LOW/AEO    No /llms.txt — answer engines must parse the whole site
LOW        No BreadcrumbList schema on research / model pages
LOW        Article schema missing author entity richness (sameAs)
LOW        Sitemap flagged for dev-only routes (false positive → ignore)
MID        Google Search Console not connected (optional, your call)
```

## Plan

### 1. Per-route og:type + Article social typing (AEO/social)
- Extend `useHead.ts` with an optional `ogType` param (default `website`); set the `og:type` meta tag from it.
- Pass `ogType="article"` from `ResearchPost.tsx`. Also wire `article:published_time`, `article:modified_time`, and `article:author` meta tags so LinkedIn/Slack/X and answer engines classify posts correctly.

### 2. Decouple meta descriptions from on-page summaries (no copy change)
- The `summary` field is rendered visibly on research cards and article headers, so I will **not** shorten it.
- Add an optional `metaDescription` field to `ResearchPost` (≤160 chars) used **only** for the `<meta description>` / og / twitter tags. Populate it for the two over-length posts (`how-llm-vibes-classifies-sentiment`, `cross-model-deltas-march-april-2026`). Visible summaries stay exactly as they are.
- `ResearchPost.tsx` passes `post.metaDescription ?? post.summary` to `useHead`.

### 3. Unique 404 description
- `NotFound.tsx` passes a distinct `description` to `useHead` (e.g. "The page you're looking for doesn't exist. Browse the dashboard or latest research.") — metadata only, not the visible "This page doesn't exist." line.

### 4. /llms.txt for answer-engine optimization (GEO/AEO)
- Add `public/llms.txt` (llmstxt.org format): H1 site name, one-line summary, then a Pages section linking `/`, `/dashboard`, `/research`, each `/model/:slug`, and each research article with one-line descriptions. Excludes dev-only `/admin/scrapers` and `/og/:slug`.
- This is what lets ChatGPT/Perplexity/Claude understand and cite the site without crawling the JS shell. Pairs with the markdown rendering you already pass.

### 5. BreadcrumbList structured data (rich results + AEO)
- Add `BreadcrumbList` JSON-LD to the `@graph` already emitted on research posts (Home → Research → Article).
- Add a small `BreadcrumbList` to `ModelDetail.tsx` via `useHead.jsonLd` (Home → Dashboard → Model). Helps Google show breadcrumb rich snippets and helps answer engines model site structure. No visible breadcrumb UI added.

### 6. Stronger author/entity schema (E-E-A-T / GEO)
- Upgrade the `author` in Article JSON-LD from a bare `Person` name to a `Person` with `sameAs` links (the same links already in `AuthorBio.tsx`'s `BIO_LINKS`). Answer engines weight authored, attributable content more heavily.

### 7. Sitemap finding — resolve as intended
- The flagged routes (`/admin/scrapers`, `/og/:slug`) are dev-only and correctly excluded from production. I'll mark that finding **ignored** with a note rather than adding entries (adding them would be wrong). The current sitemap already lists all public routes and research posts.

### 8. Google Search Console (optional — needs your go-ahead)
- GSC gives you real search-performance data and lets you submit the sitemap for faster indexing. Setup requires authorizing the Google Search Console connector and a one-time meta-tag verification on `llmvibes.ai`. I can do this end-to-end, but it needs your approval to connect. **Tell me if you want this included** — otherwise I'll leave it out.

## Technical notes
- All changes are frontend/metadata only: `src/hooks/useHead.ts`, `src/pages/ResearchPost.tsx`, `src/pages/ModelDetail.tsx`, `src/pages/NotFound.tsx`, `src/data/research-posts.ts`, new `public/llms.txt`.
- No database, edge function, RPC, or scraper changes. No visible copy changes.
- After merge, the published Lighthouse findings (LCP/contrast) re-evaluate on republish; those are separate from this metadata work and I'll flag them but not chase them here unless you want.
- I'll mark the relevant SEO findings fixed after implementation so the next scan verifies them.

## Not doing (deliberately)
- No FAQ/HowTo schema — that requires inventing Q&A copy, which would be fabricated content and touch user-facing text.
- No shortening of visible summaries or hero/headline copy.
- No light-mode or design-system changes.
