import { z } from "zod";
import TurndownService from "turndown";
import { defineTool } from "./tool.js";

// Initialize Turndown for HTML to Markdown conversion
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
});

// Remove script and style tags entirely
turndown.remove(["script", "style", "nav", "footer", "header"]);

export const webfetchTool = defineTool("webfetch", {
  description:
    "Fetch content from a web URL. Returns the page content as markdown. Read-only, no form submission.",
  parameters: z.object({
    url: z.string().describe("The URL to fetch"),
  }),
  async execute(params) {
    const maxLength = 50000;

    try {
      // Fetch the URL
      const response = await fetch(params.url, {
        headers: {
          "User-Agent": "CodingAgent/1.0 (https://github.com/coding-agent)",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      if (!response.ok) {
        return {
          title: params.url,
          output: `HTTP Error: ${response.status} ${response.statusText}`,
          error: true,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const rawContent = await response.text();

      let output: string;

      // Convert to markdown
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        output = turndown.turndown(rawContent);
      } else {
        // For non-HTML content, return as-is
        output = rawContent;
      }

      // Truncate if needed
      if (output.length > maxLength) {
        output =
          output.slice(0, maxLength) +
          `\n\n... (content truncated, ${output.length - maxLength} chars omitted)`;
      }

      return {
        title: params.url,
        output,
        metadata: {
          contentType,
          originalLength: rawContent.length,
          returnedLength: output.length,
        },
      };
    } catch (error) {
      if (error instanceof Error) {
        // Handle specific error types
        if (error.message.includes("ENOTFOUND") || error.message.includes("getaddrinfo")) {
          return {
            title: params.url,
            output: `DNS Error: Could not resolve hostname`,
            error: true,
          };
        }
        if (error.message.includes("ECONNREFUSED")) {
          return {
            title: params.url,
            output: `Connection refused`,
            error: true,
          };
        }
        if (error.message.includes("ETIMEDOUT") || error.message.includes("timeout")) {
          return {
            title: params.url,
            output: `Connection timed out`,
            error: true,
          };
        }
        return {
          title: params.url,
          output: `Error fetching URL: ${error.message}`,
          error: true,
        };
      }
      return {
        title: params.url,
        output: `Error fetching URL: ${String(error)}`,
        error: true,
      };
    }
  },
});
