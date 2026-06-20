-- Reddit comments OFF — data-driven 80/20 from the first live harshmaur run.
-- A full run returned 382 items (80 posts + 302 comments) at $0.799, but only 10
-- matched a model: harshmaur's comment items don't carry the subreddit, so the
-- subreddit->model attribution can't fire and comments rarely name the model in
-- their own text, so ~302 comments dropped. We paid ~95% of the cost for ~0
-- usable comment data. Posts-only keeps the real win (Reddit posts from the 8
-- model-specific subreddits, which trudax could no longer deliver) at ~$0.30/run
-- (~$30/mo + Twitter, well under the $80 cap). The comment-ingestion code stays
-- (config-gated); re-enable only with a proper comment->parent-subreddit
-- attribution fix if the comment signal is later worth the cost.

UPDATE public.scraper_config SET value = 'false'
  WHERE scraper = 'scrape-reddit-apify' AND key = 'include_comments';
INSERT INTO public.scraper_config (scraper, key, value)
SELECT 'scrape-reddit-apify', 'include_comments', 'false'
WHERE NOT EXISTS (SELECT 1 FROM public.scraper_config WHERE scraper = 'scrape-reddit-apify' AND key = 'include_comments');