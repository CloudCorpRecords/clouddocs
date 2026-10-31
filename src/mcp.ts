/**
 * clouddocs MCP server. Tools: search_documentation, read_documentation,
 * recommend.
 *
 * Why the low-level Server instead of McpServer: the high-level helper
 * converts zod schemas to JSON Schema and injects keys that are not in
 * this tool's public spec ("$schema" and "additionalProperties"), which
 * breaks exact tool-list/schema parity with the spec. This file serves
 * tools/list with the spec's exact input schemas as explicit literals,
 * while zod still validates every tools/call argument set. Tool names,
 * parameters, and required sets are taken from the public spec.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { readDocumentation, recommend, searchDocumentation, VERSION } from "./docs.js";
import type { FetchFn } from "./types.js";

const SearchArgs = z.object({
  search_phrase: z.string(),
  limit: z.number().int().optional(),
});

const ReadArgs = z.object({
  url: z.string(),
  max_length: z.number().int().optional(),
  start_index: z.number().int().optional(),
});

const RecommendArgs = z.object({
  url: z.string(),
});

const TOOLS = [
  {
    name: "search_documentation",
    description:
      "Search AWS documentation using the official AWS Documentation Search API.",
    inputSchema: {
      type: "object" as const,
      properties: {
        search_phrase: {
          type: "string",
          description: "The search phrase to query AWS documentation for.",
        },
        limit: {
          type: "integer",
          description:
            "Optional maximum number of search results to return; defaults to 10.",
        },
      },
      required: ["search_phrase"],
    },
  },
  {
    name: "read_documentation",
    description: "Fetch an AWS documentation page and convert it to markdown format.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description:
            "URL of the AWS documentation page to fetch; must be on docs.aws.amazon.com or aws.amazon.com, or a subdomain of either.",
        },
        max_length: {
          type: "integer",
          description:
            "Optional maximum number of characters of converted text to return; defaults to 10000.",
        },
        start_index: {
          type: "integer",
          description:
            "Optional character offset into the converted text at which to start returning; defaults to 0.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "recommend",
    description: "Get content recommendations for an AWS documentation page.",
    inputSchema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description:
            "URL of the AWS documentation page to get recommendations for; must be on docs.aws.amazon.com or aws.amazon.com, or a subdomain of either.",
        },
      },
      required: ["url"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "clouddocs", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  try {
    if (name === "search_documentation") {
      const parsed = SearchArgs.parse(args ?? {});
      return textResult(
        await searchDocumentation(fetchFn, {
          search_phrase: parsed.search_phrase,
          limit: parsed.limit,
        }),
      );
    }
    if (name === "read_documentation") {
      const parsed = ReadArgs.parse(args ?? {});
      const result = await readDocumentation(fetchFn, {
        url: parsed.url,
        max_length: parsed.max_length,
        start_index: parsed.start_index,
      });
      return textResult(result.text);
    }
    if (name === "recommend") {
      const parsed = RecommendArgs.parse(args ?? {});
      return textResult(await recommend(fetchFn, parsed.url));
    }
  } catch (err) {
    return errorResult(err);
  }
  throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
