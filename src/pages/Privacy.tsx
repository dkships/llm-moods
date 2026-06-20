import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";

const Privacy = () => {
  useHead({
    title: "Privacy — LLM Vibes",
    description:
      "LLM Vibes has no accounts, no cookies, and no analytics. An independent, open-source dashboard.",
    url: "/privacy",
  });

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex flex-col">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-24">
          <section className="container max-w-3xl pt-10 pb-16 animate-fade-in">
            <h1 className="text-page text-foreground">Privacy</h1>
            <p className="mt-4 text-body text-text-secondary">
              LLM Vibes has no accounts, no cookies, and no analytics or tracking scripts. It is an
              independent, open-source dashboard run by{" "}
              <a
                href="https://dmkthinks.org"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-md text-foreground underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                David Kelly
              </a>
              .
            </p>
            <p className="mt-4 text-body text-text-secondary">
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
