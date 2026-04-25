import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Download } from "lucide-react";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";
import { Badge } from "@/components/ui/badge";
import { getResearchPost } from "@/data/research-posts";
import EmbeddedModelChart from "@/components/research/EmbeddedModelChart";
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

  if (!post) {
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

              <div className="prose prose-invert prose-headings:font-display prose-headings:font-bold prose-h2:mt-10 prose-h2:text-2xl prose-h3:text-lg prose-p:text-foreground/85 prose-p:leading-relaxed prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-strong:text-foreground prose-code:text-primary prose-code:before:content-none prose-code:after:content-none prose-blockquote:border-l-primary prose-blockquote:bg-secondary/30 prose-blockquote:rounded-r-lg prose-blockquote:py-3 prose-blockquote:px-5 prose-blockquote:not-italic prose-blockquote:text-foreground/90 prose-table:font-mono prose-table:text-sm prose-th:text-foreground prose-td:text-foreground/80 max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    code: ({ className, children, ...rest }) => {
                      const language = /language-([\w-]+)/.exec(className || "")?.[1];
                      if (language === "chart-model") {
                        const modelSlug = String(children).trim();
                        return <EmbeddedModelChart modelSlug={modelSlug} />;
                      }
                      const isInline = !className;
                      if (isInline) {
                        return (
                          <code
                            className="rounded bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.85em]"
                            {...rest}
                          >
                            {children}
                          </code>
                        );
                      }
                      return (
                        <code className={`block ${className ?? ""}`} {...rest}>
                          {children}
                        </code>
                      );
                    },
                    pre: ({ children }) => (
                      <pre className="overflow-x-auto rounded-lg bg-secondary/60 p-4 font-mono text-sm">
                        {children}
                      </pre>
                    ),
                    table: ({ children }) => (
                      <div className="my-6 overflow-x-auto rounded-lg border border-border">
                        <table className="w-full">{children}</table>
                      </div>
                    ),
                    a: ({ href, children, ...rest }) => {
                      const isExternal = href?.startsWith("http");
                      if (isExternal) {
                        return (
                          <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                            {children}
                          </a>
                        );
                      }
                      return (
                        <Link to={href ?? "#"} {...rest}>
                          {children}
                        </Link>
                      );
                    },
                  }}
                >
                  {post.body}
                </ReactMarkdown>
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
