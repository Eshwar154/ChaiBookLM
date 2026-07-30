export const CHAT_MODEL = "gpt-4o-mini";
export const CHAT_MODELS = ["gpt-4o-mini", "gpt-4o"] as const;
export type ChatModelId = (typeof CHAT_MODELS)[number];

export function resolveChatModel(model?: string | null): ChatModelId {
    if (model && CHAT_MODELS.includes(model as ChatModelId)) {
        return model as ChatModelId;
    }

    return CHAT_MODEL;
}
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

export const CHUNK_SIZE = 1000;
export const CHUNK_OVERLAP = 100;

export const RAG_TOP_K = 6;
export const RAG_MIN_SCORE = 0.35;

export const CONVERSATION_SUMMARY_INTERVAL = 8;
export const RECENT_MESSAGE_WINDOW = 12;
