import type { Tool, ToolContext, ToolResult } from "../core/types"

function extractTextFromHtml(html: string): string {
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()

  if (text.length > 10000) {
    text = text.slice(0, 10000) + "\n...[truncated]"
  }

  return text
}

export const webFetchTool: Tool = {
  spec: {
    name: "WebFetch",
    description: `Fetch content from a URL and return the text.

Use this to read web pages, documentation, or API responses.
HTML is automatically converted to plain text.
Content is truncated to 10000 characters.`,
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        raw: {
          type: "boolean",
          description: "If true, return raw content without HTML stripping",
        },
      },
      required: ["url"],
    },
  },
  async execute(input, context): Promise<ToolResult> {
    const url = input.url as string
    const raw = input.raw as boolean | undefined

    if (!url) {
      return { output: "Error: url is required", isError: true }
    }

    try {
      new URL(url)
    } catch {
      return { output: `Error: Invalid URL: ${url}`, isError: true }
    }

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 30000)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "CodingAgent/1.0",
          Accept: "text/html,application/json,text/plain,*/*",
        },
      })

      clearTimeout(timeout)

      if (!response.ok) {
        return {
          output: `Error: HTTP ${response.status} ${response.statusText}`,
          isError: true,
        }
      }

      const contentType = response.headers.get("content-type") ?? ""
      let content = await response.text()

      if (!raw && contentType.includes("text/html")) {
        content = extractTextFromHtml(content)
      } else if (content.length > 10000) {
        content = content.slice(0, 10000) + "\n...[truncated]"
      }

      return { output: content }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes("aborted")) {
        return { output: "Error: Request timed out after 30 seconds", isError: true }
      }
      return { output: `Error fetching URL: ${message}`, isError: true }
    }
  },
}
