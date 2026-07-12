import { Suspense } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Footer from "@/components/Footer";
import NavBar from "@/components/NavBar";
import PageTransition from "@/components/PageTransition";

const PublicRouteFallback = () => (
  <div
    className="container flex min-h-[calc(100svh-3.5rem)] items-start pt-10 sm:min-h-[calc(100svh-4rem)]"
    role="status"
    aria-live="polite"
  >
    <span className="sr-only">Loading page</span>
    <div
      className="h-8 w-40 animate-pulse rounded-lg bg-secondary/45"
      aria-hidden="true"
    />
  </div>
);

const PublicLayout = () => {
  const { pathname } = useLocation();

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <NavBar />
      <main id="main-content" tabIndex={-1} className="flex-1 scroll-mt-24">
        <PageTransition key={pathname}>
          <Suspense fallback={<PublicRouteFallback />}>
            <Outlet />
          </Suspense>
        </PageTransition>
      </main>
      <Footer />
    </div>
  );
};

export default PublicLayout;
