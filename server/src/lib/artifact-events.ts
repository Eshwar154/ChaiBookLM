/**
 * Inngest event helpers for background artifact generation.
 */

import { inngest } from "../inngest/client.js";

/**
 * Enqueues an artifact generation job to run asynchronously via Inngest.
 *
 * @param input - Artifact and workspace ids for the worker
 * @returns Resolves when the event is accepted by Inngest
 *
 * @example Input → Output
 * ```ts
 * await enqueueArtifactGeneration({
 *   artifactId: "art_001",
 *   workspaceId: "ws_xyz789"
 * })
 * // → void
 * // Inngest receives: { name: "artifact/generate", data: { artifactId, workspaceId } }
 * // Worker calls: processArtifactById("art_001")
 * ```
 */
export async function enqueueArtifactGeneration(input: {
    artifactId: string;
    workspaceId: string;
}) {
    await inngest.send({
        name: "artifact/generate",
        data: input,
    });
}
