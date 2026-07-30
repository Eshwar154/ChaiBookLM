import type { Request, Response } from "express";
import type { UIMessage } from "ai";
import {
    createConversationForWorkspace,
    deleteConversationForWorkspace,
    getConversationMessagesForWorkspace,
    listConversationsForWorkspace,
    streamWorkspaceChat,
} from "../services/chat.service.js";
import { ValidationError } from "../types/app-error.js";
import { getZodFieldErrors } from "../utils/zod-error.js";
import {
    chatBodySchema,
    conversationIdParamSchema,
    createConversationSchema,
} from "../validators/chat.validator.js";
import { workspaceIdParamSchema } from "../validators/workspace.validator.js";

function parseWorkspaceId(params: Request["params"]) {
    const parsed = workspaceIdParamSchema.safeParse(params);

    if (!parsed.success) {
        throw new ValidationError(
            "Invalid workspace id",
            getZodFieldErrors(parsed.error),
        );
    }

    return parsed.data;
}

function parseConversationParams(params: Request["params"]) {
    const parsed = conversationIdParamSchema.safeParse(params);

    if (!parsed.success) {
        throw new ValidationError(
            "Invalid conversation id",
            getZodFieldErrors(parsed.error),
        );
    }

    return parsed.data;
}

function parseChatBody(body: unknown) {
    const parsed = chatBodySchema.safeParse(body);

    if (!parsed.success) {
        throw new ValidationError(
            "Validation failed",
            getZodFieldErrors(parsed.error),
        );
    }

    return parsed.data;
}

function parseCreateConversationBody(body: unknown) {
    const parsed = createConversationSchema.safeParse(body ?? {});

    if (!parsed.success) {
        throw new ValidationError(
            "Validation failed",
            getZodFieldErrors(parsed.error),
        );
    }

    return parsed.data;
}

export async function listConversations(req: Request, res: Response) {
    const { workspaceId } = parseWorkspaceId(req.params);
    const conversations = await listConversationsForWorkspace(
        workspaceId,
        req.session.user.id,
    );
    res.json(conversations);
}

export async function createConversation(req: Request, res: Response) {
    const { workspaceId } = parseWorkspaceId(req.params);
    const input = parseCreateConversationBody(req.body);
    const conversation = await createConversationForWorkspace(
        workspaceId,
        req.session.user.id,
        input.title,
    );
    res.status(201).json(conversation);
}

export async function listConversationMessages(req: Request, res: Response) {
    const { workspaceId, conversationId } = parseConversationParams(req.params);
    const messages = await getConversationMessagesForWorkspace(
        workspaceId,
        conversationId,
        req.session.user.id,
    );
    res.json(messages);
}

export async function deleteConversation(req: Request, res: Response) {
    const { workspaceId, conversationId } = parseConversationParams(req.params);
    await deleteConversationForWorkspace(
        workspaceId,
        conversationId,
        req.session.user.id,
    );
    res.status(204).send();
}

export async function streamChat(req: Request, res: Response) {
    const { workspaceId } = parseWorkspaceId(req.params);
    const body = parseChatBody(req.body);

    await streamWorkspaceChat(res, workspaceId, req.session.user.id, {
        conversationId: body.conversationId,
        messages: body.messages as unknown as UIMessage[],
        model: body.model,
        webSearch: body.webSearch,
    });
}
