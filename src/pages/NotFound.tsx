import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import useHead from "@/hooks/useHead";

const NotFound = () => {
  useHead({
    title: "Page Not Found — LLM Vibes",
    description:
      "The page you're looking for doesn't exist. Browse the live AI sentiment dashboard or the latest LLM Vibes research.",
    noindex: true,
  });

  return (
        <section className="container flex min-h-[calc(100svh-14rem)] items-center justify-center py-16">
          <div className="text-center">
            <h1 className="mb-4 text-score-xl text-foreground">404</h1>
            <p className="text-section text-text-secondary mb-8">
              This page doesn't exist.
            </p>
            <Button asChild variant="outline" className="font-mono text-sm gap-2">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Link>
            </Button>
            <p className="mt-6 text-meta text-text-tertiary">
              Or jump to the{" "}
              <Link to="/dashboard" className="rounded-md text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                dashboard
              </Link>{" "}
              or{" "}
              <Link to="/research" className="rounded-md text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
                latest research
              </Link>
              .
            </p>
          </div>
        </section>
  );
};

export default NotFound;
