import OpenAI from "openai";
import {
    CHAT_MODEL,
    EMBEDDING_DIMENSIONS,
    EMBEDDING_MODEL,
} from "./ai-config.js";

export { CHAT_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL };

let client: OpenAI | null = null;

function getOpenAIClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY is not configured");
    }

    if (!client) {
        client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    return client;
}

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
