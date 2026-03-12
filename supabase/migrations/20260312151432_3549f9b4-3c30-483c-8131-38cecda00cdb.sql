ALTER TABLE scraped_posts
  ADD CONSTRAINT uq_scraped_posts_url_model UNIQUE (source_url, model_id);