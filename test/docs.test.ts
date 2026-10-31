import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractRecommendations,
  htmlToMarkdown,
  parseSearchResponse,
  readDocumentation,
  recommend,
  searchDocumentation,
  validateDocsUrl,
} from "../src/docs.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

// Hand-written fixture in an OpenSearch-style envelope, one of the
// shapes the AWS documentation search endpoint serves: hits nested
// under hits.hits with their fields under _source.
const SEARCH_JSON = JSON.stringify({
  hits: {
    found: 2,
    hits: [
      {
        _source: {
          title: "Amazon S3 bucket naming rules",
          url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html",
          body: "Bucket names must be <b>unique</b> across all existing bucket names.",
        },
      },
      {
        _source: {
          title: "Creating a bucket",
          url: "/AmazonS3/latest/userguide/creating-bucket.html",
          body: "You can create a bucket in the AWS Management Console.",
        },
      },
    ],
  },
});

const RESULTS_JSON = JSON.stringify({
  results: [
    {
      title: "Lambda execution role",
      url: "https://docs.aws.amazon.com/lambda/latest/dg/lambda-intro-execution-role.html",
      description: "An execution role grants the function permission.",
    },
  ],
});

const PAGE_URL =
  "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html";

const PAGE_HTML = `<!DOCTYPE html>
<html><head><title>Bucket naming rules</title><style>.x{color:red}</style></head>
<body>
<nav><a href="https://docs.aws.amazon.com/nav-only.html">Nav only</a></nav>
<div id="main">
<h1>Bucket naming rules</h1>
<p>Bucket names must follow these rules &amp; be unique.</p>
<ul>
<li>Between 3 and 63 characters long</li>
<li>Only lowercase letters and numbers</li>
</ul>
<h2>Related pages</h2>
<p>See <a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html">Creating a bucket</a> and
<a href="/AmazonS3/latest/userguide/bucketnamingrules.html">this page itself</a> and
<a href="https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html#steps">creating again</a> and
<a href="https://example.com/not-aws.html">an outside page</a>.</p>
<pre>aws s3api create-bucket --bucket my-bucket</pre>
<script>var hidden = "should not appear";</script>
</div>
</body></html>`;

function okResponse(body: string): HttpResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: { get: () => "text/html; charset=utf-8" },
    text: async () => body,
  };
}

/** Fake fetch: records the requested URL, serves fixtures by host/path. */
function fakeFetch(captured: { url?: string }): FetchFn {
  return async (url: string) => {
    captured.url = url;
    if (url.startsWith("https://search.docs.aws.amazon.com/")) return okResponse(SEARCH_JSON);
    if (url === PAGE_URL) return okResponse(PAGE_HTML);
    return {
      ok: false,
      status: 404,
      statusText: "Not Found",
      headers: { get: () => null },
      text: async () => "missing",
    };
  };
}

describe("validateDocsUrl", () => {
  it("accepts AWS documentation domains and subdomains", () => {
    assert.equal(validateDocsUrl(PAGE_URL), PAGE_URL);
    assert.ok(validateDocsUrl("https://aws.amazon.com/s3/").includes("aws.amazon.com"));
    assert.ok(
      validateDocsUrl("https://docs.aws.amazon.com/en_us/index.html").includes("docs.aws.amazon.com"),
    );
  });

  it("rejects foreign hosts, lookalike hosts, and non-URLs", () => {
    assert.throws(() => validateDocsUrl("https://example.com/x"), /docs\.aws\.amazon\.com/);
    assert.throws(() => validateDocsUrl("https://docs.aws.amazon.com.evil.example/x"), /docs\.aws\.amazon\.com/);
    assert.throws(() => validateDocsUrl("https://evil-docs.aws.amazon.com.attacker.example/x"), /docs\.aws\.amazon\.com/);
    assert.throws(() => validateDocsUrl("not a url"), /not a valid URL/);
    assert.throws(() => validateDocsUrl(""), /non-empty/);
  });
});

describe("search", () => {
  it("parses the OpenSearch-style envelope and relative URLs", () => {
    const results = parseSearchResponse(SEARCH_JSON);
    assert.equal(results.length, 2);
    assert.deepEqual(results[0], {
      title: "Amazon S3 bucket naming rules",
      url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html",
      summary: "Bucket names must be unique across all existing bucket names.",
    });
    assert.equal(
      results[1].url,
      "https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html",
    );
  });

  it("parses a plain results list too", () => {
    const results = parseSearchResponse(RESULTS_JSON);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, "Lambda execution role");
  });

  it("queries the search endpoint with q and size and honours limit", async () => {
    const captured: { url?: string } = {};
    const out = await searchDocumentation(fakeFetch(captured), {
      search_phrase: "s3 bucket naming",
      limit: 1,
    });
    assert.equal(out.results.length, 1);
    assert.ok(captured.url?.startsWith("https://search.docs.aws.amazon.com/search.json?"));
    assert.ok(captured.url?.includes("q=s3+bucket+naming"));
    assert.ok(captured.url?.includes("size=1"));
  });

  it("rejects a blank phrase and a non-JSON response", async () => {
    await assert.rejects(
      () => searchDocumentation(fakeFetch({}), { search_phrase: " " }),
      /non-empty/,
    );
    assert.throws(() => parseSearchResponse("<html>nope</html>"), /non-JSON/);
  });
});

describe("readDocumentation", () => {
  it("converts a page to markdown-style text", async () => {
    const out = await readDocumentation(fakeFetch({}), { url: PAGE_URL });
    assert.ok(out.text.includes("# Bucket naming rules"));
    assert.ok(out.text.includes("## Related pages"));
    assert.ok(out.text.includes("- Between 3 and 63 characters long"));
    assert.ok(out.text.includes("[Creating a bucket](https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html)"));
    assert.ok(out.text.includes("aws s3api create-bucket --bucket my-bucket"));
    assert.ok(out.text.includes("rules & be unique"));
    assert.ok(!out.text.includes("should not appear"));
    assert.ok(!out.text.includes("Nav only"));
    assert.equal(out.start_index, 0);
    assert.equal(out.total_length, out.text.length);
  });

  it("pages with start_index and max_length", async () => {
    const full = await readDocumentation(fakeFetch({}), { url: PAGE_URL });
    const page = await readDocumentation(fakeFetch({}), {
      url: PAGE_URL,
      start_index: 10,
      max_length: 25,
    });
    assert.equal(page.text, full.text.slice(10, 35));
    assert.equal(page.start_index, 10);
    assert.equal(page.total_length, full.total_length);
  });

  it("rejects a non-AWS URL before fetching and propagates 404s", async () => {
    let called = false;
    const fetchFn: FetchFn = async () => {
      called = true;
      return okResponse(PAGE_HTML);
    };
    await assert.rejects(
      () => readDocumentation(fetchFn, { url: "https://example.com/x" }),
      /docs\.aws\.amazon\.com/,
    );
    assert.equal(called, false);
    await assert.rejects(
      () =>
        readDocumentation(fakeFetch({}), {
          url: "https://docs.aws.amazon.com/missing.html",
        }),
      /HTTP 404/,
    );
  });
});

describe("recommend", () => {
  it("collects outbound AWS documentation links, deduped, without self or foreign links", () => {
    const recs = extractRecommendations(PAGE_HTML, PAGE_URL);
    assert.deepEqual(recs, [
      {
        title: "Creating a bucket",
        url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/creating-bucket.html",
      },
    ]);
  });

  it("htmlToMarkdown drops nav and scripts", () => {
    const md = htmlToMarkdown(PAGE_HTML);
    assert.ok(!md.includes("Nav only"));
    assert.ok(!md.includes("should not appear"));
  });

  it("recommend fetches the page and validates the URL first", async () => {
    const out = await recommend(fakeFetch({}), PAGE_URL);
    assert.equal(out.recommendations.length, 1);
    await assert.rejects(() => recommend(fakeFetch({}), "https://example.com/x"), /docs\.aws\.amazon\.com/);
  });
});
