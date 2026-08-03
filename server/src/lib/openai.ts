/**
 * OpenAI SDK client for embeddings (RAG indexing and query embedding).
 *
 * Chat generation uses the AI SDK (`@ai-sdk/openai`) instead of this client.
 * Requires `OPENAI_API_KEY` in the environment.
 */

import OpenAI from "openai";
import {
    CHAT_MODEL,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
} from "./ai-config.js";

export { CHAT_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL };

let client: OpenAI | null = null;

/**
 * Returns a singleton OpenAI SDK client.
 *
 * @returns Configured `OpenAI` instance
 * @throws When `OPENAI_API_KEY` is missing
 *
 * @example Input → Output
 * ```ts
 * const openai = getOpenAIClient();
 * // → OpenAI { apiKey: "sk-...", ... }
 * ```
 */
function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured");
    }

    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    return client;
}

/**
 * Creates embedding vectors for one or more text strings.
 *
 * Used during source indexing (`embedAndIndexSource`) and RAG query embedding
 * (`retrieveWorkspaceContext`).
 *
 * @param texts - Strings to embed (empty array returns immediately)
 * @returns Embedding vectors in the same order as input texts (1536 dimensions each)
 * @throws When `OPENAI_API_KEY` is not configured
 *
 * @example Input → Output
 * ```ts
 * await embedTexts(["What is gradient descent?", "Neural networks overview"])
 * // → [
 * //   [0.012, -0.034, 0.056, ...],  // 1536 floats for query 1
 * //   [0.008, -0.021, 0.041, ...]   // 1536 floats for query 2
 * // ]
 * ```
 *
 * @example Input → Output (empty)
 * ```ts
 * await embedTexts([])
 * // → []
 * ```
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
        return [];
    }

    const openai = getOpenAIClient();
    const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: texts,
        dimensions: EMBEDDING_DIMENSIONS,
    });

    return response.data
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
}

export { getOpenAIClient };
