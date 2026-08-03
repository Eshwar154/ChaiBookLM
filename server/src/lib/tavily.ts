/**
 * Tavily web search integration for live chat web search tool.
 *
 * Requires `TAVILY_API_KEY` in the environment.
 */

import { tavily } from "@tavily/core";

export type TavilySearchResult = {
    title: string;
    url: string;
    content: string;
    score?: number;
};

export type TavilySearchResponse = {
    query: string;
    answer?: string;
    results: TavilySearchResult[];
};

let client: ReturnType<typeof tavily> | null = null;

/**
 * Checks whether Tavily web search is available on this server.
 *
 * @returns `true` when `TAVILY_API_KEY` is set
 *
 * @example Input → Output
 * ```ts
 * isTavilyConfigured() // → true (when env var is set)
 * isTavilyConfigured() // → false (when env var is missing)
 * ```
 */
export function isTavilyConfigured() {
    return Boolean(process.env.TAVILY_API_KEY?.trim());
}

/**
 * Returns a singleton Tavily API client.
 *
 * @returns Configured Tavily client
 * @throws When `TAVILY_API_KEY` is missing
 */
function getTavilyClient() {
    const apiKey = process.env.TAVILY_API_KEY?.trim();

    if (!apiKey) {
        throw new Error("TAVILY_API_KEY is not configured");
    }

    if (!client) {
        client = tavily({ apiKey });
    }

    return client;
}

/**
 * Runs a web search query via Tavily for the chat `web_search` tool.
 *
 * @param query - Natural-language search query from the model
 * @returns Normalized search response with up to 5 results and optional answer summary
 * @throws When `TAVILY_API_KEY` is not configured
 *
 * @example Input → Output
 * ```ts
 * await searchWeb("latest OpenAI model releases 2026")
 * // → {
 * //   query: "latest OpenAI model releases 2026",
 * //   answer: "OpenAI released...",
 * //   results: [{
 * //     title: "OpenAI Blog",
 * //     url: "https://openai.com/blog/...",
 * //     content: "Today we announced...",
 * //     score: 0.92
 * //   }]
 * // }
 * ```
 */
export async function searchWeb(query: string): Promise<TavilySearchResponse> {
    const response = await getTavilyClient().search(query, {
        searchDepth: "basic",
        maxResults: 5,
        includeAnswer: true,
    });

    return {
        query,
        answer:
            typeof response.answer === "string" ? response.answer : undefined,
        results: (response.results ?? []).map((result) => ({
            title: result.title ?? result.url ?? "Untitled",
            url: result.url ?? "",
            content: result.content ?? "",
            score: result.score,
        })),
    };
}

/**
 * Formats Tavily results into a prompt block for the chat model.
 *
 * Results are labeled `[W1]`, `[W2]`, etc. for inline citation in assistant replies.
 *
 * @param response - Normalized Tavily search response
 * @returns Multi-line string injected into the tool result
 *
 * @example Input → Output
 * ```ts
 * formatTavilyResultsForPrompt({
 *   query: "React 19 features",
 *   answer: "React 19 adds server components improvements.",
 *   results: [{
 *     title: "React Blog",
 *     url: "https://react.dev/blog",
 *     content: "React 19 is here..."
 *   }]
 * })
 * // → "Web search results:\n\nSummary: React 19 adds...\n\n[W1] React Blog (https://react.dev/blog)\nReact 19 is here..."
 * ```
 *
 * @example Input → Output (no results)
 * ```ts
 * formatTavilyResultsForPrompt({ query: "xyz", results: [] })
 * // → "No web results were found."
 * ```
 */
export function formatTavilyResultsForPrompt(
    response: TavilySearchResponse,
): string {
    if (response.results.length === 0) {
        return "No web results were found.";
    }

    const blocks = response.results.map((result, index) => {
        return `[W${index + 1}] ${result.title} (${result.url})\n${result.content}`;
    });

    const parts = ["Web search results:"];

    if (response.answer) {
        parts.push(`Summary: ${response.answer}`);
    }

    parts.push(blocks.join("\n\n"));

    return parts.join("\n\n");
}
