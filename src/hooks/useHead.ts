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

function setLinkHref(selector: string, href: string) {
  const el = document.querySelector<HTMLLinkElement>(selector);
  if (el) el.href = href;
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

const useHead = ({ title, description, url, ogImage, ogType, article, jsonLd }: HeadConfig) => {
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

    setLinkHref('link[rel="canonical"]', fullUrl);
    setJsonLd(jsonLd);
  }, [title, description, url, ogImage, ogType, article, jsonLd]);
};

export default useHead;
