/**
 * RAG retrieval and chat system prompt construction.
 *
 * Embeds the user query, searches Pinecone, filters by score,
 * and builds the system prompt with retrieved context, memories, and summary.
 */

import { RAG_MIN_SCORE, RAG_TOP_K } from "../ai-config.js";
import { embedTexts } from "../openai.js";
import {
    queryWorkspaceVectors,
    type VectorMetadata,
} from "../pinecone.js";

/** A source chunk returned from Pinecone with similarity score. */
export type RetrievedChunk = {
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
    chunkId: string;
    chunkIndex: number;
    page?: number;
    text: string;
    score: number;
};

/** Citation object stored on assistant messages and shown in the chat UI. */
export type ChatCitation = {
    sourceId: string;
    sourceTitle: string;
    sourceType: string;
    chunkId: string;
    chunkIndex: number;
    page?: number;
    excerpt: string;
    score: number;
};

/**
 * Validates and normalizes raw Pinecone metadata into {@link VectorMetadata}.
 *
 * @param metadata - Loose metadata object from a Pinecone match
 * @returns Typed metadata, or `null` when required fields are missing
 *
 * @example Input → Output
 * ```ts
 * asVectorMetadata({
 *   sourceId: "src_001",
 *   sourceTitle: "ML Notes",
 *   sourceType: "PDF",
 *   chunkId: "chunk_001",
 *   chunkIndex: 0,
 *   text: "Gradient descent..."
 * })
 * // → { workspaceId: "", sourceId: "src_001", sourceTitle: "ML Notes", ... }
 *
 * asVectorMetadata({ invalid: true })
 * // → null
 * ```
 */
function asVectorMetadata(
    metadata: Record<string, unknown> | undefined,
): VectorMetadata | null {
    if (
        !metadata ||
        typeof metadata.sourceId !== "string" ||
        typeof metadata.sourceTitle !== "string" ||
        typeof metadata.sourceType !== "string" ||
        typeof metadata.chunkId !== "string" ||
        typeof metadata.text !== "string"
    ) {
        return null;
    }

    return {
        workspaceId: String(metadata.workspaceId ?? ""),
        sourceId: metadata.sourceId,
        sourceTitle: metadata.sourceTitle,
        sourceType: metadata.sourceType,
        chunkId: metadata.chunkId,
        chunkIndex: Number(metadata.chunkIndex ?? 0),
        text: metadata.text,
        ...(typeof metadata.page === "number" ? { page: metadata.page } : {}),
    };
}

/**
 * Retrieves the most relevant source chunks for a user query via vector search.
 *
 * @param workspaceId - Workspace namespace in Pinecone
 * @param query - User message text to embed and search with
 * @returns Chunks scoring above {@link RAG_MIN_SCORE}, up to {@link RAG_TOP_K}
 *
 * @example Input → Output
 * ```ts
 * await retrieveWorkspaceContext("ws_xyz789", "What is gradient descent?")
 * // → [
 * //   {
 * //     sourceId: "src_001",
 * //     sourceTitle: "ML Notes",
 * //     sourceType: "PDF",
 * //     chunkId: "chunk_003",
 * //     chunkIndex: 2,
 * //     page: 4,
 * //     text: "Gradient descent is an iterative optimization algorithm...",
 * //     score: 0.87
 * //   }
 * // ]
 * ```
 *
 * @example Input → Output (no matches above threshold)
 * ```ts
 * await retrieveWorkspaceContext("ws_xyz789", "unrelated query")
 * // → []
 * ```
 */
export async function retrieveWorkspaceContext(
    workspaceId: string,
    query: string,
): Promise<RetrievedChunk[]> {
    const [embedding] = await embedTexts([query]);
    if (!embedding) {
        return [];
    }

    const matches = await queryWorkspaceVectors(
        workspaceId,
        embedding,
        RAG_TOP_K,
    );

    const chunks: RetrievedChunk[] = [];

    for (const match of matches) {
        if ((match.score ?? 0) < RAG_MIN_SCORE) {
            continue;
        }

        const metadata = asVectorMetadata(
            match.metadata as Record<string, unknown> | undefined,
        );

        if (!metadata) {
            continue;
        }

        chunks.push({
            sourceId: metadata.sourceId,
            sourceTitle: metadata.sourceTitle,
            sourceType: metadata.sourceType,
            chunkId: metadata.chunkId,
            chunkIndex: metadata.chunkIndex,
            page: metadata.page,
            text: metadata.text,
            score: match.score ?? 0,
        });
    }

    return chunks;
}

/**
 * Converts retrieved chunks into citation objects for persistence and UI display.
 *
 * @param chunks - RAG retrieval results
 * @returns Citations with truncated excerpts (max 280 chars)
 *
 * @example Input → Output
 * ```ts
 * toChatCitations([{
 *   sourceId: "src_001",
 *   sourceTitle: "ML Notes",
 *   sourceType: "PDF",
 *   chunkId: "chunk_003",
 *   chunkIndex: 2,
 *   page: 4,
 *   text: "Gradient descent is an iterative optimization algorithm...",
 *   score: 0.87
 * }])
 * // → [{
 * //   sourceId: "src_001",
 * //   sourceTitle: "ML Notes",
 * //   sourceType: "PDF",
 * //   chunkId: "chunk_003",
 * //   chunkIndex: 2,
 * //   page: 4,
 * //   excerpt: "Gradient descent is an iterative optimization algorithm...",
 * //   score: 0.87
 * // }]
 * ```
 */
export function toChatCitations(chunks: RetrievedChunk[]): ChatCitation[] {
    return chunks.map((chunk) => ({
        sourceId: chunk.sourceId,
        sourceTitle: chunk.sourceTitle,
        sourceType: chunk.sourceType,
        chunkId: chunk.chunkId,
        chunkIndex: chunk.chunkIndex,
        page: chunk.page,
        excerpt: chunk.text.slice(0, 280),
        score: chunk.score,
    }));
}

/**
 * Builds a RAG-only system prompt from retrieved chunks (legacy helper).
 *
 * @param chunks - Retrieved source chunks
 * @returns System prompt string with numbered context blocks
 *
 * @example Input → Output
 * ```ts
 * buildRagSystemPrompt([{ sourceTitle: "ML Notes", sourceType: "PDF", text: "...", ... }])
 * // → "You are Chaibook...\n\nRetrieved context:\n[1] ML Notes (PDF)\n..."
 * ```
 */
export function buildRagSystemPrompt(chunks: RetrievedChunk[]) {
    return buildChatSystemPrompt({ chunks });
}

export type UserMemoryContext = string;

/**
 * Builds the full chat system prompt with RAG context, user memories, summary, and web search hints.
 *
 * @param input - Prompt building blocks from chat service
 * @returns Multi-section system prompt string for `streamText`
 *
 * @example Input → Output
 * ```ts
 * buildChatSystemPrompt({
 *   chunks: [{
 *     sourceTitle: "ML Notes",
 *     sourceType: "PDF",
 *     page: 3,
 *     text: "Gradient descent minimizes loss by..."
 *   }],
 *   conversationSummary: "The user has been studying optimization.",
 *   userMemories: ["Prefers concise explanations"],
 *   webSearchEnabled: true
 * })
 * // → "You are Chaibook, an assistant...\n\nYou have access to a web_search tool...\n\nKnown facts about this user...\n\nEarlier conversation summary...\n\nRetrieved context:\n[1] ML Notes (PDF), page 3\nGradient descent minimizes..."
 * ```
 *
 * @example Input → Output (no chunks)
 * ```ts
 * buildChatSystemPrompt({ chunks: [], webSearchEnabled: false })
 * // → "...This workspace has no indexed source content yet...Do not invent citations."
 * ```
 */
export function buildChatSystemPrompt(input: {
    chunks: RetrievedChunk[];
    conversationSummary?: string | null;
    userMemories?: UserMemoryContext[];
    webSearchEnabled?: boolean;
}) {
    const sections: string[] = [
        "You are Chaibook, an assistant that helps users learn from their workspace sources.",
    ];

    if (input.webSearchEnabled) {
        sections.push(
            "You have access to a web_search tool for up-to-date information outside the workspace.",
            "Use it when the user asks about recent events or topics not covered by their sources.",
            "Cite web results inline using [W1], [W2], etc. matching the web result blocks.",
        );
    }

    if (input.userMemories && input.userMemories.length > 0) {
        const memoryBlock = input.userMemories
            .map((memory) => `- ${memory}`)
            .join("\n");

        sections.push(
            "Known facts about this user (use when relevant):",
            memoryBlock,
        );
    }

    if (input.conversationSummary?.trim()) {
        sections.push(
            "Earlier conversation summary:",
            input.conversationSummary.trim(),
        );
    }

    if (input.chunks.length === 0) {
        sections.push(
            "This workspace has no indexed source content yet, or nothing relevant was retrieved.",
            input.webSearchEnabled
                ? "Use web search when needed, or answer from general knowledge."
                : "Answer helpfully from general knowledge and suggest adding or processing sources when appropriate.",
            "Do not invent citations.",
        );
        return sections.join("\n");
    }

    const context = input.chunks
        .map((chunk, index) => {
            const label = `[${index + 1}] ${chunk.sourceTitle} (${chunk.sourceType})${
                chunk.page ? `, page ${chunk.page}` : ""
            }`;
            return `${label}\n${chunk.text}`;
        })
        .join("\n\n");

    sections.push(
        "Use ONLY the retrieved context below when making factual claims about their materials.",
        "If the context is insufficient, say so clearly.",
        "Cite sources inline using [1], [2], etc. matching the numbered context blocks.",
        "Keep answers concise, accurate, and educational.",
        "",
        "Retrieved context:",
        context,
    );

    return sections.join("\n");
}
