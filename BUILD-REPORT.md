# clouddocs — Build Report

MCP Rebuild 100, Tier B. Clean-room rebuild of the AWS Labs
documentation MCP server (awslabs.aws-documentation-mcp-server),
built from the public tool spec captured in
`harness/fixtures/aws-documentation-tools-original.json`. The fixture
was created for this build: it is docs-derived from the original
project's public documentation (README / PyPI listing: tool names,
parameter types, required sets), marked `"_source": "docs-derived,
not hand-probed ..."`. Local build only — nothing pushed or
published, and no live network call was made or claimed at any point.

Identity: repo `clouddocs`, npm `@reneturcios/clouddocs`, MCP name
`io.github.CloudCorpRecords/clouddocs`, version `0.1.0`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json` — bin `clouddocs: dist/cli.js`, `mcpName` set,
  scripts build=`tsc` / dev=`tsx src/cli.ts` / test=`tsx --test test/*.test.ts`
- `server.json` — description "Search, read, and get recommendations
  for AWS documentation pages." = **66 chars** (≤100 ✓); npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/clouddocs:0.1.0` carries **no** `version`
  field (verified programmatically)
- `Dockerfile` — node:20-alpine two-stage, ENTRYPOINT
  `node /app/dist/cli.js`, CMD `mcp`, label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/clouddocs"`
- `tsconfig.json` (identical to the fleet template), `.gitignore`,
  `LICENSE` (MIT, Copyright (c) 2026 Rene Turcios), `README.md`
  (fresh text), `CHANGELOG.md` (single 0.1.0 entry, 2026-10-26)
- `src/index.ts`, `src/cli.ts` (`search`, `read`, `recommend`, `mcp`,
  `--version`; exit 2 usage / 1 fetch error), `src/mcp.ts`,
  `src/types.ts`, `src/docs.ts` (core logic, `VERSION = "0.1.0"`)
- `test/docs.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (from the fleet template; image name and smoke-test server name
  changed to clouddocs)

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with explicit
  inputSchema literals: `McpServer`'s zod-to-JSON-Schema conversion
  injects `$schema` / `additionalProperties` keys that are absent from
  the public spec and break exact schema parity. Zod still validates
  every `tools/call`.
- Search queries the official endpoint
  `https://search.docs.aws.amazon.com/search.json` with the phrase as
  `q` and the limit as `size`. The response parser is deliberately
  tolerant of the endpoint's envelopes (plain `results` list,
  `hits` list, OpenSearch-style `hits.hits` with fields under
  `_source` / `field` / `fields`) and resolves site-relative result
  URLs against `docs.aws.amazon.com`.
- `read_documentation` fetches the page and converts its HTML to
  markdown-style text (headings keep level, links keep absolute
  targets, list items and preformatted blocks survive, nav/footer/
  script/style dropped), then returns the window selected by
  `start_index` (default 0) and `max_length` (default 10000).
- **URL validation (docs-derived behaviour):** page URLs for
  `read_documentation` and `recommend` must be on
  `docs.aws.amazon.com` or `aws.amazon.com`, or a subdomain of either;
  lookalike hosts are rejected before any fetch. This matches the
  original server's documented restriction of page inputs to AWS
  documentation domains; it is implemented from the public docs, not
  from a live probe, and is labelled as such here.
- No API key is used anywhere, matching the original.
- All HTTP flows through an injectable `FetchFn` (types.ts). The test
  suite uses a fake fetch returning hand-written fixtures — **no live
  call was performed during this build**.

## Verification (exact outputs)

### 1. Build
```
$ ./node_modules/.bin/tsc ; echo exit=$?
tsc exit=0
```
`dist/` produced, including `dist/cli.js` with the
`#!/usr/bin/env node` shebang.

### 2. Tests
```
$ ./node_modules/.bin/tsx --test test/*.test.ts
ℹ tests 12
ℹ pass 12
ℹ fail 0
```
Covers: URL validation (allowed domains/subdomains accepted; foreign
and lookalike hosts, non-URLs, and empty input rejected), search
response parsing in both envelopes plus relative-URL resolution, the
exact search request (`q` / `size`) and `limit` handling, blank
phrase and non-JSON rejection, HTML-to-markdown conversion (headings,
links, lists, code blocks, entity decoding, nav/script removal),
`start_index` / `max_length` paging, recommendation extraction
(deduped, self and foreign links excluded), and 404 propagation.

### 3. CLI / MCP smoke
`--version` → `0.1.0`. MCP `initialize` / `tools/list` exercised by
the parity harness below (serverInfo name `clouddocs`). CLI commands
against the live AWS endpoints were **not** run (offline build rule
for this wave).

### 4. Parity (harness, from ~/workspace/mcp-rebuild-100/harness/)
```
$ python3 parity.py --original fixtures/aws-documentation-tools-original.json \
    --rebuild "stdio:node /home/hatch/workspace/mcp-rebuild-100/builds/clouddocs/dist/cli.js mcp" \
    --out .../builds/clouddocs/parity-out
verdict=PASS parity_pct=100.0 original_tools=3 rebuild_tools=3 missing=[] extra=[] schema_diffs=[]
(exit 0)
```
Original side is tools-file mode, so `fixture_results` records
`SKIPPED-TOOLS-FILE-MODE` — expected harness semantics, not an error.

## Lockfile status

`package-lock.json` was copied from privatesearch's and edited with
the file edit tool: top-level `name`, root package `name`, and root
package `bin` key changed privatesearch -> clouddocs (dependency
ranges are identical, so the tree is unchanged). **Clean regeneration
(no `node_modules` present) is deferred to the publish wave**; do not
publish from this lockfile as-is. `node_modules` here is a `cp -a`
copy of privatesearch's; `.bin/tsc` / `.bin/tsx` verified working.

## Gaps / honest notes

- No live AWS call was made. The search parser and page converter are
  written against the documented endpoints and hand-written fixtures
  in the envelopes those endpoints are known to serve; if the live
  search response shape has drifted beyond the tolerated envelopes,
  search may return fewer results until adjusted. A live smoke
  belongs to the publish wave.
- **`recommend` is the closest documented public behaviour, not the
  original's hosted data.** The original returns recommendations from
  AWS's own recommendation data for the page. That data source is not
  part of the documented public endpoints used here, so clouddocs
  derives recommendations from the page itself: its outbound links to
  other AWS documentation pages, in document order, de-duplicated,
  with navigation/footer links excluded. The tool contract (one URL
  in, related documentation pages out) is preserved; the ranking and
  coverage will differ from the original's.
- Scope: the original also ships partition-specific surface not in
  this rebuild's spec — `get_available_services` (China partition
  only) and, in later listings, `read_sections` and the optional
  `product_types` / `guide_types` search filters. The rebuild covers
  exactly the three global tools in its spec; the fixture's `_source`
  notes the China-only exclusion.
- The original is a Python/FastMCP server configured through
  environment variables (`AWS_DOCUMENTATION_PARTITION`, log level);
  the rebuild is the fleet's Node/stdio shape and implements the
  global (`aws`) partition behaviour only.
- Container build not exercised locally; the publish-container
  workflow smoke-tests the image at publish time.

## Publish-gate remediation (2026-10-27)

Recorded under Rene's 2026-10-27 decision ("Remediate the 6: add param
descriptions + capability-class vet policy, then re-gate") and
`publish/GATE-POLICY.md`, following the standing Wave 2 remediation
pattern. This is an authorized deviation from the parity-faithful
state: descriptions were added to every tool parameter that lacked
one, in the `src/mcp.ts` schema literals only — parameter names,
types and required lists are unchanged.

- Descriptions added: 6 insertion points, covering 6 served parameter
  occurrences (no shared schema consts in this unit; each insertion
  serves exactly one occurrence). Insertion points:
  `search_documentation` parameters `search_phrase`, `limit`;
  `read_documentation` parameters `url`, `max_length`, `start_index`;
  and `recommend` parameter `url`.
- Rebuild: `npm run build` exit 0; `tsc --noEmit` exit 0; full
  test suite 12/12 pass (tests 12, pass 12, fail 0).
- Parity harness re-run, verbatim: **PARTIAL, parity_pct 50.0** —
  original_tools=3 rebuild_tools=3 missing=[] extra=[]
  schema_diffs=['read_documentation', 'recommend', 'search_documentation'].
  Every one of the 6 schema diffs is a description addition
  (`*.description: present in rebuild but not in original`); 0
  structural diffs. Structural parity proven independently:
  stripping `description` keys from BOTH the pre- and
  post-remediation tools/list deep-equals (strip-proof RESULT: PASS;
  every description present in PRE is byte-identical in POST, and
  the only additions are at inputSchema property paths — 6
  additions, 0 removals). Adjudication: the description-only diff
  is the authorized remediation itself; structural parity is
  unchanged. Full record:
  `publish/parity-remediation/clouddocs/parity.json` and
  `publish/parity-remediation/clouddocs/strip-proof.txt`.
- No publish gate was run in this remediation (no mcpaudit/mcpvet),
  and nothing was published.
