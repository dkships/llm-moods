import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import NavBar from "@/components/NavBar";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import useHead from "@/hooks/useHead";

const NotFound = () => {
  useHead({ title: "Page Not Found — LLM Vibes" });

  return (
    <PageTransition>
      <div className="min-h-screen bg-background flex flex-col">
        <NavBar />
        <main id="main-content" tabIndex={-1} className="flex flex-1 items-center justify-center scroll-mt-24">
          <div className="text-center">
            <p className="text-score-xl text-foreground mb-4">404</p>
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
              <Link to="/dashboard" className="text-foreground underline underline-offset-2 hover:text-primary">
                dashboard
              </Link>{" "}
              or{" "}
              <Link to="/research" className="text-foreground underline underline-offset-2 hover:text-primary">
                latest research
              </Link>
              .
            </p>
          </div>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default NotFound;
