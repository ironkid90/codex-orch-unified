import type { Tool, ToolContext, ToolResult } from "./types";

/**
 * Web search tool — uses Tavily or Bing depending on env vars.
 * Falls back to a stub if no API key is configured.
 */
export const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web for current information, news, documentation, or any query. Returns a list of relevant results with titles, URLs, and snippets.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to look up on the web.",
      },
      max_results: {
        type: "number",
        description: "Maximum number of results to return (default 5, max 10).",
      },
    },
    required: ["query"],
  },
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const query = String(args.query || "");
    const maxResults = Math.min(Number(args.max_results) || 5, 10);

    if (!query.trim()) {
      return { success: false, output: "Query is required for web_search." };
    }

    // Try Tavily first
    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey) {
      try {
        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": tavilyKey },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            search_depth: "basic",
            include_answer: true,
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json() as {
            answer?: string;
            results?: Array<{ title: string; url: string; content: string; score: number }>;
          };
          const results = (data.results || []).slice(0, maxResults).map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.content?.slice(0, 300),
            score: r.score,
          }));
          return {
            success: true,
            output: JSON.stringify({
              provider: "tavily",
              query,
              answer: data.answer,
              results,
            }, null, 2),
          };
        }
      } catch {
        // Fall through to Bing
      }
    }

    // Try Bing
    const bingKey = process.env.BING_SEARCH_API_KEY || process.env.BING_API_KEY;
    if (bingKey) {
      try {
        const url = new URL("https://api.bing.microsoft.com/v7.0/search");
        url.searchParams.set("q", query);
        url.searchParams.set("count", String(maxResults));
        url.searchParams.set("mkt", "en-US");
        const res = await fetch(url.toString(), {
          headers: { "Ocp-Apim-Subscription-Key": bingKey },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json() as {
            webPages?: {
              value?: Array<{ name: string; url: string; snippet: string }>;
            };
          };
          const results = (data.webPages?.value || []).slice(0, maxResults).map((r) => ({
            title: r.name,
            url: r.url,
            snippet: r.snippet?.slice(0, 300),
          }));
          return {
            success: true,
            output: JSON.stringify({ provider: "bing", query, results }, null, 2),
          };
        }
      } catch {
        // Fall through
      }
    }

    // Stub fallback
    return {
      success: false,
      output: JSON.stringify({
        error: "No web search API key configured. Set TAVILY_API_KEY or BING_SEARCH_API_KEY to enable live web search.",
        query,
        hint: "Add TAVILY_API_KEY=<key> to .env.local for web search support.",
      }, null, 2),
    };
  },
};

/**
 * URL fetch tool — fetches and extracts text from a URL.
 */
export const fetchUrlTool: Tool = {
  name: "fetch_url",
  description: "Fetch the content of a URL and return the text. Useful for reading documentation, articles, or API responses.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch.",
      },
      max_chars: {
        type: "number",
        description: "Maximum characters to return (default 4000).",
      },
    },
    required: ["url"],
  },
  async execute(args: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> {
    const url = String(args.url || "");
    const maxChars = Math.min(Number(args.max_chars) || 4000, 20000);

    if (!url.trim() || !url.startsWith("http")) {
      return { success: false, output: "A valid http/https URL is required." };
    }

    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "CodexOrchestrator/1.0 (research agent)" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) {
        return { success: false, output: `HTTP ${res.status} for ${url}` };
      }
      const contentType = res.headers.get("content-type") || "";
      const text = await res.text();

      let extracted = text;
      // Strip HTML tags for cleaner output
      if (contentType.includes("text/html")) {
        extracted = text
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
      }

      return {
        success: true,
        output: extracted.slice(0, maxChars) + (extracted.length > maxChars ? `\n...[truncated at ${maxChars} chars]` : ""),
      };
    } catch (err) {
      return {
        success: false,
        output: `Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const WEB_TOOLS: Tool[] = [webSearchTool, fetchUrlTool];
