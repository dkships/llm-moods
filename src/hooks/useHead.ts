import { useEffect } from "react";

interface HeadConfig {
  title: string;
  description?: string;
  url?: string;
  /**
   * Per-route og:image override. Pass a path-relative or absolute URL.
   * Path-relative values are joined to BASE_URL so the meta tag always
   * carries an absolute URL (Twitter and Facebook scrapers require it).
   */
  ogImage?: string;
  /**
   * og:type for the route. Defaults to "website"; research articles
   * pass "article" so social/answer engines classify them correctly.
   */
  ogType?: string;
  /**
   * Optional article metadata. Emitted as article:* Open Graph tags
   * (published/modified time, author) on routes that pass it, and
   * removed automatically on routes that don't.
   */
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
  };
  /**
   * Optional JSON-LD structured data block. Injected into a single
   * <script id="page-json-ld" type="application/ld+json"> tag in the
   * document head. Cleared automatically on routes that don't pass one.
   */
  jsonLd?: Record<string, unknown>;
  /**
   * Mark the route as not-found: emits <meta name="robots" content="noindex">
   * and removes the canonical link (a 404 must not canonicalize to the
   * homepage). Both effects are reset unconditionally on every useHead call —
   * every production route calls useHead, so SPA navigation away from a 404
   * restores the robots-free head and re-creates the canonical.
   */
  noindex?: boolean;
}

const BASE_URL = "https://llmvibes.ai";
const DEFAULT_DESCRIPTION =
  "Updated throughout the day, LLM Vibes tracks community sentiment for Claude, ChatGPT, Gemini, and Grok.";
const DEFAULT_OG_IMAGE = "https://llmvibes.ai/og-image.png";

const JSON_LD_ID = "page-json-ld";

function setMetaContent(selector: string, content: string) {
  const el = document.querySelector<HTMLMetaElement>(selector);
  if (el) el.content = content;
}

/**
 * Set (creating if needed) a property-based meta tag, or remove it when
 * `content` is undefined. Used for og:* / article:* tags that may not
 * exist in the static index.html head.
 */
function setOrRemovePropertyMeta(property: string, content: string | undefined) {
  let el = document.querySelector<HTMLMetaElement>(`meta[property="${property}"]`);
  if (content === undefined) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("property", property);
    document.head.appendChild(el);
  }
  el.content = content;
}

/** Like setOrRemovePropertyMeta, but for name-based metas (robots). */
function setOrRemoveNamedMeta(name: string, content: string | undefined) {
  let el = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (content === undefined) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.content = content;
}

/**
 * Set (creating if needed) or remove the canonical link. Must create-if-missing:
 * a mutate-only setter would leave canonicals dead for the rest of the SPA
 * session after a 404 removed the element.
 */
function setOrRemoveCanonical(href: string | undefined) {
  let el = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (href === undefined) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.href = href;
}

function setJsonLd(data: Record<string, unknown> | undefined) {
  const existing = document.getElementById(JSON_LD_ID);
  if (!data) {
    if (existing) existing.remove();
    return;
  }
  if (existing) {
    existing.textContent = JSON.stringify(data);
    return;
  }
  const script = document.createElement("script");
  script.id = JSON_LD_ID;
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(data);
  document.head.appendChild(script);
}

function resolveOgImage(image?: string): string {
  if (!image) return DEFAULT_OG_IMAGE;
  if (image.startsWith("http://") || image.startsWith("https://")) return image;
  return `${BASE_URL}${image.startsWith("/") ? image : `/${image}`}`;
}

const useHead = ({ title, description, url, ogImage, ogType, article, jsonLd, noindex }: HeadConfig) => {
  useEffect(() => {
    const desc = description ?? DEFAULT_DESCRIPTION;
    const fullUrl = url ? `${BASE_URL}${url}` : BASE_URL;
    const fullOgImage = resolveOgImage(ogImage);

    document.title = title;

    setMetaContent('meta[name="description"]', desc);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', desc);
    setMetaContent('meta[property="og:url"]', fullUrl);
    setMetaContent('meta[property="og:image"]', fullOgImage);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', desc);
    setMetaContent('meta[name="twitter:image"]', fullOgImage);

    setOrRemovePropertyMeta("og:type", ogType ?? "website");
    setOrRemovePropertyMeta("article:published_time", article?.publishedTime);
    setOrRemovePropertyMeta("article:modified_time", article?.modifiedTime);
    setOrRemovePropertyMeta("article:author", article?.author);

    // Both calls run unconditionally so a prior 404's head state can never
    // leak onto a real route (or vice versa) across SPA navigations.
    setOrRemoveNamedMeta("robots", noindex ? "noindex" : undefined);
    setOrRemoveCanonical(noindex ? undefined : fullUrl);
    setJsonLd(jsonLd);
  }, [title, description, url, ogImage, ogType, article, jsonLd, noindex]);
};

export default useHead;
