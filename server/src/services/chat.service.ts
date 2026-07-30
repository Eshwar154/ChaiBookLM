import { openai } from "@ai-sdk/openai";
import type { Response } from "express";
import {
    convertToModelMessages,
    createUIMessageStream,
    pipeUIMessageStreamToResponse,
    streamText,
    toUIMessageStream,
    type UIMessage,
} from "ai";
import { CHAT_MODEL } from "../lib/ai-config.js";
import {
    buildRagSystemPrompt,
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
    findMessagesByConversationId,
} from "../repositories/message.repository.js";
import { NotFoundError, ValidationError } from "../types/app-error.js";
import {
    buildConversationTitle,
    getLastUserMessageText,
    getTextFromUIMessage,
} from "../utils/chat-message.js";
import { getWorkspaceByIdForUser } from "./workspace.service.js";

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

export async function streamWorkspaceChat(
    res: Response,
    workspaceId: string,
    userId: string,
    input: {
        conversationId?: string;
        messages: UIMessage[];
    },
) {
    await assertWorkspaceAccess(workspaceId, userId);

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

    const retrievedChunks = await retrieveWorkspaceContext(
        workspaceId,
        userText,
    );
    const citations = toChatCitations(retrievedChunks);
    const systemPrompt = buildRagSystemPrompt(retrievedChunks);

    const stream = createUIMessageStream({
        originalMessages: input.messages,
        execute: async ({ writer }) => {
            const result = streamText({
                model: openai(CHAT_MODEL),
                system: systemPrompt,
                messages: await convertToModelMessages(input.messages),
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

            await createMessageRecord({
                conversationId: conversation.id,
                role: "ASSISTANT",
                content: assistantText,
                citations,
            });

            await touchConversation(conversation.id);

            if (!conversation.title) {
                await updateConversationRecord(conversation.id, {
                    title: buildConversationTitle(userText),
                });
            }
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
