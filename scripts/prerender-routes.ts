/**
 * Build-time per-route static HTML for social-share crawlers.
 *
 * LinkedIn (and most chat-app unfurlers) never execute JavaScript, so the
 * per-route OG tags set client-side by src/hooks/useHead.ts are invisible to
 * them — every shared URL used to render the homepage card. This plugin runs
 * after `vite build` and writes a transformed copy of dist/index.html for each
 * public route with the correct title / description / og:* / canonical /
 * JSON-LD baked in. The SPA still hydrates normally: useHead finds the
 * prerendered tags (including the `page-json-ld` script id it manages) and
 * updates them in place, so nothing is duplicated.
 *
 * Each route is emitted in BOTH URL forms — `<route>/index.html` (directory
 * index) and `<route>.html` (flat) — so it works whichever form the static
 * host resolves for extensionless paths. canonical/og:url always use the
 * no-trailing-slash form to match sitemap.xml, the RSS feed, and ShareLinks.
 *
 * Registered in vite.config.ts as a plugin (closeBundle hook) rather than an
 * npm script so it runs under any `vite build` invocation, including Lovable's.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { RESEARCH_POSTS } from "../src/data/research-posts";
import { AUTHOR_NAME, AUTHOR_SAMEAS } from "../src/data/author";

const BASE_URL = "https://llmvibes.ai";

// Mirrors the model map used by /model/:slug (slugs from VENDOR_BY_MODEL in
// src/data/vendor-events.ts; title/description mirror the useHead call in
// src/pages/ModelDetail.tsx).
const MODEL_NAMES: Record<string, string> = {
  claude: "Claude",
  chatgpt: "ChatGPT",
  gemini: "Gemini",
  grok: "Grok",
};

interface RouteMeta {
  /** Route path without trailing slash, e.g. "/research/claude-april-2026" */
  path: string;
  title: string;
  description: string;
  ogImage: string;
  ogType: "website" | "article";
  article?: { publishedTime: string; modifiedTime: string; author: string };
  jsonLd?: Record<string, unknown>;
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Replace exactly one occurrence; throw otherwise. This is the drift guard:
 * if index.html's head is later edited in a way these patterns no longer
 * match, the build fails loudly instead of silently shipping wrong share tags.
 */
function replaceOnce(html: string, pattern: RegExp, replacement: (match: RegExpMatchArray) => string, label: string): string {
  const matches = [...html.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"))];
  if (matches.length !== 1) {
    throw new Error(
      `[prerender-routes] expected exactly 1 match for ${label} in dist/index.html, found ${matches.length}. ` +
        `If index.html's head changed, update scripts/prerender-routes.ts to match.`,
    );
  }
  return html.replace(matches[0][0], replacement(matches[0]));
}

const attrReplacer = (escaped: string) => (m: RegExpMatchArray) => `${m[1]}${escaped}${m[2]}`;

function buildArticleJsonLd(post: (typeof RESEARCH_POSTS)[number]): Record<string, unknown> {
  // Ported from the jsonLd builder in src/pages/ResearchPost.tsx — keep in sync.
  const url = `${BASE_URL}/research/${post.slug}`;
  const article: Record<string, unknown> = {
    "@type": "Article",
    headline: post.title,
    description: post.summary,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt ?? post.publishedAt,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: {
      "@type": "Person",
      name: post.author,
      ...(post.author === AUTHOR_NAME ? { sameAs: AUTHOR_SAMEAS } : {}),
    },
    publisher: { "@type": "Organization", name: "LLM Vibes", url: BASE_URL },
    keywords: post.tags.join(", "),
  };

  const breadcrumb: Record<string, unknown> = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Research", item: `${BASE_URL}/research` },
      { "@type": "ListItem", position: 3, name: post.title, item: url },
    ],
  };

  const graph: Record<string, unknown>[] = [article, breadcrumb];

  if (post.dataset) {
    graph.push({
      "@type": "Dataset",
      name: post.dataset.label,
      description: post.dataset.description,
      url,
      datePublished: post.dataset.publishedAt,
      license:
        post.dataset.license === "MIT" || post.dataset.license === undefined
          ? "https://opensource.org/licenses/MIT"
          : post.dataset.license,
      creator: { "@type": "Organization", name: "LLM Vibes", url: BASE_URL },
      distribution: [
        { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${BASE_URL}${post.dataset.path}` },
      ],
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function buildModelJsonLd(slug: string, name: string): Record<string, unknown> {
  // Mirrors the BreadcrumbList in src/pages/ModelDetail.tsx's useHead call.
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${BASE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Dashboard", item: `${BASE_URL}/dashboard` },
      { "@type": "ListItem", position: 3, name, item: `${BASE_URL}/model/${slug}` },
    ],
  };
}

function buildRoutes(): RouteMeta[] {
  const defaultOgImage = `${BASE_URL}/og-image.png`;

  const articles: RouteMeta[] = RESEARCH_POSTS.map((post) => ({
    path: `/research/${post.slug}`,
    // Mirrors the useHead call in src/pages/ResearchPost.tsx.
    title: `${post.title} — LLM Vibes`,
    description: post.metaDescription ?? post.summary,
    ogImage: post.ogImage ? `${BASE_URL}${post.ogImage}` : defaultOgImage,
    ogType: "article",
    article: {
      publishedTime: post.publishedAt,
      modifiedTime: post.updatedAt ?? post.publishedAt,
      author: post.author,
    },
    jsonLd: buildArticleJsonLd(post),
  }));

  const models: RouteMeta[] = Object.entries(MODEL_NAMES).map(([slug, name]) => ({
    path: `/model/${slug}`,
    // Mirrors the useHead call in src/pages/ModelDetail.tsx.
    title: `${name} Vibes — LLM Vibes`,
    description: `Latest community sentiment and complaint trends for ${name}.`,
    ogImage: defaultOgImage,
    ogType: "website",
    jsonLd: buildModelJsonLd(slug, name),
  }));

  const indexes: RouteMeta[] = [
    {
      path: "/dashboard",
      // Mirrors the useHead call in src/pages/Dashboard.tsx.
      title: "Dashboard — LLM Vibes",
      description: "Latest sentiment scores, trends, and community chatter for Claude, ChatGPT, Gemini, and Grok.",
      ogImage: defaultOgImage,
      ogType: "website",
    },
    {
      path: "/research",
      // Mirrors the useHead call in src/pages/ResearchIndex.tsx.
      title: "Research — LLM Vibes",
      description: "Independent analysis of AI model quality and incidents from the LLM Vibes data set.",
      ogImage: defaultOgImage,
      ogType: "website",
    },
    {
      path: "/rumors",
      // Mirrors the useHead call in src/pages/Rumors.tsx.
      title: "Rumors — LLM Vibes",
      description:
        "Aggregated community chatter about unreleased AI models — what's being discussed, when it's expected, and the signals behind it. Unconfirmed estimates, not forecasts.",
      ogImage: defaultOgImage,
      ogType: "website",
    },
    {
      path: "/privacy",
      // Mirrors the useHead call in src/pages/Privacy.tsx.
      title: "Privacy & data practices — LLM Vibes",
      description:
        "What LLM Vibes collects, how long it keeps it, and how to request removal of a quoted post. No accounts, no cookies, no analytics.",
      ogImage: defaultOgImage,
      ogType: "website",
    },
  ];

  return [...articles, ...models, ...indexes];
}

function transformHtml(template: string, route: RouteMeta): string {
  const url = `${BASE_URL}${route.path}`;
  const title = escapeHtml(route.title);
  const description = escapeHtml(route.description);
  const ogImage = escapeHtml(route.ogImage);

  let html = template;
  html = replaceOnce(html, /<title>[^<]*<\/title>/, () => `<title>${title}</title>`, "<title>");
  html = replaceOnce(html, /(<meta\s+name="description"\s+content=")[^"]*(")/, attrReplacer(description), "meta description");
  html = replaceOnce(html, /(<meta\s+property="og:title"\s+content=")[^"]*(")/, attrReplacer(title), "og:title");
  html = replaceOnce(html, /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/, attrReplacer(title), "twitter:title");
  html = replaceOnce(html, /(<meta\s+property="og:description"\s+content=")[^"]*(")/, attrReplacer(description), "og:description");
  html = replaceOnce(html, /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, attrReplacer(description), "twitter:description");
  html = replaceOnce(html, /(<meta\s+property="og:image"\s+content=")[^"]*(")/, attrReplacer(ogImage), "og:image");
  html = replaceOnce(html, /(<meta\s+name="twitter:image"\s+content=")[^"]*(")/, attrReplacer(ogImage), "twitter:image");
  html = replaceOnce(html, /(<meta\s+property="og:url"\s+content=")[^"]*(")/, attrReplacer(url), "og:url");
  html = replaceOnce(html, /(<meta\s+property="og:type"\s+content=")[^"]*(")/, attrReplacer(route.ogType), "og:type");
  html = replaceOnce(html, /(<link\s+rel="canonical"\s+href=")[^"]*(")/, attrReplacer(url), "canonical");

  const injections: string[] = [
    // Lovable's host serves these files only at their literal .html paths
    // (extensionless URLs always get the SPA shell — verified 2026-06-12), so
    // shared links use the .html form. Normalize the path before React boots
    // so the router matches the clean route and the address bar shows it.
    `<script>(function(){var p=location.pathname;var c=p.replace(/\\/index\\.html$/,"").replace(/\\.html$/,"");if(c!==p)history.replaceState(null,"",(c||"/")+location.search+location.hash)})()</script>`,
  ];
  if (route.article) {
    injections.push(
      `<meta property="article:published_time" content="${escapeHtml(route.article.publishedTime)}">`,
      `<meta property="article:modified_time" content="${escapeHtml(route.article.modifiedTime)}">`,
      `<meta property="article:author" content="${escapeHtml(route.article.author)}">`,
    );
  }
  if (route.jsonLd) {
    // `page-json-ld` is the id useHead manages: on hydration setJsonLd finds
    // this script and replaces its content instead of appending a duplicate.
    const json = JSON.stringify(route.jsonLd).replace(/</g, "\\u003c");
    injections.push(`<script id="page-json-ld" type="application/ld+json">${json}</script>`);
  }
  if (injections.length > 0) {
    html = replaceOnce(html, /<\/head>/, () => `  ${injections.join("\n  ")}\n</head>`, "</head>");
  }

  return html;
}

export function prerenderRoutes(): Plugin {
  let outDir = "dist";
  let root = process.cwd();

  return {
    name: "prerender-routes",
    apply: "build",
    configResolved(config: ResolvedConfig) {
      outDir = config.build.outDir;
      root = config.root;
    },
    closeBundle() {
      const distDir = join(root, outDir);
      const templatePath = join(distDir, "index.html");
      const template = readFileSync(templatePath, "utf-8");

      const routes = buildRoutes();
      let fileCount = 0;
      for (const route of routes) {
        const html = transformHtml(template, route);
        const relative = route.path.replace(/^\//, "");
        // Both URL forms — directory index and flat .html.
        for (const target of [join(distDir, relative, "index.html"), join(distDir, `${relative}.html`)]) {
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, html);
          fileCount += 1;
        }
      }
      this.info(`emitted ${fileCount} static route files for ${routes.length} routes`);
    },
  };
}
