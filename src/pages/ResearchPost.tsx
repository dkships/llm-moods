import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Download } from "lucide-react";
import { Suspense, useMemo } from "react";
import useHead from "@/hooks/useHead";
import Tag from "@/components/Tag";
import { controlPill } from "@/components/ControlPill";
import { Shimmer } from "@/components/Skeletons";
import { getResearchPost } from "@/data/research-posts";
import { getResearchBody } from "@/data/research-bodies";
import { PROSE_CLASS_NAME } from "@/lib/prose-styles";
import NotFound from "@/pages/NotFound";
import { AUTHOR_NAME, AUTHOR_SAMEAS } from "@/components/research/AuthorBio";
import ShareLinks from "@/components/research/ShareLinks";

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const ResearchPostPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const post = slug ? getResearchPost(slug) : undefined;
  const Body = slug ? getResearchBody(slug) : undefined;

  const jsonLd = useMemo(() => {
    if (!post) return undefined;
    const url = `https://llmvibes.ai/research/${post.slug}`;
    const article: Record<string, unknown> = {
      "@type": "Article",
      headline: post.title,
      description: post.summary,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt ?? post.publishedAt,
      url,
      mainEntityOfPage: { "@type": "WebPage", "@id": url },
      author: {
        "@type": "Person",
        name: post.author,
        ...(post.author === AUTHOR_NAME ? { sameAs: AUTHOR_SAMEAS } : {}),
      },
      publisher: {
        "@type": "Organization",
        name: "LLM Vibes",
        url: "https://llmvibes.ai",
      },
      keywords: post.tags.join(", "),
    };

    const breadcrumb: Record<string, unknown> = {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "https://llmvibes.ai/" },
        { "@type": "ListItem", position: 2, name: "Research", item: "https://llmvibes.ai/research" },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    };

    const graph: Record<string, unknown>[] = [article, breadcrumb];

    if (post.dataset) {
      graph.push({
        "@type": "Dataset",
        name: post.dataset.label,
        description: post.dataset.description,
        url,
        datePublished: post.dataset.publishedAt,
        license: post.dataset.license === "MIT" ? "https://opensource.org/licenses/MIT" : post.dataset.license,
        creator: { "@type": "Organization", name: "LLM Vibes", url: "https://llmvibes.ai" },
        distribution: [
          {
            "@type": "DataDownload",
            encodingFormat: "text/csv",
            contentUrl: `https://llmvibes.ai${post.dataset.path}`,
          },
        ],
      });
    }

    return { "@context": "https://schema.org", "@graph": graph };
  }, [post]);

  useHead({
    // This effect runs AFTER the nested <NotFound/>'s (child effects fire
    // first), so the bad-slug case must carry the 404 head state itself.
    title: post ? `${post.title} — LLM Vibes` : "Page Not Found — LLM Vibes",
    description: post?.metaDescription ?? post?.summary,
    url: post ? `/research/${post.slug}` : undefined,
    ogImage: post?.ogImage,
    ogType: post ? "article" : undefined,
    article: post
      ? {
          publishedTime: post.publishedAt,
          modifiedTime: post.updatedAt ?? post.publishedAt,
          author: post.author,
        }
      : undefined,
    jsonLd,
    noindex: !post || !Body,
  });

  if (!post || !Body) {
    return <NotFound />;
  }

  return (
          <article className="container pb-16 pt-10 sm:pt-12">
            <div className="mx-auto max-w-3xl">
              <Link
                to="/research"
                className="mb-6 inline-flex min-h-11 items-center gap-1.5 rounded-md text-meta text-text-tertiary transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Research
              </Link>

              <header className="mb-8 border-b border-border pb-8">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-mono-cap text-text-tertiary">
                  <span>
                    {formatDate(post.publishedAt)} · {post.author}
                  </span>
                  {post.updatedAt && post.updatedAt !== post.publishedAt && (
                    <Tag shape="pill">Updated · {formatDate(post.updatedAt)}</Tag>
                  )}
                </div>
                {/* text-section below sm: .text-page is a fixed 36px, and
                    headlines here run to ~97 characters — at 320px that wraps
                    to 6-7 oversized lines before any article body is visible.
                    ResearchIndex already uses this pair for the same titles. */}
                <h1 className="mt-3 text-section text-foreground sm:text-page">
                  {post.title}
                </h1>
                <p className="mt-4 text-body text-text-secondary">{post.summary}</p>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {post.tags.map((tag) => (
                    <Tag key={tag} shape="pill">{tag}</Tag>
                  ))}
                </div>
                {post.dataset && (
                  <a
                    href={post.dataset.path}
                    download
                    className={controlPill("mt-5")}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">Download </span>
                    {post.dataset.label}
                  </a>
                )}
              </header>

              <div className={PROSE_CLASS_NAME}>
                <Suspense
                  fallback={
                    <div className="space-y-3" role="status" aria-live="polite">
                      <span className="sr-only">Loading article</span>
                      <Shimmer className="h-5 w-full" />
                      <Shimmer className="h-5 w-11/12" />
                      <Shimmer className="h-5 w-4/5" />
                    </div>
                  }
                >
                  <Body />
                </Suspense>
              </div>

              <footer className="mt-12 border-t border-border pt-6">
                <ShareLinks url={`https://llmvibes.ai/research/${post.slug}`} title={post.title} />

                <p className="mt-4 text-meta text-text-tertiary">
                  Cite this analysis: {post.author}, &ldquo;{post.title},&rdquo; LLM Vibes,{" "}
                  {formatDate(post.publishedAt)}. llmvibes.ai/research/{post.slug}
                </p>
              </footer>
            </div>
          </article>
  );
};

export default ResearchPostPage;
