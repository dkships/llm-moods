import { Link } from "react-router-dom";
import { Rss } from "lucide-react";
import Surface from "@/components/Surface";
import useHead from "@/hooks/useHead";
import Tag from "@/components/Tag";
import { controlPill } from "@/components/ControlPill";
import { RESEARCH_POSTS } from "@/data/research-posts";
import { RESEARCH_SPARKLINES } from "@/data/research-sparklines";
import ResearchSparkline from "@/components/research/ResearchSparkline";
import ScoreScale from "@/components/research/ScoreScale";
import NotFound from "@/pages/NotFound";
import type { ResearchPost } from "@/data/research-posts";

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

// Static data → module-level so the JSON-LD object identity is stable and
// useHead's effect doesn't re-run every render.
const SORTED_POSTS = [...RESEARCH_POSTS].sort((a, b) =>
  new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
);

// Mirrored in the /research RouteMeta in scripts/prerender-routes.ts — both
// sides are required (prerender for crawlers, this for post-hydration).
const RESEARCH_INDEX_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "LLM Vibes Research",
  itemListElement: SORTED_POSTS.map((post, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `https://llmvibes.ai/research/${post.slug}`,
    name: post.title,
  })),
};

const CARD_LINK_CLASS =
  "block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const PostTags = ({ post }: { post: ResearchPost }) => (
  <div className="mt-4 flex flex-wrap items-center gap-2">
    {post.tags.slice(0, 3).map((tag) => (
      <Tag key={tag} shape="pill">{tag}</Tag>
    ))}
  </div>
);

// Every card leads with its article's own score line; the methodology post
// has no series, so it shows the scale the method produces instead.
const CardStrip = ({ post }: { post: ResearchPost }) => {
  const sparkline = RESEARCH_SPARKLINES[post.slug];
  return (
    <div className="border-b border-border bg-background/40 px-4 pb-3 pt-4 sm:px-6">
      {sparkline ? <ResearchSparkline data={sparkline} size="card" /> : <ScoreScale />}
    </div>
  );
};

const FeaturedPost = ({ post }: { post: ResearchPost }) => {
  const sparkline = RESEARCH_SPARKLINES[post.slug];
  return (
    <Link to={`/research/${post.slug}`} className={`${CARD_LINK_CLASS} md:col-span-2`}>
      <Surface
        as="article"
        size="bare"
        elevation="lift"
        className="h-full overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]"
      >
        <div className="flex flex-col p-4 sm:p-6 md:p-8">
          <p className="text-mono-cap text-text-tertiary">
            {formatDate(post.publishedAt)}
            {post.updatedAt && post.updatedAt !== post.publishedAt ? `, updated ${formatDate(post.updatedAt)}` : ""}
          </p>
          <h2 className="mt-3 text-section text-foreground sm:text-page">{post.title}</h2>
          <p className="mt-4 text-body text-text-secondary">{post.summary}</p>
          <PostTags post={post} />
        </div>
        {sparkline && (
          <div className="border-t border-border bg-background/40 p-4 sm:p-6 md:border-l md:border-t-0 md:p-8">
            <ResearchSparkline data={sparkline} size="hero" className="h-full" />
          </div>
        )}
      </Surface>
    </Link>
  );
};

const ResearchIndex = () => {
  const posts = SORTED_POSTS;

  useHead({
    title: "Research — LLM Vibes",
    description:
      "Independent analysis of AI model quality and incidents from the LLM Vibes data set.",
    url: "/research",
    jsonLd: RESEARCH_INDEX_JSON_LD,
    noindex: posts.length === 0,
  });

  if (posts.length === 0) {
    return <NotFound />;
  }

  return (
    <>
          <section className="container pb-8 pt-10 sm:pt-12">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-page text-foreground">Research</h1>
                <p className="mt-2 max-w-2xl text-body text-text-secondary">
                  Independent analysis of AI model quality, sourced from the LLM Vibes data set.
                </p>
              </div>
              <a
                href="/research/feed.xml"
                className={controlPill("group shrink-0")}
                aria-label="Subscribe to the LLM Vibes Research RSS feed"
              >
                <Rss className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                RSS
              </a>
            </div>
          </section>

          <section className="container pb-12">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FeaturedPost post={posts[0]} />
              {posts.slice(1).map((post) => (
                <Link key={post.slug} to={`/research/${post.slug}`} className={CARD_LINK_CLASS}>
                  <Surface as="article" size="bare" elevation="lift" className="flex h-full flex-col overflow-hidden">
                    <CardStrip post={post} />
                    <div className="p-4 sm:p-6">
                      <p className="text-mono-cap text-text-tertiary">{formatDate(post.publishedAt)}</p>
                      <h2 className="mt-2 text-section text-foreground">{post.title}</h2>
                      <p className="mt-3 text-body text-text-secondary">{post.summary}</p>
                      <PostTags post={post} />
                    </div>
                  </Surface>
                </Link>
              ))}
            </div>
          </section>
    </>
  );
};

export default ResearchIndex;
