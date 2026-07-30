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

async function assertWorkspaceAccess(workspaceId: string, userId: string) {
    await getWorkspaceByIdForUser(workspaceId, userId);
}

export async function listArtifactsForWorkspace(
    workspaceId: string,
    userId: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return findArtifactsByWorkspaceId(workspaceId);
}

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

export async function deleteArtifactForWorkspace(
    workspaceId: string,
    artifactId: string,
    userId: string,
) {
    await getArtifactForWorkspace(workspaceId, artifactId, userId);
    await deleteArtifactRecord(artifactId);
}

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
