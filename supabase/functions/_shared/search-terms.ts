// Rumor search terms derived from the live rumors radar, so the scrapers'
// leak queries follow the radar instead of a hand-kept list that goes stale.
//
//   model_rumors (unreleased, credible, seen ≤30 d)
//        │  rumorSearchTerms()
//        ▼
//   [{ "Grok 4.8", version }, { "Aurora OpenAI", codename }]
//        ├─▶ Bluesky: one search request per term (words are ANDed)
//        └─▶ X: expandRumorPlaceholder() fills {ACTIVE_RUMORS} in the rumor lane
//
// A model that ships flips its row to is_released, so its term drops out on the
// next run. New codenames are still discovered through the brand terms, the
// leaker roundup lane and the generic leak lexicon, none of which go stale.

export interface RumorRow {
  model_slug: string;
  version_label: string | null;
  codename: string | null;
}

export type RumorTermKind = "version" | "codename";

export interface RumorTerm {
  text: string;
  kind: RumorTermKind;
}

export const RUMOR_PLACEHOLDER = "{ACTIVE_RUMORS}";
export const MAX_RUMOR_TERMS = 6;
const RUMOR_LOOKBACK_DAYS = 30;
const RUMOR_ROWS_SCANNED = 25;

// Bare codenames are common words ("Aurora", "Helix"), so they are searched
// together with the vendor's name.
const VENDOR_WORD: Record<string, string> = {
  chatgpt: "OpenAI",
  claude: "Anthropic",
  gemini: "Gemini",
  grok: "xAI",
};

function termFor(row: RumorRow): RumorTerm | null {
  const label = row.version_label?.trim() ?? "";
  // A label without a number ("GPT") would match the whole brand.
  if (/\d/.test(label)) {
    return { text: label, kind: "version" };
  }

  const codename = row.codename?.trim() ?? "";
  const vendor = VENDOR_WORD[row.model_slug];
  if (!codename || !vendor) {
    return null;
  }
  const text = codename.toLowerCase().includes(vendor.toLowerCase()) ? codename : `${codename} ${vendor}`;
  return { text, kind: "codename" };
}

export function rumorSearchTerms(rows: RumorRow[], limit: number = MAX_RUMOR_TERMS): RumorTerm[] {
  const terms: RumorTerm[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const term = termFor(row);
    if (!term) {
      continue;
    }
    const key = term.text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(term);
    if (terms.length >= limit) {
      break;
    }
  }
  return terms;
}

// X search syntax: a version label is an exact phrase, a codename pair is an AND
// group. With no live rumor the placeholder and its trailing OR are removed.
export function expandRumorPlaceholder(query: string, terms: RumorTerm[]): string {
  if (!query.includes(RUMOR_PLACEHOLDER)) {
    return query;
  }
  if (terms.length === 0) {
    return query.replace(/\{ACTIVE_RUMORS\}\s+OR\s+/, "").replace(RUMOR_PLACEHOLDER, "");
  }

  const rendered = terms.map((t) => (t.kind === "version" ? `"${t.text}"` : `(${t.text})`));
  return query.replace(RUMOR_PLACEHOLDER, `(${rendered.join(" OR ")})`);
}

// Never throws: a radar read failure must not stop a scrape, it only means this
// run searches without rumor terms.
export async function loadRumorTerms(supabase: any, limit: number = MAX_RUMOR_TERMS): Promise<RumorTerm[]> {
  const since = new Date(Date.now() - RUMOR_LOOKBACK_DAYS * 24 * 3600 * 1000).toISOString();
  try {
    const { data, error } = await supabase
      .from("model_rumors")
      .select("model_slug, version_label, codename")
      .eq("is_released", false)
      .eq("has_credible_source", true)
      .gte("last_seen_at", since)
      .order("mention_count", { ascending: false })
      .limit(RUMOR_ROWS_SCANNED);
    if (error || !Array.isArray(data)) {
      return [];
    }
    return rumorSearchTerms(data as RumorRow[], limit);
  } catch {
    return [];
  }
}
