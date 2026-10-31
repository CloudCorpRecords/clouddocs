/**
 * clouddocs core: search, read, and get recommendations for AWS
 * documentation.
 *
 * Search goes to the official AWS documentation search endpoint
 * (https://search.docs.aws.amazon.com/search.json) with the phrase as
 * `q` and the result limit as `size`. Reading fetches the page itself
 * and reduces its HTML to markdown-style text: headings keep their
 * level, links keep their targets, list items and code blocks survive,
 * and navigation/script/style material is dropped. Reading supports
 * paging through a long page with a start offset and a maximum length.
 * Recommendations are the documentation pages a page itself points
 * to, collected from its outbound AWS documentation links.
 *
 * Following the original server's behaviour, page URLs handed to the
 * reader and the recommender must belong to the AWS documentation
 * domains (docs.aws.amazon.com or aws.amazon.com, or a subdomain of
 * either); anything else is rejected before any request is made. No
 * API key is used anywhere.
 *
 * All HTTP goes through an injected FetchFn so the logic is fully
 * testable offline with hand-written fixtures. See BUILD-REPORT.md
 * for the honest fidelity notes, including how recommendations differ
 * from the original's hosted recommendation data.
 */
import type {
  FetchFn,
  ReadDocumentationOptions,
  ReadDocumentationResult,
  RecommendResult,
  RecommendationItem,
  SearchDocumentationOptions,
  SearchDocumentationResult,
  SearchResultItem,
} from "./types.js";

export const VERSION = "0.1.0";

export const SEARCH_ENDPOINT = "https://search.docs.aws.amazon.com/search.json";

export const DEFAULT_SEARCH_LIMIT = 10;
export const DEFAULT_MAX_LENGTH = 10000;

export const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const ALLOWED_HOSTS = ["docs.aws.amazon.com", "aws.amazon.com"];

/** True when a hostname is an allowed AWS documentation host. */
export function isAllowedDocsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return ALLOWED_HOSTS.some((base) => host === base || host.endsWith(`.${base}`));
}

/**
 * Validate a documentation page URL the way the original server does:
 * it must parse, and its host must be an AWS documentation domain.
 * Returns the normalised URL string on success.
 */
export function validateDocsUrl(url: string): string {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) throw new Error("url must be a non-empty string");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`url is not a valid URL: ${JSON.stringify(url)}`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(`url must use http or https, got: ${parsed.protocol}`);
  }
  if (!isAllowedDocsHost(parsed.hostname)) {
    throw new Error(
      `url must be on docs.aws.amazon.com or aws.amazon.com, got host: ${parsed.hostname}`,
    );
  }
  return parsed.href;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "(c)",
  mdash: "--",
  ndash: "-",
  hellip: "...",
  lsquo: "'",
  rsquo: "'",
  ldquo: '"',
  rdquo: '"',
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

export function stripTags(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function attrValue(tag: string, name: string): string {
  const dbl = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  if (dbl) return dbl[1];
  const sgl = new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, "i").exec(tag);
  return sgl ? sgl[1] : "";
}

/**
 * Reduce an AWS documentation HTML page to markdown-style text.
 * Headings become `#` lines, anchors become `[text](href)` when the
 * target is absolute, list items become `- ` lines, and preformatted
 * blocks are kept as-is between the surrounding paragraphs.
 */
export function htmlToMarkdown(html: string): string {
  let out = html;
  out = out.replace(/<!--[\s\S]*?-->/g, " ");
  out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ");
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ");
  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ");
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, " ");
  out = out.replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi, " ");
  out = out.replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi, " ");

  // Preserve preformatted blocks behind placeholders while the rest
  // of the markup is flattened.
  const preBlocks: string[] = [];
  out = out.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre\s*>/gi, (_whole, inner: string) => {
    preBlocks.push(decodeEntities(inner.replace(/<[^>]*>/g, "")).trim());
    return `\n\u0000PRE${preBlocks.length - 1}\u0000\n`;
  });

  out = out.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_w, level: string, inner: string) => {
    return `\n${"#".repeat(Number(level))} ${stripTags(inner)}\n`;
  });
  out = out.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, (_w, attrs: string, inner: string) => {
    const href = decodeEntities(attrValue(attrs, "href"));
    const label = stripTags(inner);
    if (!label) return "";
    if (/^https?:\/\//i.test(href)) return `[${label}](${href})`;
    return label;
  });
  out = out.replace(/<li\b[^>]*>/gi, "\n- ");
  out = out.replace(/<br\b[^>]*>/gi, "\n");
  out = out.replace(
    /<\/(?:p|div|section|article|main|ul|ol|table|tr|blockquote)\s*>/gi,
    "\n",
  );
  out = out.replace(/<[^>]*>/g, "");
  out = decodeEntities(out);
  out = out.replace(/\u0000PRE(\d+)\u0000/g, (_w, idx: string) => {
    return `\n\`\`\`\n${preBlocks[Number(idx)] ?? ""}\n\`\`\`\n`;
  });
  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .filter((line, idx, arr) => line.trim().length > 0 || (idx > 0 && arr[idx - 1].trim().length > 0))
    .join("\n")
    .trim();
}

async function getBody(fetchFn: FetchFn, url: string): Promise<string> {
  let response;
  try {
    response = await fetchFn(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json,*/*" },
      redirect: "follow",
    });
  } catch (err) {
    throw new Error(
      `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  return response.text();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

/**
 * Normalise one raw search hit. The search endpoint's hits have been
 * served in a few envelopes over time (a plain results list, and an
 * OpenSearch-style hits list whose entries nest the fields); this
 * reads title / URL / summary from whichever nesting is present and
 * resolves site-relative URLs against the documentation host.
 */
export function normalizeSearchHit(raw: unknown): SearchResultItem | null {
  const hit = asRecord(raw);
  const fields = Object.keys(asRecord(hit._source)).length > 0
    ? asRecord(hit._source)
    : Object.keys(asRecord(hit.field)).length > 0
      ? asRecord(hit.field)
      : Object.keys(asRecord(hit.fields)).length > 0
        ? asRecord(hit.fields)
        : hit;
  const title = firstString(fields, ["title", "headline", "name"]);
  let url = firstString(fields, ["url", "link", "href"]);
  const summary = stripTags(firstString(fields, ["body", "description", "summary", "abstract"]));
  if (!url) return null;
  if (url.startsWith("/")) url = `https://docs.aws.amazon.com${url}`;
  return { title, url, summary };
}

/** Extract the hit list from a search endpoint response body. */
export function parseSearchResponse(body: string): SearchResultItem[] {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error("AWS documentation search returned a non-JSON response");
  }
  const root = asRecord(data);
  let rawHits: unknown[] = [];
  if (Array.isArray(root.results)) rawHits = root.results;
  else if (Array.isArray(root.hits)) rawHits = root.hits;
  else if (Array.isArray(asRecord(root.hits).hits)) rawHits = asRecord(root.hits).hits as unknown[];
  const items: SearchResultItem[] = [];
  for (const raw of rawHits) {
    const item = normalizeSearchHit(raw);
    if (item) items.push(item);
  }
  return items;
}

/** Search AWS documentation for a phrase. */
export async function searchDocumentation(
  fetchFn: FetchFn,
  options: SearchDocumentationOptions,
): Promise<SearchDocumentationResult> {
  const phrase =
    typeof options.search_phrase === "string" ? options.search_phrase.trim() : "";
  if (!phrase) throw new Error("search_phrase must be a non-empty string");
  const limit =
    options.limit !== undefined && Number.isFinite(options.limit)
      ? Math.max(1, Math.floor(options.limit))
      : DEFAULT_SEARCH_LIMIT;
  const params = new URLSearchParams({ q: phrase, size: String(limit) });
  const body = await getBody(fetchFn, `${SEARCH_ENDPOINT}?${params.toString()}`);
  return { search_phrase: phrase, results: parseSearchResponse(body).slice(0, limit) };
}

/** Fetch a documentation page and return a window of its converted text. */
export async function readDocumentation(
  fetchFn: FetchFn,
  options: ReadDocumentationOptions,
): Promise<ReadDocumentationResult> {
  const url = validateDocsUrl(options.url);
  const maxLength =
    options.max_length !== undefined && Number.isFinite(options.max_length)
      ? Math.max(1, Math.floor(options.max_length))
      : DEFAULT_MAX_LENGTH;
  const startIndex =
    options.start_index !== undefined && Number.isFinite(options.start_index)
      ? Math.max(0, Math.floor(options.start_index))
      : 0;
  const full = htmlToMarkdown(await getBody(fetchFn, url));
  return {
    url,
    text: full.slice(startIndex, startIndex + maxLength),
    start_index: startIndex,
    total_length: full.length,
  };
}

/**
 * Collect the pages a documentation page recommends by linking to
 * them: its outbound links to other AWS documentation pages, in
 * document order, de-duplicated, and excluding the page itself.
 */
export function extractRecommendations(html: string, pageUrl: string): RecommendationItem[] {
  // Navigation and footer link farms are not recommendations.
  const body = html
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav\s*>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer\s*>/gi, " ");
  const recommendations: RecommendationItem[] = [];
  const seen = new Set<string>();
  const self = pageUrl.replace(/#.*$/, "");
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(body)) !== null) {
    const href = decodeEntities(attrValue(m[1], "href"));
    if (!href) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (!isAllowedDocsHost(resolved.hostname)) continue;
    const clean = resolved.href.replace(/#.*$/, "");
    if (clean === self || seen.has(clean)) continue;
    seen.add(clean);
    recommendations.push({ title: stripTags(m[2]), url: clean });
  }
  return recommendations;
}

/** Return the related documentation pages for one documentation page. */
export async function recommend(
  fetchFn: FetchFn,
  url: string,
): Promise<RecommendResult> {
  const target = validateDocsUrl(url);
  const html = await getBody(fetchFn, target);
  return { url: target, recommendations: extractRecommendations(html, target) };
}
