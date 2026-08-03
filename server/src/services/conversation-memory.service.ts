import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { CHAT_MODEL } from "../lib/ai-config.js";
import { addMemoriesFromMessages } from "../lib/mem0.js";
import {
    findConversationById,
    updateConversationSummary,
} from "../repositories/conversation.repository.js";
import {
    findMessagesByConversationId,
    countMessagesByConversationId,
} from "../repositories/message.repository.js";
import { NotFoundError } from "../types/app-error.js";

/**
 * Formats stored messages into a plain-text transcript for the summarizer prompt.
 *
 * @param messages - Message rows from the database
 * @returns Transcript string with one `ROLE: content` block per message
 *
 * @example Input → Output
 * ```ts
 * formatMessagesForPrompt([
 *   { role: "USER", content: "What is RAG?" },
 *   { role: "ASSISTANT", content: "RAG stands for..." }
 * ])
 * // → "USER: What is RAG?\n\nASSISTANT: RAG stands for..."
 * ```
 */
function formatMessagesForPrompt(
    messages: Awaited<ReturnType<typeof findMessagesByConversationId>>,
) {
    return messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");
}

/**
 * Generates a rolling conversation summary and syncs recent learnings to Mem0.
 *
 * Called asynchronously (via Inngest) every N messages. The summary replaces
 * older history in chat context; Mem0 receives the last 16 messages for extraction.
 *
 * @param conversationId - Conversation to summarize
 * @param userId - Owner of the conversation (used for Mem0)
 * @returns Updated conversation with `summary` and `summaryMessageCount`
 * @throws {NotFoundError} When the conversation does not exist
 *
 * @example Input → Output
 * ```ts
 * await summarizeConversationById("conv_abc123", "user_xyz789")
 * // → {
 * //   id: "conv_abc123",
 * //   workspaceId: "ws_001",
 * //   title: "What is RAG?",
 * //   summary: "The user asked about RAG and retrieval-augmented generation. ...",
 * //   summaryMessageCount: 20,
 * //   createdAt: Date,
 * //   updatedAt: Date
 * // }
 * ```
 *
 * @example Input → Output (no messages)
 * ```ts
 * await summarizeConversationById("conv_empty", "user_xyz789")
 * // → original conversation unchanged (no summary written)
 * ```
 */
export async function summarizeConversationById(
    conversationId: string,
    userId: string,
) {
    const conversation = await findConversationById(conversationId);

    if (!conversation) {
        throw new NotFoundError("Conversation not found");
    }

    const messages = await findMessagesByConversationId(conversationId);

    if (messages.length === 0) {
        return conversation;
    }

    const transcript = formatMessagesForPrompt(messages);
    const previousSummary = conversation.summary?.trim();

    const { text: summary } = await generateText({
        model: openai(CHAT_MODEL),
        system: [
            "You summarize chat conversations for a learning assistant.",
            "Produce a concise rolling summary covering topics discussed, questions asked,",
            "key insights, and unresolved threads.",
            "Write in third person about the user. Keep it under 250 words.",
        ].join("\n"),
        prompt: [
            previousSummary
                ? `Previous summary:\n${previousSummary}\n`
                : null,
            "Full conversation transcript:",
            transcript,
            "",
            "Write an updated summary that incorporates new messages.",
        ]
            .filter(Boolean)
            .join("\n"),
    });

    const messageCount = await countMessagesByConversationId(conversationId);

    const updated = await updateConversationSummary(conversationId, {
        summary: summary.trim(),
        summaryMessageCount: messageCount,
    });

    const recentMessages = messages.slice(-16).map((message) => ({
        role: message.role.toLowerCase() as "user" | "assistant",
        content: message.content,
    }));

    await addMemoriesFromMessages(userId, recentMessages, {
        source: "learned",
        conversationId,
    });

    return updated;
}
