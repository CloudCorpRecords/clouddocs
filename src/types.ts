/**
 * clouddocs types.
 *
 * The tool set mirrors the public AWS documentation surface: a phrase
 * search over the official documentation index, a page reader that
 * returns a documentation page as markdown-style text (optionally a
 * window of it), and a recommender that takes one page and returns
 * related pages. HTTP access is described by a minimal surface so
 * tests can inject a fake fetch and never touch the network.
 */

export interface SearchDocumentationOptions {
  search_phrase: string;
  /** Maximum number of results to return. Defaults to 10. */
  limit?: number;
}

export interface SearchResultItem {
  title: string;
  url: string;
  summary: string;
}

export interface SearchDocumentationResult {
  search_phrase: string;
  results: SearchResultItem[];
}

export interface ReadDocumentationOptions {
  url: string;
  /** Maximum characters of converted text to return. Defaults to 10000. */
  max_length?: number;
  /** Character offset into the converted text to start from. Defaults to 0. */
  start_index?: number;
}

export interface ReadDocumentationResult {
  url: string;
  /** The requested window of the page's converted text. */
  text: string;
  start_index: number;
  /** Total length of the full converted text, for paging decisions. */
  total_length: number;
}

export interface RecommendationItem {
  title: string;
  url: string;
}

export interface RecommendResult {
  url: string;
  recommendations: RecommendationItem[];
}

/** Minimal HTTP response surface so tests can inject fixtures. */
export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: { headers?: Record<string, string>; redirect?: string },
) => Promise<HttpResponse>;
