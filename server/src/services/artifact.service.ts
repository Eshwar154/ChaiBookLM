import type { Prisma } from "../generated/prisma/client.js";
import { enqueueArtifactGeneration } from "../lib/artifact-events.js";
import {
    createArtifactRecord,
    deleteArtifactRecord,
    findArtifactById,
    findArtifactByIdAndWorkspaceId,
    findArtifactsByWorkspaceId,
    updateArtifactRecord,
    type ArtifactRecord,
} from "../repositories/artifact.repository.js";
import { NotFoundError } from "../types/app-error.js";
import {
    defaultArtifactTitle,
    gatherSourceContext,
    generateArtifactContent,
} from "./artifact-generation.service.js";
import { getWorkspaceByIdForUser } from "./workspace.service.js";
import type { CreateArtifactInput } from "../validators/artifact.validator.js";

/**
 * Verifies the user owns the workspace before any artifact operation proceeds.
 *
 * @param workspaceId - Workspace being accessed
 * @param userId - Authenticated user's id
 * @throws {NotFoundError} When the workspace is not found for this user
 */
async function assertWorkspaceAccess(workspaceId: string, userId: string) {
    await getWorkspaceByIdForUser(workspaceId, userId);
}

/**
 * Lists all learning artifacts in a workspace.
 *
 * @param workspaceId - Workspace to list artifacts from
 * @param userId - Authenticated user's id
 * @returns Artifact records ordered by creation time
 *
 * @example Input → Output
 * ```ts
 * await listArtifactsForWorkspace("ws_xyz789", "user_abc123")
 * // → [
 * //   {
 * //     id: "art_001",
 * //     workspaceId: "ws_xyz789",
 * //     type: "FLASHCARDS",
 * //     title: "Flashcards · 8/3/2026",
 * //     status: "READY",
 * //     sourceIds: ["src_001", "src_002"],
 * //     content: { cards: [...] },
 * //     metadata: { generatedAt: "2026-08-03T10:00:00.000Z" },
 * //     createdAt: Date,
 * //     updatedAt: Date
 * //   }
 * // ]
 * ```
 */
export async function listArtifactsForWorkspace(
    workspaceId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return findArtifactsByWorkspaceId(workspaceId);
}

/**
 * Loads a single artifact after verifying workspace ownership.
 *
 * @param workspaceId - Workspace the artifact belongs to
 * @param artifactId - Artifact to fetch
 * @param userId - Authenticated user's id
 * @returns Artifact record with content when status is `READY`
 * @throws {NotFoundError} When the artifact does not exist in this workspace
 *
 * @example Input → Output
 * ```ts
 * await getArtifactForWorkspace("ws_xyz789", "art_001", "user_abc123")
 * // → {
 * //   id: "art_001",
 * //   type: "QUIZ",
 * //   title: "Chapter 5 Quiz",
 * //   status: "READY",
 * //   content: { questions: [...] },
 * //   ...
 * // }
 * ```
 */
export async function getArtifactForWorkspace(
    workspaceId: string,
    artifactId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const artifact = await findArtifactByIdAndWorkspaceId(
        artifactId,
        workspaceId,
    );

    if (!artifact) {
        throw new NotFoundError("Artifact not found");
    }

    return artifact;
}

/**
 * Creates a pending artifact and enqueues background generation via Inngest.
 *
 * Validates that ready sources exist before creating the row. The actual AI
 * generation runs asynchronously in {@link processArtifactById}.
 *
 * @param workspaceId - Workspace to attach the artifact to
 * @param userId - Authenticated user's id
 * @param input - Artifact type, optional title, optional source id filter
 * @returns New artifact with status `PENDING`
 * @throws {ValidationError} When no ready sources are available
 *
 * @example Input → Output
 * ```ts
 * await createArtifactForWorkspace("ws_xyz789", "user_abc123", {
 *   type: "FLASHCARDS",
 *   title: "ML Chapter 3 Cards",
 *   sourceIds: ["src_001"]
 * })
 * // → {
 * //   id: "art_new456",
 * //   workspaceId: "ws_xyz789",
 * //   type: "FLASHCARDS",
 * //   title: "ML Chapter 3 Cards",
 * //   status: "PENDING",
 * //   sourceIds: ["src_001"],
 * //   content: null,
 * //   metadata: null,
 * //   createdAt: Date,
 * //   updatedAt: Date
 * // }
 * // (Inngest job enqueued to generate content)
 * ```
 */
export async function createArtifactForWorkspace(
    workspaceId: string,
    userId: string,
    input: CreateArtifactInput,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const context = await gatherSourceContext(
        workspaceId,
        input.sourceIds,
    );

    const artifact = await createArtifactRecord({
        workspaceId,
        type: input.type,
        title:
            input.title?.trim() ||
            `${defaultArtifactTitle(input.type)} · ${new Date().toLocaleDateString()}`,
        sourceIds: context.sourceIds,
        status: "PENDING",
    });

    await enqueueArtifactGeneration({
        artifactId: artifact.id,
        workspaceId,
    });

    return artifact;
}

/**
 * Deletes an artifact from the workspace.
 *
 * @param workspaceId - Workspace the artifact belongs to
 * @param artifactId - Artifact to delete
 * @param userId - Authenticated user's id
 * @returns Resolves when the artifact row is deleted
 * @throws {NotFoundError} When the artifact is not found
 *
 * @example Input → Output
 * ```ts
 * await deleteArtifactForWorkspace("ws_xyz789", "art_001", "user_abc123")
 * // → void
 * ```
 */
export async function deleteArtifactForWorkspace(
    workspaceId: string,
    artifactId: string,
    userId: string,
) {
    await getArtifactForWorkspace(workspaceId, artifactId, userId);
    await deleteArtifactRecord(artifactId);
}

/**
 * Runs the full artifact generation pipeline (used by Inngest worker).
 *
 * ```
 * status: PROCESSING
 *   → gatherSourceContext
 *   → generateArtifactContent
 *   → status: READY (or FAILED on error)
 * ```
 *
 * @param artifactId - Artifact to generate content for
 * @returns Updated artifact with `READY` status and generated content
 * @throws When the artifact is missing or generation fails (status set to `FAILED`)
 *
 * @example Input → Output (success)
 * ```ts
 * await processArtifactById("art_001")
 * // → {
 * //   id: "art_001",
 * //   status: "READY",
 * //   content: { cards: [{ front: "...", back: "..." }] },
 * //   metadata: { generatedAt: "2026-08-03T10:05:00.000Z", processingError: undefined }
 * // }
 * ```
 *
 * @example Input → Output (failure)
 * ```ts
 * await processArtifactById("art_broken")
 * // → artifact status set to "FAILED"
 * // → metadata.processingError: "No ready sources found..."
 * // → throws the same error
 * ```
 */
export async function processArtifactById(artifactId: string) {
    const artifact = await findArtifactById(artifactId);
    if (!artifact) {
        throw new Error("Artifact not found");
    }

    await updateArtifactRecord(artifactId, { status: "PROCESSING" });

    try {
        const context = await gatherSourceContext(
            artifact.workspaceId,
            artifact.sourceIds,
        );

        const content = await generateArtifactContent(
            artifact.type,
            context.text,
        );

        return updateArtifactRecord(artifactId, {
            status: "READY",
            content: content as Prisma.InputJsonValue,
            metadata: {
                generatedAt: new Date().toISOString(),
                processingError: undefined,
            },
        });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Artifact generation failed";

        await updateArtifactRecord(artifactId, {
            status: "FAILED",
            metadata: {
                processingError: message,
            },
        });

        throw error;
    }
}

export type { ArtifactRecord };
