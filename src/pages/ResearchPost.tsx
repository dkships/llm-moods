import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download } from "lucide-react";
import { useMemo } from "react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";
import { Badge } from "@/components/ui/badge";
import { getResearchPost } from "@/data/research-posts";
import { getResearchBody } from "@/data/research-bodies";
import NotFound from "@/pages/NotFound";

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
      author: { "@type": "Person", name: post.author },
      publisher: {
        "@type": "Organization",
        name: "LLM Vibes",
        url: "https://llmvibes.ai",
      },
      keywords: post.tags.join(", "),
    };

    const graph: Record<string, unknown>[] = [article];

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

    if (graph.length === 1) {
      return { "@context": "https://schema.org", ...article };
    }
    return { "@context": "https://schema.org", "@graph": graph };
  }, [post]);

  useHead({
    title: post ? `${post.title} — LLM Vibes` : "Research — LLM Vibes",
    description: post?.summary,
    url: post ? `/research/${post.slug}` : undefined,
    ogImage: post?.ogImage,
    jsonLd,
  });

  if (!post || !Body) {
    return <NotFound />;
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <article className="container pt-10 pb-16">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="mx-auto max-w-3xl"
            >
              <Link
                to="/research"
                className="mb-6 inline-flex items-center gap-1.5 rounded-md text-sm text-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to Research
              </Link>

              <header className="mb-8 border-b border-border pb-8">
                <p className="font-mono text-xs uppercase tracking-wide text-foreground/65">
                  {formatDate(post.publishedAt)} · {post.author}
                </p>
                <h1 className="mt-3 text-3xl sm:text-4xl font-bold text-foreground">
                  {post.title}
                </h1>
                <p className="mt-4 text-base text-foreground/80 leading-relaxed">{post.summary}</p>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                  {post.tags.map((tag) => (
                    <Badge
                      key={tag}
                      variant="outline"
                      className="text-[10px] font-mono uppercase tracking-wide"
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
                {post.dataset && (
                  <a
                    href={post.dataset.path}
                    download
                    className="mt-5 inline-flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-4 py-2 font-mono text-xs text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    aria-label={`Download ${post.dataset.label}`}
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {post.dataset.label}
                  </a>
                )}
              </header>

              <div className="prose prose-invert prose-headings:font-display prose-headings:font-bold prose-h2:mt-10 prose-h2:text-2xl prose-h3:text-lg prose-p:text-foreground/85 prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-code:bg-secondary/60 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[0.85em] prose-pre:bg-secondary/60 prose-pre:overflow-x-auto prose-pre:rounded-lg prose-pre:p-4 prose-pre:font-mono prose-pre:text-sm prose-blockquote:border-l-primary prose-blockquote:bg-secondary/30 prose-blockquote:rounded-r-lg prose-blockquote:py-3 prose-blockquote:px-5 prose-blockquote:not-italic prose-blockquote:text-foreground/90 [&_blockquote_p:first-of-type]:before:content-none [&_blockquote_p:last-of-type]:after:content-none prose-table:font-mono prose-table:text-sm prose-table:border-collapse prose-th:bg-secondary/40 prose-th:px-3 prose-th:py-2 prose-th:text-left prose-th:font-semibold prose-th:text-foreground prose-td:border-t prose-td:border-border prose-td:px-3 prose-td:py-2 prose-td:text-foreground/80 max-w-none">
                <Body />
              </div>

            </motion.div>
          </article>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ResearchPostPage;
