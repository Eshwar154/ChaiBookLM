import { RAG_MIN_SCORE, RAG_TOP_K } from "../ai-config.js";
import { embedTexts } from "../openai.js";
import {
    queryWorkspaceVectors,
    type VectorMetadata,
} from "../pinecone.js";

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

export function buildRagSystemPrompt(chunks: RetrievedChunk[]) {
    return buildChatSystemPrompt({ chunks });
}

export type UserMemoryContext = string;

export function buildChatSystemPrompt(input: {
    chunks: RetrievedChunk[];
    conversationSummary?: string | null;
    userMemories?: UserMemoryContext[];
}) {
    const sections: string[] = [
        "You are Chaibook, an assistant that helps users learn from their workspace sources.",
    ];

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
            "Answer helpfully from general knowledge and suggest adding or processing sources when appropriate.",
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
