import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AnimatePresence, MotionConfig } from "framer-motion";
import { lazy, Suspense, useEffect } from "react";
import Index from "./pages/Index";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ModelDetail = lazy(() => import("./pages/ModelDetail"));
const ResearchIndex = lazy(() => import("./pages/ResearchIndex"));
const ResearchPost = lazy(() => import("./pages/ResearchPost"));
const NotFound = lazy(() => import("./pages/NotFound"));

// Admin pages are dev-only — production bundles physically exclude the lazy
// import below thanks to Vite tree-shaking on the `import.meta.env.DEV` flag.
// See AGENTS.md: public route inventory stays fixed to /, /dashboard, /model/:slug, *.
const ScraperMonitor = import.meta.env.DEV
  ? lazy(() => import("./pages/ScraperMonitor"))
  : null;

const queryClient = new QueryClient();

const PageFallback = () => (
  <div className="min-h-screen bg-background">
    <div className="container pt-24" role="status" aria-live="polite">
      <div className="h-8 w-40 animate-pulse rounded bg-secondary/60" />
    </div>
  </div>
);

const ScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [pathname]);

  return null;
};

const AnimatedRoutes = () => {
  const location = useLocation();
  return (
    <>
      <ScrollToTop />
      <AnimatePresence mode="wait">
        <Routes location={location} key={location.pathname}>
          <Route path="/" element={<Index />} />
          <Route path="/dashboard" element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
          <Route path="/model/:slug" element={<Suspense fallback={<PageFallback />}><ModelDetail /></Suspense>} />
          <Route path="/research" element={<Suspense fallback={<PageFallback />}><ResearchIndex /></Suspense>} />
          <Route path="/research/:slug" element={<Suspense fallback={<PageFallback />}><ResearchPost /></Suspense>} />
          {ScraperMonitor && (
            <Route path="/admin/scrapers" element={<Suspense fallback={<PageFallback />}><ScraperMonitor /></Suspense>} />
          )}
          <Route path="*" element={<Suspense fallback={<PageFallback />}><NotFound /></Suspense>} />
        </Routes>
      </AnimatePresence>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
          <AnimatedRoutes />
        </BrowserRouter>
      </TooltipProvider>
    </MotionConfig>
  </QueryClientProvider>
);

export default App;
