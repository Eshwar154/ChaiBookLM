/**
 * Inngest event helpers for background source processing (RAG indexing).
 */

import { inngest } from "../inngest/client.js";

/**
 * Enqueues a source processing job to run asynchronously via Inngest.
 *
 * The worker runs extract → chunk → embed → Pinecone upsert.
 *
 * @param input - Source and workspace ids for the processing worker
 * @returns Resolves when the event is accepted by Inngest
 *
 * @example Input → Output
 * ```ts
 * await enqueueSourceProcessing({
 *   sourceId: "src_001",
 *   workspaceId: "ws_xyz789"
 * })
 * // → void
 * // Inngest receives: { name: "source/created", data: { sourceId, workspaceId } }
 * // Worker runs: extractSourceContent → chunkSourceContent → embedAndIndexSource
 * ```
 */
export async function enqueueSourceProcessing(input: {
    sourceId: string;
    workspaceId: string;
}) {
    await inngest.send({
        name: "source/created",
        data: input,
    });
}
