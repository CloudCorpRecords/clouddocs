# clouddocs

clouddocs is a reading room for AWS documentation. It searches the
official AWS documentation index for a phrase, opens a documentation
page and returns it as clean markdown-style text you can page through
in slices, and suggests the related documentation pages a page points
to. It works from the command line or as an MCP server for agents,
and it needs no AWS account and no API key: everything it reads is
the public documentation site.

Only AWS documentation addresses are accepted for reading and
recommendations — `docs.aws.amazon.com`, `aws.amazon.com`, and their
subdomains. Any other host is refused before a request is made.

## Install

```bash
npx @reneturcios/clouddocs search "s3 bucket naming"
```

Or run the container image:

```bash
docker run -i ghcr.io/cloudcorprecords/clouddocs
```

The container defaults to the MCP server (see below). Pass CLI
arguments to use it as a CLI instead.

## CLI

```bash
# Search the documentation index
clouddocs search "s3 bucket naming rules"
clouddocs search "lambda execution role" --limit 5 --json

# Read a page as markdown-style text, optionally one window of it
clouddocs read https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html
clouddocs read https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html --start-index 5000 --max-length 5000

# Related pages for a documentation page
clouddocs recommend https://docs.aws.amazon.com/AmazonS3/latest/userguide/bucketnamingrules.html

clouddocs --version
```

Exit codes: `0` on success, `1` when a search or fetch fails (the
error names the problem), `2` for usage errors.

## MCP server

One bin serves both faces. The `mcp` subcommand starts a stdio MCP
server:

```bash
npx -y @reneturcios/clouddocs mcp
```

MCP client configuration:

```json
{
  "mcpServers": {
    "clouddocs": {
      "command": "npx",
      "args": ["-y", "@reneturcios/clouddocs", "mcp"]
    }
  }
}
```

### Tools

| Tool | Input | What it returns |
| --- | --- | --- |
| `search_documentation` | `search_phrase` (string, required), `limit` (integer, optional) | Matching documentation pages: title, URL, and a short summary for each. Search runs against the official search endpoint at `search.docs.aws.amazon.com`. |
| `read_documentation` | `url` (string, required), `max_length` (integer, optional), `start_index` (integer, optional) | The page converted to markdown-style text: headings, links, lists, and code blocks preserved, navigation and scripts removed. `start_index` and `max_length` select a window of the converted text so long pages can be read in slices. |
| `recommend` | `url` (string, required) | Related AWS documentation pages for the given page: the documentation pages it links to, in order, de-duplicated. |

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # node test runner over test/*.test.ts, no network (fake fetch fixtures)
npm run dev     # run the CLI from source via tsx
```

## License

MIT — see `LICENSE`.
