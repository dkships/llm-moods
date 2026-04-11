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
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-7xl font-bold font-mono text-primary glow-text mb-4">404</p>
            <p className="text-lg text-muted-foreground font-mono mb-8">
              This page doesn't exist.
            </p>
            <Link to="/">
              <Button variant="outline" className="font-mono text-sm gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </main>
        <Footer />
      </div>
    </PageTransition>
  );
};

export default NotFound;
