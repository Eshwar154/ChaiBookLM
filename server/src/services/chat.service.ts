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

function toWebCitations(response: TavilySearchResponse): WebCitation[] {
    return response.results.map((result) => ({
        sourceType: "WEB" as const,
        sourceTitle: result.title,
        url: result.url,
        excerpt: result.content.slice(0, 280),
    }));
}

async function assertWorkspaceAccess(workspaceId: string, userId: string) {
    await getWorkspaceByIdForUser(workspaceId, userId);
}

export async function listConversationsForWorkspace(
    workspaceId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return findConversationsByWorkspaceId(workspaceId);
}

export async function createConversationForWorkspace(
    workspaceId: string,
    userId: string,
    title?: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return createConversationRecord(workspaceId, title);
}

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

function trimMessagesForContext(
    messages: UIMessage[],
    hasSummary: boolean,
): UIMessage[] {
    if (!hasSummary || messages.length <= RECENT_MESSAGE_WINDOW) {
        return messages;
    }

    return messages.slice(-RECENT_MESSAGE_WINDOW);
}

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
