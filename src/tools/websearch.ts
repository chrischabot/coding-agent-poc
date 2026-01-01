import type { Tool, ToolResult } from "../core/types"

interface SearchResult {
  title: string
  url: string
  snippet: string
}

async function searchWithTavily(query: string, limit: number): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY not set")
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: limit,
      include_answer: false,
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily API error: ${response.status}`)
  }

  const data = await response.json()
  return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }))
}

async function searchWithSerper(query: string, limit: number): Promise<SearchResult[]> {
  const apiKey = process.env.SERPER_API_KEY
  if (!apiKey) {
    throw new Error("SERPER_API_KEY not set")
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q: query,
      num: limit,
    }),
  })

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status}`)
  }

  const data = await response.json()
  return (data.organic || []).map((r: { title: string; link: string; snippet: string }) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }))
}

async function searchWithDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
  const encoded = encodeURIComponent(query)
  const response = await fetch(
    `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`,
    {
      headers: {
        "User-Agent": "CodingAgent/1.0",
      },
    }
  )

  if (!response.ok) {
    throw new Error(`DuckDuckGo API error: ${response.status}`)
  }

  const data = await response.json()
  const results: SearchResult[] = []

  if (data.AbstractText) {
    results.push({
      title: data.Heading || "Summary",
      url: data.AbstractURL || "",
      snippet: data.AbstractText,
    })
  }

  for (const topic of data.RelatedTopics || []) {
    if (results.length >= limit) break
    if (topic.Text && topic.FirstURL) {
      results.push({
        title: topic.Text.split(" - ")[0] || "Related",
        url: topic.FirstURL,
        snippet: topic.Text,
      })
    }
  }

  return results
}

export const webSearchTool: Tool = {
  spec: {
    name: "WebSearch",
    description: `Search the web for information.

Supports multiple search providers:
- Tavily (set TAVILY_API_KEY env var)
- Serper/Google (set SERPER_API_KEY env var)
- DuckDuckGo (fallback, no API key needed but limited results)

Use this to find documentation, tutorials, or current information.`,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query",
        },
        limit: {
          type: "number",
          description: "Maximum results to return (default: 5)",
        },
        provider: {
          type: "string",
          enum: ["tavily", "serper", "duckduckgo", "auto"],
          description: "Search provider (default: auto - tries tavily, then serper, then duckduckgo)",
        },
      },
      required: ["query"],
    },
  },
  async execute(input): Promise<ToolResult> {
    const query = input.query as string
    const limit = (input.limit as number) ?? 5
    const provider = (input.provider as string) ?? "auto"

    if (!query) {
      return { output: "Error: query is required", isError: true }
    }

    const providers: Array<{ name: string; fn: () => Promise<SearchResult[]> }> = []

    if (provider === "tavily" || provider === "auto") {
      providers.push({ name: "tavily", fn: () => searchWithTavily(query, limit) })
    }
    if (provider === "serper" || provider === "auto") {
      providers.push({ name: "serper", fn: () => searchWithSerper(query, limit) })
    }
    if (provider === "duckduckgo" || provider === "auto") {
      providers.push({ name: "duckduckgo", fn: () => searchWithDuckDuckGo(query, limit) })
    }

    let lastError = ""
    for (const p of providers) {
      try {
        const results = await p.fn()
        if (results.length === 0) {
          return { output: `No results found for: ${query}`, isError: false }
        }

        const formatted = results
          .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
          .join("\n\n")

        return {
          output: `Search results for "${query}" (via ${p.name}):\n\n${formatted}`,
          isError: false,
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        continue
      }
    }

    return {
      output: `Search failed: ${lastError}\n\nTip: Set TAVILY_API_KEY or SERPER_API_KEY for better results.`,
      isError: true,
    }
  },
}
