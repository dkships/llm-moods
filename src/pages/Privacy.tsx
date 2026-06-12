import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";

const Privacy = () => {
  useHead({
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
            <p className="mt-3 text-body text-text-secondary">
              LLM Vibes is an independent, open-source dashboard run by{" "}
              <a
                href="https://dmkthinks.org"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                David Kelly
              </a>
              . This page covers the two kinds of data the site touches: yours as a visitor, and the public
              posts the pipeline scores.
            </p>

            <h2 className="mt-10 text-section text-foreground">If you're visiting the site</h2>
            <p className="mt-3 text-body text-text-secondary">
              There are no accounts, no cookies, and no analytics or tracking scripts. Two third parties serve
              parts of each request: Google Fonts (your browser fetches font files from Google, which sees your
              IP address) and Supabase, the data backend, which keeps standard server request logs. That is the
              entire visitor data story.
            </p>

            <h2 className="mt-10 text-section text-foreground">If you wrote a post the pipeline scored</h2>
            <p className="mt-3 text-body text-text-secondary">
              The pipeline collects public posts that mention Claude, ChatGPT, Gemini, or Grok from five
              platforms: Reddit, Hacker News, Bluesky, X/Twitter, and Mastodon. For each post it stores the
              text (capped at 2,000 characters), a link to the original, a timestamp, and the source platform.
              Usernames and author identifiers are not stored in the database. Posts are used only for
              aggregate sentiment scoring and are deleted automatically after 90 days.
            </p>

            <h2 className="mt-10 text-section text-foreground">Content removal</h2>
            <p className="mt-3 text-body text-text-secondary">
              Research articles quote a small number of posts verbatim, with the author's handle and a link to
              the original. If you wrote a post that appears anywhere on this site, in an article or in the
              chatter feed, and want it removed or anonymized, open an issue on{" "}
              <a
                href="https://github.com/dkships/llm-moods/issues"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                the GitHub repo
              </a>{" "}
              or send a message on{" "}
              <a
                href="https://www.linkedin.com/in/thedmkelly/"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                LinkedIn
              </a>
              . Requests are honored promptly, no questions asked. If the original post was deleted at the
              source, its copy here will be deleted too.
            </p>

            <h2 className="mt-10 text-section text-foreground">Affiliation</h2>
            <p className="mt-3 text-body text-text-secondary">
              LLM Vibes is not affiliated with or endorsed by Anthropic, OpenAI, Google, or xAI. Claude,
              ChatGPT, Gemini, and Grok are trademarks of their respective owners. The site names them only to
              identify what it measures.
            </p>
          </section>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default Privacy;
