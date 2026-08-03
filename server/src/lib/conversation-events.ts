/**
 * Inngest event helpers for background conversation summarization.
 */

import { inngest } from "../inngest/client.js";

/**
 * Enqueues a conversation summary job to run asynchronously via Inngest.
 *
 * Triggered every {@link CONVERSATION_SUMMARY_INTERVAL} messages during chat.
 *
 * @param input - Conversation and user ids for the summary worker
 * @returns Resolves when the event is accepted by Inngest
 *
 * @example Input → Output
 * ```ts
 * await enqueueConversationSummarize({
 *   conversationId: "conv_001",
 *   userId: "user_abc123"
 * })
 * // → void
 * // Inngest receives: { name: "conversation/summarize", data: { conversationId, userId } }
 * // Worker calls: summarizeConversationById("conv_001", "user_abc123")
 * ```
 */
export async function enqueueConversationSummarize(input: {
    conversationId: string;
    userId: string;
}) {
    await inngest.send({
        name: "conversation/summarize",
        data: input,
    });
}
