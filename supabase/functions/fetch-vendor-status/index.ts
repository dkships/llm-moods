/**
 * fetch-vendor-status
 *
 * Returns the last ~30 days of public status events for a given vendor:
 *   - anthropic: status.anthropic.com (Atom)
 *   - openai:    status.openai.com    (Atom)
 *   - google:    status.cloud.google.com (JSON)
 *   - xai:       no public feed (returns supported=false)
 *
 * No DB access. No service-role key. Pure outbound HTTP to public URLs,
 * cached for 10 minutes at the CDN.
 */

import { corsHeaders } from "../_shared/utils.ts";

type Vendor = "anthropic" | "openai" | "google" | "xai";
type Severity = "critical" | "major" | "minor" | "maintenance" | "unknown";

interface VendorStatusEvent {
  id: string;
  title: string;
  updatedAt: string;
  summary: string | null;
  url: string | null;
  severity: Severity;
}

interface VendorStatusResponse {
  vendor: Vendor;
  supported: boolean;
  fetchedAt: string;
  events: VendorStatusEvent[];
  message?: string;
  error?: string;
}

const STATUS_URLS: Record<Exclude<Vendor, "xai">, string> = {
  anthropic: "https://status.anthropic.com/history.atom",
  openai: "https://status.openai.com/history.atom",
  google: "https://status.cloud.google.com/incidents.json",
};

const VENDOR_PUBLIC_URL: Record<Vendor, string> = {
  anthropic: "https://status.anthropic.com",
  openai: "https://status.openai.com",
  google: "https://status.cloud.google.com",
  xai: "https://x.ai",
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Unwrap <![CDATA[...]]> sections so their inner text isn't stripped by
 * the subsequent HTML-tag remover. OpenAI's Atom feed wraps every title
 * and summary in CDATA; Anthropic's does not.
 */
function unwrapCdata(text: string): string {
  return text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(html: string): string {
  return unwrapCdata(html)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyAtomSeverity(title: string, summary: string): Severity {
  const haystack = `${title} ${summary}`.toLowerCase();
  if (/scheduled (maintenance|window)/.test(haystack)) return "maintenance";
  if (/(major|critical|outage|down|unavailable|severe)/.test(haystack)) return "major";
  if (/(elevated errors?|degraded|partial|increased latency)/.test(haystack)) return "minor";
  return "unknown";
}

function extractTag(entry: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = entry.match(re);
  if (!match) return null;
  return decodeXmlEntities(match[1]);
}

function extractAttr(entry: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, "i");
  const match = entry.match(re);
  return match ? decodeXmlEntities(match[1]) : null;
}

function parseAtomFeed(xml: string, cutoffMs: number): VendorStatusEvent[] {
  const events: VendorStatusEvent[] = [];
  const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi);
  for (const match of entryMatches) {
    const entry = match[1];
    const id = extractTag(entry, "id") ?? "";
    const titleRaw = extractTag(entry, "title") ?? "";
    const updatedAt = extractTag(entry, "updated") ?? extractTag(entry, "published") ?? "";
    const summaryRaw = extractTag(entry, "summary") ?? extractTag(entry, "content") ?? "";
    const url = extractAttr(entry, "link", "href");

    if (!updatedAt) continue;
    const updatedMs = Date.parse(updatedAt);
    if (Number.isNaN(updatedMs) || updatedMs < cutoffMs) continue;

    const title = stripHtml(titleRaw).slice(0, 200);
    const summary = stripHtml(summaryRaw).slice(0, 500);

    events.push({
      id: id || `${title}-${updatedAt}`,
      title,
      updatedAt: new Date(updatedMs).toISOString(),
      summary: summary || null,
      url,
      severity: classifyAtomSeverity(title, summary),
    });
  }
  return events;
}

interface GoogleIncident {
  id?: string;
  number?: string;
  external_desc?: string;
  begin?: string;
  modified?: string;
  most_recent_update?: { when?: string };
  uri?: string;
  severity?: string;
  status_impact?: string;
  affected_products?: { title: string }[];
}

function classifyGoogleSeverity(severity: string | undefined): Severity {
  switch ((severity ?? "").toLowerCase()) {
    case "high":
      return "major";
    case "medium":
      return "minor";
    case "low":
      return "minor";
    default:
      return "unknown";
  }
}

function parseGoogleIncidents(json: GoogleIncident[], cutoffMs: number): VendorStatusEvent[] {
  // Filter to incidents that mention Gemini / generative AI / Vertex AI products,
  // since the Google Cloud feed covers everything from Compute Engine to Workspace.
  const GEMINI_KEYWORDS = /(gemini|generative|vertex|ai studio|generativelanguage)/i;
  const events: VendorStatusEvent[] = [];
  for (const incident of json) {
    const products = (incident.affected_products ?? []).map((p) => p.title).join(" ");
    const desc = incident.external_desc ?? "";
    if (!GEMINI_KEYWORDS.test(`${products} ${desc}`)) continue;

    const updatedAtRaw = incident.most_recent_update?.when ?? incident.modified ?? incident.begin ?? "";
    const updatedMs = Date.parse(updatedAtRaw);
    if (Number.isNaN(updatedMs) || updatedMs < cutoffMs) continue;

    events.push({
      id: incident.id ?? incident.number ?? `${desc}-${updatedAtRaw}`,
      title: desc.slice(0, 200) || products.slice(0, 200) || "Google Cloud incident",
      updatedAt: new Date(updatedMs).toISOString(),
      summary: products ? `Affected: ${products}` : null,
      url: incident.uri ? `https://status.cloud.google.com${incident.uri}` : null,
      severity: classifyGoogleSeverity(incident.severity),
    });
  }
  return events;
}

async function fetchVendorStatus(vendor: Vendor): Promise<VendorStatusResponse> {
  const fetchedAt = new Date().toISOString();
  const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;

  if (vendor === "xai") {
    return {
      vendor,
      supported: false,
      fetchedAt,
      events: [],
      message: "xAI does not publish a public status feed.",
    };
  }

  const url = STATUS_URLS[vendor];
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "llmvibes-status-fetcher/1.0 (+https://llmvibes.ai)",
        accept: vendor === "google" ? "application/json" : "application/atom+xml, application/xml",
      },
    });
    if (!res.ok) {
      return {
        vendor,
        supported: true,
        fetchedAt,
        events: [],
        error: `Upstream HTTP ${res.status}`,
      };
    }
    const body = await res.text();
    const events =
      vendor === "google"
        ? parseGoogleIncidents(JSON.parse(body) as GoogleIncident[], cutoffMs)
        : parseAtomFeed(body, cutoffMs);
    events.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { vendor, supported: true, fetchedAt, events };
  } catch (e) {
    return {
      vendor,
      supported: true,
      fetchedAt,
      events: [],
      error: `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

const SUPPORTED_VENDORS: Vendor[] = ["anthropic", "openai", "google", "xai"];

function isVendor(value: string): value is Vendor {
  return (SUPPORTED_VENDORS as string[]).includes(value);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let vendor: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      vendor = typeof body?.vendor === "string" ? body.vendor : null;
    } catch {
      // fall through to URL parse
    }
  }
  if (!vendor) {
    const url = new URL(req.url);
    vendor = url.searchParams.get("vendor");
  }

  if (!vendor || !isVendor(vendor)) {
    return new Response(
      JSON.stringify({ error: "Missing or unsupported vendor. Use anthropic, openai, google, or xai." }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const result = await fetchVendorStatus(vendor);
  const responseBody = { ...result, publicUrl: VENDOR_PUBLIC_URL[vendor] };

  return new Response(JSON.stringify(responseBody), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600, stale-while-revalidate=120",
    },
  });
});
