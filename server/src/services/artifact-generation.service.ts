import { generateObject, generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { CHAT_MODEL } from "../lib/ai-config.js";
import { findSourcesByWorkspaceId } from "../repositories/source.repository.js";
import type { ArtifactRecord } from "../repositories/artifact.repository.js";
import { ValidationError } from "../types/app-error.js";

const MAX_CONTEXT_CHARS = 120_000;

const flashcardsSchema = z.object({
    cards: z
        .array(
            z.object({
                front: z.string(),
                back: z.string(),
            }),
        )
        .min(3)
        .max(30),
});

const quizSchema = z.object({
    questions: z
        .array(
            z.object({
                question: z.string(),
                options: z.array(z.string()).min(2).max(5),
                correctIndex: z.number().int().min(0),
                explanation: z.string(),
            }),
        )
        .min(3)
        .max(15),
});

const mindmapSchema = z.object({
    nodes: z
        .array(
            z.object({
                id: z.string(),
                label: z.string(),
            }),
        )
        .min(2)
        .max(40),
    edges: z.array(
        z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
        }),
    ),
});

const takeawaysSchema = z.object({
    items: z.array(z.string()).min(3).max(20),
});

const reportSchema = z.object({
    markdown: z.string(),
    sections: z.array(
        z.object({
            title: z.string(),
            content: z.string(),
        }),
    ),
});

export async function gatherSourceContext(
    workspaceId: string,
    sourceIds?: string[],
) {
    const sources = await findSourcesByWorkspaceId(workspaceId, {
        status: "READY",
    });

    const selected =
        sourceIds && sourceIds.length > 0
            ? sources.filter((source) => sourceIds.includes(source.id))
            : sources;

    if (selected.length === 0) {
        throw new ValidationError(
            "No ready sources found. Add and process sources before generating learning tools.",
        );
    }

    const missingContent = selected.filter((source) => !source.content?.trim());
    if (missingContent.length === selected.length) {
        throw new ValidationError(
            "Selected sources have no extracted content yet.",
        );
    }

    const text = selected
        .filter((source) => source.content?.trim())
        .map((source) => `# ${source.title}\n\n${source.content!.trim()}`)
        .join("\n\n---\n\n")
        .slice(0, MAX_CONTEXT_CHARS);

    return {
        text,
        sourceIds: selected.map((source) => source.id),
    };
}

function baseSystemPrompt(type: string) {
    return [
        `You are Chaibook, an expert learning assistant generating a ${type} from workspace source materials.`,
        "Use ONLY the provided source content. Do not invent facts not supported by the sources.",
        "Be clear, educational, and well-structured.",
    ].join("\n");
}

export async function generateArtifactContent(
    type: ArtifactRecord["type"],
    sourceText: string,
) {
    const system = baseSystemPrompt(type.toLowerCase());

    switch (type) {
        case "SUMMARY": {
            const result = await generateText({
                model: openai(CHAT_MODEL),
                system,
                prompt: `Write a comprehensive markdown summary of the following sources:\n\n${sourceText}`,
            });
            return { markdown: result.text };
        }
        case "TAKEAWAYS": {
            const result = await generateObject({
                model: openai(CHAT_MODEL),
                system,
                schema: takeawaysSchema,
                prompt: `Extract the most important key takeaways as concise bullet points from:\n\n${sourceText}`,
            });
            return result.object;
        }
        case "FLASHCARDS": {
            const result = await generateObject({
                model: openai(CHAT_MODEL),
                system,
                schema: flashcardsSchema,
                prompt: `Create study flashcards (front/back) covering the main concepts from:\n\n${sourceText}`,
            });
            return result.object;
        }
        case "QUIZ": {
            const result = await generateObject({
                model: openai(CHAT_MODEL),
                system,
                schema: quizSchema,
                prompt: `Create a multiple-choice quiz with explanations from:\n\n${sourceText}`,
            });
            return result.object;
        }
        case "MINDMAP": {
            const result = await generateObject({
                model: openai(CHAT_MODEL),
                system,
                schema: mindmapSchema,
                prompt: `Create a mind map as nodes and edges. Use a central topic node and branch out logically from:\n\n${sourceText}`,
            });
            return result.object;
        }
        case "REPORT": {
            const result = await generateObject({
                model: openai(CHAT_MODEL),
                system,
                schema: reportSchema,
                prompt: `Write a structured long-form report with sections and a full markdown version from:\n\n${sourceText}`,
            });
            return result.object;
        }
        default:
            throw new ValidationError(`Unsupported artifact type: ${type}`);
    }
}

export function defaultArtifactTitle(type: ArtifactRecord["type"]) {
    const labels: Record<ArtifactRecord["type"], string> = {
        SUMMARY: "Summary",
        TAKEAWAYS: "Key Takeaways",
        FLASHCARDS: "Flashcards",
        QUIZ: "Quiz",
        MINDMAP: "Mind Map",
        REPORT: "AI Report",
    };
    return labels[type];
}
