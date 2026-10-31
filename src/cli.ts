#!/usr/bin/env node
/**
 * clouddocs CLI.
 *
 *   clouddocs search <phrase...> [--limit n] [--json]
 *   clouddocs read <url> [--max-length n] [--start-index n]
 *   clouddocs recommend <url> [--json]
 *   clouddocs mcp
 *
 * Exit codes: 0 success, 1 search/fetch error, 2 usage error.
 */
import { readDocumentation, recommend, searchDocumentation, VERSION } from "./docs.js";
import type { FetchFn } from "./types.js";

function usage(): never {
  console.error(`Usage:
  clouddocs search <phrase...> [--limit n] [--json]
  clouddocs read <url> [--max-length n] [--start-index n]
  clouddocs recommend <url> [--json]
  clouddocs mcp
  clouddocs --version`);
  process.exit(2);
}

function flagValue(args: string[], name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx < 0 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

function withoutFlags(args: string[], valueFlags: string[], boolFlags: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (valueFlags.includes(args[i])) i++;
    else if (!boolFlags.includes(args[i])) out.push(args[i]);
  }
  return out;
}

function parseIntFlag(args: string[], name: string): number | undefined {
  const raw = flagValue(args, name);
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") {
    console.log(VERSION);
    return;
  }
  if (cmd === "mcp") {
    await import("./mcp.js");
    return;
  }
  if (!cmd) usage();
  const fetchFn = globalThis.fetch as unknown as FetchFn;
  try {
    if (cmd === "search") {
      const asJson = rest.includes("--json");
      const phrase = withoutFlags(rest, ["--limit"], ["--json"]).join(" ").trim();
      if (!phrase) usage();
      const result = await searchDocumentation(fetchFn, {
        search_phrase: phrase,
        limit: parseIntFlag(rest, "--limit"),
      });
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.results.length === 0) {
        console.log("No results found.");
      } else {
        for (const r of result.results) {
          console.log(`${r.title}\n  ${r.url}\n  ${r.summary}`);
        }
      }
    } else if (cmd === "read") {
      const [url] = withoutFlags(rest, ["--max-length", "--start-index"], []);
      if (!url) usage();
      const result = await readDocumentation(fetchFn, {
        url,
        max_length: parseIntFlag(rest, "--max-length"),
        start_index: parseIntFlag(rest, "--start-index"),
      });
      console.log(result.text);
    } else if (cmd === "recommend") {
      const asJson = rest.includes("--json");
      const [url] = withoutFlags(rest, [], ["--json"]);
      if (!url) usage();
      const result = await recommend(fetchFn, url);
      if (asJson) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.recommendations.length === 0) {
        console.log("No recommendations found.");
      } else {
        for (const r of result.recommendations) {
          console.log(`${r.title}\n  ${r.url}`);
        }
      }
    } else {
      usage();
    }
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

void main();
