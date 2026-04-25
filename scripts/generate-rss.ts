/**
 * Generates public/research/feed.xml from RESEARCH_POSTS at build time.
 * Run via the `prebuild` npm script so every `npm run build` keeps the
 * feed in sync. No runtime dependency at production runtime.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RESEARCH_POSTS, type ResearchPost } from "../src/data/research-posts.ts";

const SITE_URL = "https://llmvibes.ai";
const FEED_TITLE = "LLM Vibes Research";
const FEED_DESCRIPTION =
  "Independent analysis of AI model quality and incidents from the LLM Vibes data set.";
const FEED_LANG = "en-us";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, "../public/research/feed.xml");

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pubDate(iso: string): string {
  // Use 12:00 UTC so all dates are unambiguous regardless of viewing tz.
  return new Date(`${iso}T12:00:00Z`).toUTCString();
}

function renderItem(post: ResearchPost): string {
  const link = `${SITE_URL}/research/${post.slug}`;
  return [
    "    <item>",
    `      <title>${escapeXml(post.title)}</title>`,
    `      <link>${link}</link>`,
    `      <guid isPermaLink="true">${link}</guid>`,
    `      <description>${escapeXml(post.summary)}</description>`,
    `      <author>noreply@llmvibes.ai (${escapeXml(post.author)})</author>`,
    `      <pubDate>${pubDate(post.publishedAt)}</pubDate>`,
    ...post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`),
    "    </item>",
  ].join("\n");
}

function buildFeed(posts: ResearchPost[]): string {
  const sorted = [...posts].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
  const lastBuild = sorted[0] ? pubDate(sorted[0].publishedAt) : new Date().toUTCString();
  const items = sorted.map(renderItem).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "  <channel>",
    `    <title>${escapeXml(FEED_TITLE)}</title>`,
    `    <link>${SITE_URL}/research</link>`,
    `    <atom:link href="${SITE_URL}/research/feed.xml" rel="self" type="application/rss+xml" />`,
    `    <description>${escapeXml(FEED_DESCRIPTION)}</description>`,
    `    <language>${FEED_LANG}</language>`,
    `    <lastBuildDate>${lastBuild}</lastBuildDate>`,
    items,
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

const xml = buildFeed(RESEARCH_POSTS);
mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
writeFileSync(OUTPUT_PATH, xml, "utf8");
console.log(`[generate-rss] wrote ${OUTPUT_PATH} with ${RESEARCH_POSTS.length} posts`);
