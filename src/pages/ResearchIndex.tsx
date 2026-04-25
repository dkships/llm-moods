import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Rss } from "lucide-react";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";
import { Badge } from "@/components/ui/badge";
import { fadeUp } from "@/lib/vibes";
import { RESEARCH_POSTS } from "@/data/research-posts";
import NotFound from "@/pages/NotFound";

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

const ResearchIndex = () => {
  const posts = [...RESEARCH_POSTS].sort((a, b) =>
    new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  useHead({
    title: "Research — LLM Vibes",
    description:
      "Independent analysis of AI model quality and incidents from the LLM Vibes data set.",
    url: "/research",
  });

  if (posts.length === 0) {
    return <NotFound />;
  }

  return (
    <PageTransition>
      <div className="min-h-screen bg-background">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="scroll-mt-24">
          <section className="container pt-10 pb-8">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Research</h1>
                  <p className="mt-2 text-sm text-foreground/70 font-mono">
                    Independent analysis of AI model quality, sourced from the LLM Vibes data set.
                  </p>
                </div>
                <a
                  href="/research/feed.xml"
                  className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  aria-label="Subscribe to the LLM Vibes Research RSS feed"
                >
                  <Rss className="h-3.5 w-3.5" aria-hidden="true" />
                  RSS
                </a>
              </div>
            </motion.div>
          </section>

          <section className="container pb-12">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {posts.map((post, i) => {
                const isFeatured = i === 0;
                return (
                  <Link
                    key={post.slug}
                    to={`/research/${post.slug}`}
                    className={`block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      isFeatured ? "md:col-span-2" : ""
                    }`}
                  >
                    <motion.article
                      variants={fadeUp}
                      custom={i}
                      className={`glass h-full rounded-xl p-6 transition-all duration-300 hover:-translate-y-1 ${
                        isFeatured ? "border-l-2 border-l-primary sm:p-8" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <p className="font-mono text-xs uppercase tracking-wide text-foreground/65">
                          {formatDate(post.publishedAt)}
                        </p>
                        {isFeatured && (
                          <span className="font-mono text-[10px] uppercase tracking-wide text-primary">
                            Latest
                          </span>
                        )}
                      </div>
                      <h2
                        className={`mt-2 font-display font-bold text-foreground ${
                          isFeatured ? "text-2xl sm:text-3xl" : "text-xl"
                        }`}
                      >
                        {post.title}
                      </h2>
                      <p className="mt-3 text-sm text-foreground/75 leading-relaxed">{post.summary}</p>
                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {post.tags.slice(0, 3).map((tag) => (
                          <Badge
                            key={tag}
                            variant="outline"
                            className="text-[10px] font-mono uppercase tracking-wide"
                          >
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </motion.article>
                  </Link>
                );
              })}
            </motion.div>
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ResearchIndex;
