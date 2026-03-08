
-- Create models table
CREATE TABLE public.models (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  accent_color TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create scraped_posts table
CREATE TABLE public.scraped_posts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  content TEXT,
  sentiment TEXT,
  complaint_category TEXT,
  score INTEGER,
  posted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create vibes_scores table
CREATE TABLE public.vibes_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  score INTEGER NOT NULL,
  period TEXT NOT NULL,
  period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  total_posts INTEGER DEFAULT 0,
  positive_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  top_complaint TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create user_reports table
CREATE TABLE public.user_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  model_id UUID NOT NULL REFERENCES public.models(id) ON DELETE CASCADE,
  sentiment TEXT NOT NULL,
  complaint_category TEXT,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.models ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scraped_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vibes_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_reports ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables
CREATE POLICY "Anyone can read models" ON public.models FOR SELECT USING (true);
CREATE POLICY "Anyone can read scraped_posts" ON public.scraped_posts FOR SELECT USING (true);
CREATE POLICY "Anyone can read vibes_scores" ON public.vibes_scores FOR SELECT USING (true);
CREATE POLICY "Anyone can read user_reports" ON public.user_reports FOR SELECT USING (true);

-- Anonymous insert for user_reports
CREATE POLICY "Anyone can submit reports" ON public.user_reports FOR INSERT WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_scraped_posts_model_id ON public.scraped_posts(model_id);
CREATE INDEX idx_scraped_posts_posted_at ON public.scraped_posts(posted_at DESC);
CREATE INDEX idx_vibes_scores_model_id ON public.vibes_scores(model_id);
CREATE INDEX idx_vibes_scores_period_start ON public.vibes_scores(period_start DESC);
CREATE INDEX idx_user_reports_model_id ON public.user_reports(model_id);
