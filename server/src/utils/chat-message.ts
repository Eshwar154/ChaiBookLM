/**
 * Helpers for converting between AI SDK UI messages and persisted chat records.
 */

import type { UIMessage } from "ai";
import type { MessageRecord } from "../repositories/message.repository.js";

/**
 * Extracts plain text from an AI SDK {@link UIMessage} by joining all text parts.
 *
 * @param message - UI message with `parts` array
 * @returns Concatenated text from all `type: "text"` parts
 *
 * @example Input → Output
 * ```ts
 * getTextFromUIMessage({
 *   id: "msg_1",
 *   role: "user",
 *   parts: [{ type: "text", text: "What is " }, { type: "text", text: "RAG?" }]
 * })
 *  → "What is RAG?"
 * ```
 */
export function getTextFromUIMessage(message: UIMessage) {
    return message.parts
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
}

/**
 * Finds the most recent non-empty user message text in a UI message array.
 *
 * Walks backwards from the end of the array (supports multi-turn history).
 *
 * @param messages - Full UI message history from the client
 * @returns Latest user message text, or `null` when none found
 *
 * @example Input → Output
 * ```ts
 * getLastUserMessageText([
 *   { role: "user", parts: [{ type: "text", text: "Hello" }] },
 *   { role: "assistant", parts: [{ type: "text", text: "Hi!" }] },
 *   { role: "user", parts: [{ type: "text", text: "What is RAG?" }] }
 * ])
 * // → "What is RAG?"
 * ```
 *
 * @example Input → Output (no user text)
 * ```ts
 * getLastUserMessageText([
 *   { role: "assistant", parts: [{ type: "text", text: "Hi!" }] }
 * ])
 * // → null
 * ```
 */
export function getLastUserMessageText(messages: UIMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message?.role === "user") {
            const text = getTextFromUIMessage(message).trim();
            if (text) {
                return text;
            }
        }
    }

    return null;
}

/**
 * Converts a persisted database message into an AI SDK {@link UIMessage}.
 *
 * Used when hydrating chat history from Postgres into `useChat`.
 *
 * @param message - Message row from the database
 * @returns UI message compatible with AI SDK client
 *
 * @example Input → Output
 * ```ts
 * messageRecordToUIMessage({
 *   id: "msg_001",
 *   role: "USER",
 *   content: "What is gradient descent?",
 *   ...
 * })
 * // → {
 * //   id: "msg_001",
 * //   role: "user",
 * //   parts: [{ type: "text", text: "What is gradient descent?" }]
 * // }
 * ```
 */
export function messageRecordToUIMessage(message: MessageRecord): UIMessage {
    return {
        id: message.id,
        role: message.role === "USER" ? "user" : "assistant",
        parts: [{ type: "text", text: message.content }],
    };
}

/**
 * Builds a short conversation title from the first user message.
 *
 * Truncates to 72 characters with an ellipsis when longer.
 *
 * @param text - Raw user message text
 * @returns Title string for the conversation sidebar
 *
 * @example Input → Output
 * ```ts
 * buildConversationTitle("Explain backpropagation in simple terms please")
 * // → "Explain backpropagation in simple terms please"
 *
 * buildConversationTitle("This is a very long question that exceeds seventy-two characters and should be truncated")
 * // → "This is a very long question that exceeds seventy-two characters and sh…"
 *
 * buildConversationTitle("   ")
 * // → "New chat"
 * ```
 */
export function buildConversationTitle(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "New chat";
    }

    return normalized.length > 72
        ? `${normalized.slice(0, 72).trim()}…`
        : normalized;
}
