/**
 * Chat and conversation business logic.
 *
 * Handles CRUD for conversations/messages and the main RAG chat streaming pipeline:
 *
 * ```
 * User message
 *   → save to DB
 *   → RAG retrieval + Mem0 memories
 *   → streamText (AI SDK) with optional web search tool
 *   → save assistant reply + citations
 *   → optional summary job + Mem0 learning
 * ```
 */

import { openai } from "@ai-sdk/openai";
import type { Response } from "express";
import { z } from "zod";
import {
    convertToModelMessages,
    createUIMessageStream,
    isStepCount,
    pipeUIMessageStreamToResponse,
    streamText,
    toUIMessageStream,
    tool,
    type UIMessage,
} from "ai";
import {
    CONVERSATION_SUMMARY_INTERVAL,
    RECENT_MESSAGE_WINDOW,
    resolveChatModel,
} from "../lib/ai-config.js";
import { enqueueConversationSummarize } from "../lib/conversation-events.js";
import {
    buildChatSystemPrompt,
    retrieveWorkspaceContext,
    toChatCitations,
} from "../lib/rag/retrieve.js";
import {
    createConversationRecord,
    findConversationByIdAndWorkspaceId,
    findConversationsByWorkspaceId,
    touchConversation,
    updateConversationRecord,
    deleteConversationRecord,
} from "../repositories/conversation.repository.js";
import {
    createMessageRecord,
    countMessagesByConversationId,
    findMessagesByConversationId,
} from "../repositories/message.repository.js";
import { addMemoriesFromMessages, searchUserMemories } from "../lib/mem0.js";
import {
    formatTavilyResultsForPrompt,
    isTavilyConfigured,
    searchWeb,
    type TavilySearchResponse,
} from "../lib/tavily.js";
import { NotFoundError, ValidationError } from "../types/app-error.js";
import {
    buildConversationTitle,
    getLastUserMessageText,
    getTextFromUIMessage,
} from "../utils/chat-message.js";
import { getWorkspaceByIdForUser } from "./workspace.service.js";

type WebCitation = {
    sourceType: "WEB";
    sourceTitle: string;
    url: string;
    excerpt: string;
};

/**
 * Converts Tavily search results into citation objects stored on assistant messages.
 *
 * @param response - Raw Tavily API response
 * @returns Web citation array with truncated excerpts
 *
 * @example Input → Output
 * ```ts
 * toWebCitations({
 *   results: [{
 *     title: "React Docs",
 *     url: "https://react.dev",
 *     content: "React is a JavaScript library..."
 *   }]
 * })
 * // → [{
 * //   sourceType: "WEB",
 * //   sourceTitle: "React Docs",
 * //   url: "https://react.dev",
 * //   excerpt: "React is a JavaScript library..." // max 280 chars
 * // }]
 * ```
 */
function toWebCitations(response: TavilySearchResponse): WebCitation[] {
    return response.results.map((result) => ({
        sourceType: "WEB" as const,
        sourceTitle: result.title,
        url: result.url,
        excerpt: result.content.slice(0, 280),
    }));
}

/**
 * Verifies the user owns the workspace before any chat operation proceeds.
 *
 * @param workspaceId - Workspace being accessed
 * @param userId - Authenticated user's id
 * @throws {NotFoundError} When the workspace is not found for this user
 */
async function assertWorkspaceAccess(workspaceId: string, userId: string) {
    await getWorkspaceByIdForUser(workspaceId, userId);
}

/**
 * Lists all conversations in a workspace for the sidebar/history UI.
 *
 * @param workspaceId - Workspace to list conversations from
 * @param userId - Authenticated user's id
 * @returns Conversation records ordered by most recent activity
 *
 * @example Input → Output
 * ```ts
 * await listConversationsForWorkspace("ws_xyz789", "user_abc123")
 * // → [
 * //   {
 * //     id: "conv_001",
 * //     workspaceId: "ws_xyz789",
 * //     title: "What is RAG?",
 * //     summary: "The user asked about retrieval-augmented generation...",
 * //     summaryMessageCount: 20,
 * //     createdAt: Date,
 * //     updatedAt: Date
 * //   }
 * // ]
 * ```
 */
export async function listConversationsForWorkspace(
    workspaceId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return findConversationsByWorkspaceId(workspaceId);
}

/**
 * Creates an empty conversation (optional title).
 *
 * Most chats are created implicitly on first message via {@link streamWorkspaceChat};
 * this endpoint supports explicit "new chat" actions from the UI.
 *
 * @param workspaceId - Workspace to attach the conversation to
 * @param userId - Authenticated user's id
 * @param title - Optional display title
 * @returns New conversation record
 *
 * @example Input → Output
 * ```ts
 * await createConversationForWorkspace("ws_xyz789", "user_abc123", "Study Session")
 * // → {
 * //   id: "conv_new456",
 * //   workspaceId: "ws_xyz789",
 * //   title: "Study Session",
 * //   summary: null,
 * //   summaryMessageCount: null,
 * //   createdAt: Date,
 * //   updatedAt: Date
 * // }
 * ```
 */
export async function createConversationForWorkspace(
    workspaceId: string,
    userId: string,
    title?: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return createConversationRecord(workspaceId, title);
}

/**
 * Loads persisted message history for a conversation.
 *
 * @param workspaceId - Workspace the conversation belongs to
 * @param conversationId - Conversation to load messages for
 * @param userId - Authenticated user's id
 * @returns Message rows with role, content, citations, and timestamps
 * @throws {NotFoundError} When the conversation does not exist in this workspace
 *
 * @example Input → Output
 * ```ts
 * await getConversationMessagesForWorkspace("ws_xyz789", "conv_001", "user_abc123")
 * // → [
 * //   {
 * //     id: "msg_001",
 * //     conversationId: "conv_001",
 * //     role: "USER",
 * //     content: "What is gradient descent?",
 * //     citations: null,
 * //     createdAt: Date
 * //   },
 * //   {
 * //     id: "msg_002",
 * //     role: "ASSISTANT",
 * //     content: "Gradient descent is an optimization algorithm...",
 * //     citations: [{ sourceType: "PDF", sourceTitle: "ML Notes", ... }],
 * //     createdAt: Date
 * //   }
 * // ]
 * ```
 */
export async function getConversationMessagesForWorkspace(
    workspaceId: string,
    conversationId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const conversation = await findConversationByIdAndWorkspaceId(
        conversationId,
        workspaceId,
    );

    if (!conversation) {
        throw new NotFoundError("Conversation not found");
    }

    return findMessagesByConversationId(conversationId);
}

/**
 * Deletes a conversation and all its messages (cascade).
 *
 * @param workspaceId - Workspace the conversation belongs to
 * @param conversationId - Conversation to delete
 * @param userId - Authenticated user's id
 * @returns Resolves when the conversation row is deleted
 * @throws {NotFoundError} When the conversation does not exist
 *
 * @example Input → Output
 * ```ts
 * await deleteConversationForWorkspace("ws_xyz789", "conv_001", "user_abc123")
 * // → void
 * ```
 */
export async function deleteConversationForWorkspace(
    workspaceId: string,
    conversationId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const conversation = await findConversationByIdAndWorkspaceId(
        conversationId,
        workspaceId,
    );

    if (!conversation) {
        throw new NotFoundError("Conversation not found");
    }

    await deleteConversationRecord(conversationId);
}

/**
 * Finds an existing conversation or creates one from the first user message.
 *
 * @param workspaceId - Workspace scope
 * @param conversationId - Existing id from client, or undefined for a new chat
 * @param firstMessage - User text used to auto-generate a title for new conversations
 * @returns Conversation record (existing or newly created)
 * @throws {NotFoundError} When `conversationId` is provided but not found
 *
 * @example Input → Output (existing conversation)
 * ```ts
 * await resolveConversation("ws_xyz789", "conv_001", "Follow-up question")
 * // → { id: "conv_001", title: "What is RAG?", ... }
 * ```
 *
 * @example Input → Output (new conversation)
 * ```ts
 * await resolveConversation("ws_xyz789", undefined, "Explain backpropagation")
 * // → { id: "conv_new789", title: "Explain backpropagation", summary: null, ... }
 * ```
 */
async function resolveConversation(
    workspaceId: string,
    conversationId: string | undefined,
    firstMessage: string,
) {
    if (conversationId) {
        const existing = await findConversationByIdAndWorkspaceId(
            conversationId,
            workspaceId,
        );

        if (!existing) {
            throw new NotFoundError("Conversation not found");
        }

        return existing;
    }

    return createConversationRecord(
        workspaceId,
        buildConversationTitle(firstMessage),
    );
}

/**
 * Limits how many recent UI messages are sent to the model when a summary exists.
 *
 * Older turns are represented by `conversation.summary` instead of full history.
 *
 * @param messages - Full UI message array from the client
 * @param hasSummary - Whether the conversation has a rolling summary
 * @returns All messages, or the last {@link RECENT_MESSAGE_WINDOW} when summarized
 *
 * @example Input → Output (with summary, 30 messages)
 * ```ts
 * trimMessagesForContext(messages, true)
 * // → messages.slice(-RECENT_MESSAGE_WINDOW)  // e.g. last 12 messages
 * ```
 *
 * @example Input → Output (no summary)
 * ```ts
 * trimMessagesForContext(messages, false)
 * // → messages (unchanged)
 * ```
 */
function trimMessagesForContext(
    messages: UIMessage[],
    hasSummary: boolean,
): UIMessage[] {
    if (!hasSummary || messages.length <= RECENT_MESSAGE_WINDOW) {
        return messages;
    }

    return messages.slice(-RECENT_MESSAGE_WINDOW);
}

/**
 * Enqueues a background summary job every N messages (see {@link CONVERSATION_SUMMARY_INTERVAL}).
 *
 * @param conversationId - Conversation to summarize
 * @param userId - Owner for Mem0 extraction in the summary worker
 * @param messageCount - Total persisted messages after the latest reply
 * @returns Resolves when the Inngest event is sent, or immediately if not due
 *
 * @example Input → Output (summary due at 20 messages)
 * ```ts
 * await maybeEnqueueConversationSummary("conv_001", "user_abc123", 20)
 * // → void (Inngest event: conversation/summarize enqueued)
 * ```
 *
 * @example Input → Output (not due)
 * ```ts
 * await maybeEnqueueConversationSummary("conv_001", "user_abc123", 19)
 * // → void (no-op)
 * ```
 */
async function maybeEnqueueConversationSummary(
    conversationId: string,
    userId: string,
    messageCount: number,
) {
    if (
        messageCount === 0 ||
        messageCount % CONVERSATION_SUMMARY_INTERVAL !== 0
    ) {
        return;
    }

    await enqueueConversationSummarize({ conversationId, userId });
}

/**
 * Main RAG chat endpoint: streams an AI reply with workspace context and optional web search.
 *
 * **Pipeline:**
 * 1. Validate user message and resolve/create conversation
 * 2. Save user message to Postgres
 * 3. Parallel: Pinecone RAG retrieval + Mem0 memory search
 * 4. Build system prompt and stream model response via AI SDK
 * 5. On finish: save assistant message, citations, title, summary job, Mem0 learning
 *
 * @param res - Express response (streamed via `pipeUIMessageStreamToResponse`)
 * @param workspaceId - Workspace whose sources to search
 * @param userId - Authenticated user's id
 * @param input - Client chat payload from `useChat`
 * @returns Writes UI message stream to `res`; sets `X-Conversation-Id` header
 * @throws {ValidationError} When no user message text is present
 * @throws {NotFoundError} When conversation or workspace is not found
 *
 * @example Input
 * ```ts
 * await streamWorkspaceChat(res, "ws_xyz789", "user_abc123", {
 *   conversationId: "conv_001",          // optional — omit for new chat
 *   messages: [{
 *     id: "msg_ui_1",
 *     role: "user",
 *     parts: [{ type: "text", text: "What is gradient descent?" }]
 *   }],
 *   model: "gpt-4o-mini",                // optional — falls back to workspace default
 *   webSearch: true                      // optional — enables Tavily tool when configured
 * })
 * ```
 *
 * @example Output (HTTP response)
 * ```ts
 * // Response headers:
 * //   Content-Type: text/event-stream (UI message stream)
 * //   X-Conversation-Id: "conv_001"
 * //
 * // Response body: streamed UIMessage chunks (tokens appear incrementally)
 * //
 * // Side effects after stream completes:
 * //   USER message already saved
 * //   ASSISTANT message saved with citations, e.g.:
 * //   {
 * //     role: "ASSISTANT",
 * //     content: "Gradient descent is an optimization algorithm...",
 * //     citations: [{
 * //       sourceType: "PDF",
 * //       sourceTitle: "ML Notes",
 * //       excerpt: "...",
 * //       page: 3
 * //     }]
 * //   }
 * ```
 */
export async function streamWorkspaceChat(
    res: Response,
    workspaceId: string,
    userId: string,
    input: {
        conversationId?: string;
        messages: UIMessage[];
        model?: string;
        webSearch?: boolean;
    },
) {
    const workspace = await getWorkspaceByIdForUser(workspaceId, userId);
    const chatModel = resolveChatModel(input.model ?? workspace.defaultModel);
    const webSearchEnabled = Boolean(input.webSearch) && isTavilyConfigured();

    const userText = getLastUserMessageText(input.messages);
    if (!userText) {
        throw new ValidationError("A user message is required");
    }

    const conversation = await resolveConversation(
        workspaceId,
        input.conversationId,
        userText,
    );

    await createMessageRecord({
        conversationId: conversation.id,
        role: "USER",
        content: userText,
    });

    const [retrievedChunks, userMemories] = await Promise.all([
        retrieveWorkspaceContext(workspaceId, userText),
        searchUserMemories(userId, userText),
    ]);

    const citations = toChatCitations(retrievedChunks);
    const systemPrompt = buildChatSystemPrompt({
        chunks: retrievedChunks,
        conversationSummary: conversation.summary,
        userMemories: userMemories.map((memory) => memory.memory),
        webSearchEnabled,
    });

    const contextMessages = trimMessagesForContext(
        input.messages,
        Boolean(conversation.summary),
    );

    let webSearchResults: TavilySearchResponse | null = null;

    const stream = createUIMessageStream({
        originalMessages: input.messages,
        execute: async ({ writer }) => {
            const tools =
                webSearchEnabled
                    ? {
                          web_search: tool({
                              description:
                                  "Search the web for up-to-date information outside the workspace sources.",
                              inputSchema: z.object({
                                  query: z
                                      .string()
                                      .describe(
                                          "The search query for current web information",
                                      ),
                              }),
                              execute: async ({ query }) => {
                                  const results = await searchWeb(query);
                                  webSearchResults = results;
                                  return formatTavilyResultsForPrompt(results);
                              },
                          }),
                      }
                    : undefined;

            const result = streamText({
                model: openai(chatModel),
                system: systemPrompt,
                messages: await convertToModelMessages(contextMessages),
                tools,
                stopWhen: webSearchEnabled ? isStepCount(3) : undefined,
            });

            writer.merge(toUIMessageStream({ stream: result.stream }));
        },
        onFinish: async ({ responseMessage, isAborted }) => {
            if (isAborted) {
                return;
            }

            const assistantText = getTextFromUIMessage(responseMessage).trim();
            if (!assistantText) {
                return;
            }

            const webCitations = webSearchResults
                ? toWebCitations(webSearchResults)
                : [];
            const allCitations =
                webCitations.length > 0
                    ? [...citations, ...webCitations]
                    : citations;

            await createMessageRecord({
                conversationId: conversation.id,
                role: "ASSISTANT",
                content: assistantText,
                citations: allCitations.length > 0 ? allCitations : citations,
            });

            await touchConversation(conversation.id);

            if (!conversation.title) {
                await updateConversationRecord(conversation.id, {
                    title: buildConversationTitle(userText),
                });
            }

            const messageCount = await countMessagesByConversationId(
                conversation.id,
            );

            await maybeEnqueueConversationSummary(
                conversation.id,
                userId,
                messageCount,
            );

            void addMemoriesFromMessages(
                userId,
                [
                    { role: "user", content: userText },
                    { role: "assistant", content: assistantText },
                ],
                {
                    source: "learned",
                    conversationId: conversation.id,
                },
            ).catch((error) => {
                console.error("Mem0 add failed:", error);
            });
        },
    });

    await pipeUIMessageStreamToResponse({
        response: res,
        stream,
        headers: {
            "X-Conversation-Id": conversation.id,
        },
    });
}
