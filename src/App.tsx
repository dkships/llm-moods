import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const ModelDetail = lazy(() => import("./pages/ModelDetail"));
const ResearchIndex = lazy(() => import("./pages/ResearchIndex"));
const ResearchPost = lazy(() => import("./pages/ResearchPost"));
const Rumors = lazy(() => import("./pages/Rumors"));
const Privacy = lazy(() => import("./pages/Privacy"));

// Admin / generator pages are dev-only — production bundles physically exclude
// the lazy import below thanks to Vite tree-shaking on the `import.meta.env.DEV`
// flag. See AGENTS.md: public route inventory stays fixed to /, /dashboard,
// /model/:slug, /research, /research/:slug, *.
const ScraperMonitor = import.meta.env.DEV
  ? lazy(() => import("./pages/ScraperMonitor"))
  : null;
const OgPreview = import.meta.env.DEV
  ? lazy(() => import("./pages/OgPreview"))
  : null;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live scores update at most every few hours; skip the default
      // refetch-on-focus that would hot-fetch every tab focus.
      refetchOnWindowFocus: false,
    },
  },
});

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
      {/* key on Routes remounts the matched page per navigation, replaying the
          CSS `animate-fade-in` in PageTransition (no framer-motion needed). */}
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<Index />} />
        <Route path="/dashboard" element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
        <Route path="/model/:slug" element={<Suspense fallback={<PageFallback />}><ModelDetail /></Suspense>} />
        <Route path="/research" element={<Suspense fallback={<PageFallback />}><ResearchIndex /></Suspense>} />
        <Route path="/research/:slug" element={<Suspense fallback={<PageFallback />}><ResearchPost /></Suspense>} />
        <Route path="/rumors" element={<Suspense fallback={<PageFallback />}><Rumors /></Suspense>} />
        <Route path="/privacy" element={<Suspense fallback={<PageFallback />}><Privacy /></Suspense>} />
        {ScraperMonitor && (
          <Route path="/admin/scrapers" element={<Suspense fallback={<PageFallback />}><ScraperMonitor /></Suspense>} />
        )}
        {OgPreview && (
          <Route path="/og/:slug" element={<Suspense fallback={<PageFallback />}><OgPreview /></Suspense>} />
        )}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <ErrorBoundary>
          <AnimatedRoutes />
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
