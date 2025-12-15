import { z } from "zod";
import { defineTool } from "./tool.js";

export const searchTool = defineTool("search", {
  description:
    "Search the codebase using ripgrep. Returns matching files with line numbers and snippets.",
  parameters: z.object({
    query: z.string().describe("Regex pattern to search for"),
  }),
  async execute(params, ctx) {
    const searchPath = ctx.workingDirectory;

    // Build ripgrep command
    const args: string[] = [
      "--line-number",
      "--with-filename",
      "--heading",
      "--color=never",
      "--max-count",
      "100",
    ];

    args.push("--regexp", params.query);
    args.push(searchPath);

    try {
      const proc = Bun.spawn(["rg", ...args], {
        stdout: "pipe",
        stderr: "pipe",
        cwd: ctx.workingDirectory,
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      // Exit code 1 means no matches (not an error)
      if (exitCode === 1 && !stderr) {
        return {
          title: `search: ${params.query}`,
          output: "No matches found",
          metadata: { matchCount: 0 },
        };
      }

      // Real error
      if (exitCode !== 0 && exitCode !== 1) {
        return {
          title: `search: ${params.query}`,
          output: `ripgrep error: ${stderr}`,
          error: true,
        };
      }

      // Parse results
      const matches = parseRipgrepOutput(stdout);

      return {
        title: `search: ${params.query}`,
        output: formatSearchResults(matches, ctx.workingDirectory),
        metadata: { matchCount: matches.length },
      };
    } catch (error) {
      // Check if ripgrep is available
      if (
        error instanceof Error &&
        error.message.includes("ENOENT")
      ) {
        return {
          title: `search: ${params.query}`,
          output:
            "Error: ripgrep (rg) is not installed. Please install it: https://github.com/BurntSushi/ripgrep#installation",
          error: true,
        };
      }
      return {
        title: `search: ${params.query}`,
        output: `Error: ${error instanceof Error ? error.message : String(error)}`,
        error: true,
      };
    }
  },
});

interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

/**
 * Parse ripgrep output into structured matches
 */
function parseRipgrepOutput(output: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  let currentFile = "";

  for (const line of output.split("\n")) {
    if (!line.trim()) continue;

    // File header (no colon with number)
    if (!line.includes(":") || line.match(/^[^:]+$/)) {
      currentFile = line.trim();
      continue;
    }

    // Match line: "123:content"
    const match = line.match(/^(\d+)[:-](.*)$/);
    if (match && currentFile) {
      matches.push({
        file: currentFile,
        line: parseInt(match[1], 10),
        text: match[2],
      });
    }
  }

  return matches;
}

/**
 * Format search results for display
 */
function formatSearchResults(
  matches: SearchMatch[],
  projectRoot: string
): string {
  if (matches.length === 0) {
    return "No matches found";
  }

  // Group by file
  const byFile = new Map<string, SearchMatch[]>();
  for (const match of matches) {
    const existing = byFile.get(match.file) ?? [];
    existing.push(match);
    byFile.set(match.file, existing);
  }

  const lines: string[] = [];
  const path = require("path");

  for (const [file, fileMatches] of byFile) {
    // Show relative path
    const relativePath = path.relative(projectRoot, file) || file;
    lines.push(`\n${relativePath}:`);
    for (const m of fileMatches.slice(0, 10)) {
      lines.push(`  ${m.line}: ${m.text.slice(0, 200)}`);
    }
    if (fileMatches.length > 10) {
      lines.push(`  ... (${fileMatches.length - 10} more matches in this file)`);
    }
  }

  lines.push(`\n(${matches.length} total matches in ${byFile.size} files)`);

  return lines.join("\n");
}
