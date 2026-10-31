# Changelog

## 0.1.0 (2026-10-26)

- Initial release.
- CLI: `clouddocs search <phrase...>` with `--limit` and `--json`;
  `clouddocs read <url>` with `--max-length` and `--start-index`;
  `clouddocs recommend <url>`.
- MCP server (`clouddocs mcp`, stdio) with three tools:
  `search_documentation`, `read_documentation`, and `recommend`.
- Search uses the official AWS documentation search endpoint; page
  reading converts documentation HTML to markdown-style text with
  offset/length paging.
- Page URLs are validated to the AWS documentation domains
  (docs.aws.amazon.com / aws.amazon.com and subdomains) before any
  fetch, and no API key is used anywhere.
- All HTTP goes through an injectable fetch function, so the test
  suite runs entirely on hand-written fixtures with no network access.
