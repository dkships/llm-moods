import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
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
              <h1 className="text-3xl sm:text-4xl font-bold text-foreground">Research</h1>
              <p className="mt-2 text-sm text-foreground/70 font-mono">
                Independent analysis of AI model quality, sourced from the LLM Vibes data set.
              </p>
            </motion.div>
          </section>

          <section className="container pb-12">
            <motion.div
              initial="hidden"
              animate="visible"
              variants={{ hidden: {}, visible: { transition: { staggerChildren: 0.08 } } }}
              className="grid grid-cols-1 gap-4 md:grid-cols-2"
            >
              {posts.map((post, i) => (
                <Link
                  key={post.slug}
                  to={`/research/${post.slug}`}
                  className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <motion.article
                    variants={fadeUp}
                    custom={i}
                    className="glass h-full rounded-xl p-6 transition-all duration-300 hover:-translate-y-1"
                  >
                    <p className="font-mono text-xs uppercase tracking-wide text-foreground/65">
                      {formatDate(post.publishedAt)}
                    </p>
                    <h2 className="mt-2 font-display text-xl font-bold text-foreground">
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
                    <div className="mt-5 inline-flex items-center gap-1.5 text-xs font-mono text-primary">
                      Read analysis <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </motion.article>
                </Link>
              ))}
            </motion.div>
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default ResearchIndex;
