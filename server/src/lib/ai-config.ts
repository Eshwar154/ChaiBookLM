/**
 * Central AI and RAG configuration constants for Chaibook.
 *
 * Used by chat, embeddings, chunking, and conversation memory services.
 */

/** Default chat model when the client or workspace does not specify one. */
export const CHAT_MODEL = "gpt-4o-mini";

/** Allowed chat models exposed to the client and workspace settings. */
export const CHAT_MODELS = ["gpt-4o-mini", "gpt-4o"] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number];

/**
 * Validates and resolves a chat model id, falling back to {@link CHAT_MODEL}.
 *
 * @param model - Model id from client or workspace (may be null/undefined)
 * @returns A supported {@link ChatModelId}
 *
 * @example Input → Output
 * ```ts
 * resolveChatModel("gpt-4o")       // → "gpt-4o"
 * resolveChatModel("invalid")      // → "gpt-4o-mini" (default)
 * resolveChatModel(null)             // → "gpt-4o-mini"
 * ```
 */
export function resolveChatModel(model?: string | null): ChatModelId {
    if (model && CHAT_MODELS.includes(model as ChatModelId)) {
        return model as ChatModelId;
    }

    return CHAT_MODEL;
}

/** OpenAI embedding model used for RAG vector indexing and query embedding. */
export const EMBEDDING_MODEL = "text-embedding-3-small";

/** Vector dimension count — must match Pinecone index configuration. */
export const EMBEDDING_DIMENSIONS = 1536;

/** Target max characters per text chunk during source processing. */
export const CHUNK_SIZE = 1000;

/** Character overlap between consecutive chunks at split boundaries. */
export const CHUNK_OVERLAP = 100;

/** Number of Pinecone chunks to retrieve per chat query. */
export const RAG_TOP_K = 6;

/** Minimum cosine similarity score for a retrieved chunk to be included in context. */
export const RAG_MIN_SCORE = 0.35;

/** Enqueue a conversation summary job every N persisted messages. */
export const CONVERSATION_SUMMARY_INTERVAL = 8;

/** Max recent UI messages sent to the model when a rolling summary exists. */
export const RECENT_MESSAGE_WINDOW = 12;
