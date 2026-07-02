import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";

const LINK_CLASS =
  "rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const Privacy = () => {
  useHead({
    // Must stay byte-identical to the /privacy RouteMeta in scripts/prerender-routes.ts.
    title: "Privacy & data practices — LLM Vibes",
    description:
      "What LLM Vibes collects, how long it keeps it, and how to request removal of a quoted post. No accounts, no cookies, no analytics.",
    url: "/privacy",
  });

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex flex-col">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-24">
          <section className="container max-w-3xl pt-10 pb-16 animate-fade-in">
            <h1 className="text-page text-foreground">Privacy &amp; data practices</h1>
            <p className="mt-4 text-body text-text-secondary">
              LLM Vibes has no accounts, no cookies, and no analytics or tracking scripts. It is an
              independent, open-source dashboard run by{" "}
              <a
                href="https://dmkthinks.org"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                David Kelly
              </a>
              .
            </p>

            <h2 className="mt-10 text-section text-foreground">What it collects</h2>
            <p className="mt-3 text-body text-text-secondary">
              LLM Vibes scrapes public posts about AI models from Reddit, Hacker News, Bluesky,
              X/Twitter, and Mastodon. Each post is stored with its text, author handle, source
              link, and an AI-assigned sentiment classification. Nothing non-public is collected,
              and nothing is collected about visitors to this site.
            </p>

            <h2 className="mt-10 text-section text-foreground">How long it keeps it</h2>
            <p className="mt-3 text-body text-text-secondary">
              Scraped posts are deleted roughly 90 days after they were posted. Three things
              outlive that window: daily aggregate scores (numbers only, no post content), rumor
              records that keep a link and short snippet of the posts behind them, and verbatim
              quotes embedded in research articles. Internal error logs are deleted after 14 days.
            </p>

            <h2 className="mt-10 text-section text-foreground">Removing a quoted post</h2>
            <p className="mt-3 text-body text-text-secondary">
              If a post of yours appears here and you want it removed, open a{" "}
              <a
                href="https://github.com/dkships/llm-moods/issues"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                GitHub issue
              </a>{" "}
              or message David on{" "}
              <a
                href="https://www.linkedin.com/in/thedmkelly/"
                target="_blank"
                rel="noopener noreferrer"
                className={LINK_CLASS}
              >
                LinkedIn
              </a>
              . This covers chatter-feed posts, rumor sources, and quotes in research articles.
            </p>

            <p className="mt-10 text-body text-text-secondary">
              Not affiliated with or endorsed by Anthropic, OpenAI, Google, or xAI. Claude, ChatGPT, Gemini,
              and Grok are trademarks of their respective owners.
            </p>
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Privacy;
