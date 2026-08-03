/**
 * Source processing pipeline for RAG (Retrieval-Augmented Generation).
 *
 * When a user uploads a PDF or adds text, this service turns raw source data
 * into searchable vector embeddings. The full flow:
 *
 * ```
 * Source (PDF / text)
 *   → extractSourceContent   — pull plain text (from DB or Cloudinary PDF)
 *   → chunkSourceContent     — split into chunks, save to Postgres
 *   → embedAndIndexSource    — embed chunks with OpenAI, upsert to Pinecone
 *   → status: READY
 * ```
 *
 * `processSourceById` runs all three steps in one call (used for sync processing).
 * In production, Inngest runs the same steps as separate durable jobs.
 */

import type { PineconeRecord } from "@pinecone-database/pinecone";
import type { Prisma } from "../generated/prisma/client.js";
import { chunkPages, chunkText } from "../lib/chunking.js";
import { embedTexts } from "../lib/openai.js";
import { extractPdfFromCloudinary } from "../lib/pdf.js";
import {
    deleteSourceVectors,
    type VectorMetadata,
    upsertSourceVectors,
} from "../lib/pinecone.js";
import {
    countChunksBySourceId,
    createSourceChunks,
    deleteChunksBySourceId,
    findChunksBySourceId,
    type SourceChunkRecord,
} from "../repositories/source-chunk.repository.js";
import {
    findSourceById,
    updateSourceRecord,
    type SourceRecord,
} from "../repositories/source.repository.js";

/** Shape of JSON stored on a source's `metadata` column. */
type SourceMetadata = {
    fileUrl?: string;
    fileName?: string;
    fileSize?: number;
    publicId?: string;
    resourceType?: "raw" | "image";
    importedFrom?: string;
    videoId?: string;
    processingError?: string;
    chunkCount?: number;
    pageCount?: number;
    indexedAt?: string;
};

/**
 * Safely casts Prisma's loose JSON metadata into our typed shape.
 * Returns `{}` if metadata is null, not an object, or an array.
 *
 * @example
 * ```ts
 * asMetadata({ fileUrl: "https://...", pageCount: 12 })
 * // → { fileUrl: "https://...", pageCount: 12 }
 *
 * asMetadata(null)
 * // → {}
 * ```
 */
function asMetadata(metadata: SourceRecord["metadata"]): SourceMetadata {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }
    return metadata as SourceMetadata;
}

/**
 * Rough token estimate for a text string (~4 characters per token).
 * Used when saving chunks so we can track size without calling the tokenizer.
 *
 * @example
 * ```ts
 * estimateTokenCount("Hello world")  // 12 chars → 3 tokens
 * estimateTokenCount("abcdefghijklmnop")  // 16 chars → 4 tokens
 * ```
 */
function estimateTokenCount(text: string) {
    return Math.ceil(text.length / 4);
}

/**
 * Reads extractable text from a source record.
 *
 * **Two paths:**
 * 1. **Text already in DB** — returns `source.content` (TEXT, URL scrape, YouTube transcript, etc.)
 * 2. **PDF** — downloads from Cloudinary and runs PDF text extraction
 *
 * @throws If PDF is missing `fileUrl` or source has no content at all
 *
 * @example Text source
 * ```ts
 * // source.content = "Notes from lecture..."
 * await extractSourceText(source)
 * // → {
 * //   text: "Notes from lecture...",
 * //   pageCount: undefined,
 * //   pages: undefined
 * // }
 * ```
 *
 * @example PDF source
 * ```ts
 * source.type = "PDF", metadata.fileUrl = "https://res.cloudinary.com/..."
 * await extractSourceText(source)
 *  → {
 * text: "Full PDF text concatenated...",
 *   pageCount: 5,
 *  pages: ["Page 1 text...", "Page 2 text...", ...]
 * }
 * ```
 */
async function extractSourceText(source: SourceRecord) {
    if (source.content?.trim()) {
        return {
            text: source.content.trim(),
            pageCount: undefined as number | undefined,
            pages: undefined as string[] | undefined,
        };
    }

    if (source.type === "PDF") {
        const metadata = asMetadata(source.metadata);
        if (!metadata.fileUrl) {
            throw new Error("PDF source is missing fileUrl metadata");
        }

        const extracted = await extractPdfFromCloudinary({
            fileUrl: metadata.fileUrl,
            publicId: metadata.publicId,
            resourceType: metadata.resourceType ?? "image",
        });
        return {
            text: extracted.text,
            pageCount: extracted.pageCount,
            pages: extracted.pages,
        };
    }

    throw new Error(`Source ${source.id} has no extractable content`);
}

/**
 * Sets a source's status to `PROCESSING` while the pipeline runs.
 *
 * @example
 * ```ts
 * await markSourceProcessing("src_abc123")
 * // DB: { id: "src_abc123", status: "PROCESSING", ... }
 * ```
 */
export async function markSourceProcessing(sourceId: string) {
    return updateSourceRecord(sourceId, { status: "PROCESSING" });
}

/**
 * Marks a source as `FAILED` and stores the error message in metadata.
 * Called when extract, chunk, or embed steps throw.
 *
 * @example
 * ```ts
 * await markSourceFailed("src_abc123", new Error("PDF extraction failed"), source.metadata)
 *  DB update:
 *  {
 *    status: "FAILED",
 *    metadata: {
 *      ...existingMetadata,
 *      processingError: "PDF extraction failed"
 *    }
 *  }
 * ```
 */
export async function markSourceFailed(
    sourceId: string,
    error: unknown,
    existingMetadata: SourceRecord["metadata"],
) {
    const message =
        error instanceof Error ? error.message : "Source processing failed";

    const metadata = asMetadata(existingMetadata);

    return updateSourceRecord(sourceId, {
        status: "FAILED",
        metadata: {
            ...metadata,
            processingError: message,
        },
    });
}

/**
 * Step 1 of the pipeline: load text from the source and persist it.
 *
 * - Fetches the source from Postgres
 * - Extracts text (from `content` column or PDF on Cloudinary)
 * - Saves extracted text back to `source.content`
 * - Updates `metadata.pageCount` for PDFs
 *
 * @returns Extracted text plus page array (PDF only) for the chunking step
 *
 * @example
 * ```ts
 * await extractSourceContent("src_abc123")
 *  → {
 *    sourceId: "src_abc123",
 *    workspaceId: "ws_xyz",
 *    text: "Introduction to machine learning...",
 *    pages: ["Page 1...", "Page 2..."],  // undefined for non-PDF
 *    source: { id: "src_abc123", type: "PDF", title: "ML Notes", ... }
 *  }
 * ```
 */
export async function extractSourceContent(sourceId: string) {
    const source = await findSourceById(sourceId);
    if (!source) {
        throw new Error("Source not found");
    }

    const extracted = await extractSourceText(source);
    const metadata = asMetadata(source.metadata);

    await updateSourceRecord(sourceId, {
        content: extracted.text,
        metadata: {
            ...metadata,
            pageCount: extracted.pageCount ?? metadata.pageCount,
        },
    });

    return {
        sourceId,
        workspaceId: source.workspaceId,
        text: extracted.text,
        pages: extracted.pages,
        source,
    };
}

/**
 * Step 2 of the pipeline: split text into chunks and save to Postgres.
 *
 * - Deletes any existing chunks for this source (safe re-processing)
 * - Uses `chunkPages` when PDF page array is available (keeps page metadata)
 * - Otherwise uses `chunkText` on the full string
 * - Stores each chunk with an estimated `tokenCount`
 *
 * @param sourceId - Source to attach chunks to
 * @param text - Full extracted text
 * @param pages - Optional per-page strings from PDF extraction
 * @returns Saved chunk records from the database
 *
 * @example PDF with pages
 * ```ts
 * await chunkSourceContent("src_abc123", fullText, ["Page 1...", "Page 2..."])
 * // Postgres source_chunk rows:
 * // [
 * //   { id: "chunk_1", sourceId: "src_abc123", index: 0, content: "Page 1...", tokenCount: 42, metadata: { page: 1 } },
 * //   { id: "chunk_2", sourceId: "src_abc123", index: 1, content: "Page 2...", tokenCount: 38, metadata: { page: 2 } }
 * // ]
 * ```
 *
 * @example Plain text (no pages)
 * ```ts
 * await chunkSourceContent("src_abc123", "Long article text...")
 * // → chunks with metadata: null (no page numbers)
 * ```
 */
export async function chunkSourceContent(
    sourceId: string,
    text: string,
    pages?: string[],
) {
    await deleteChunksBySourceId(sourceId);

    const chunks =
        pages && pages.length > 0
            ? chunkPages(pages)
            : chunkText(text);

    if (chunks.length === 0) {
        throw new Error("No chunks were generated from source content");
    }

    const saved = await createSourceChunks(
        chunks.map((chunk) => ({
            sourceId,
            index: chunk.index,
            content: chunk.content,
            tokenCount: estimateTokenCount(chunk.content),
            metadata: chunk.metadata as Prisma.InputJsonValue | undefined,
        })),
    );

    return saved;
}

/**
 * Step 3 of the pipeline: embed chunks and store vectors in Pinecone.
 *
 * - Sends chunk text to OpenAI in batches of 50
 * - Builds Pinecone records with embedding + searchable metadata
 * - Upserts vectors into the workspace namespace
 * - Marks source as `READY` with `chunkCount` and `indexedAt`
 *
 * Pinecone metadata includes enough context for retrieval without re-querying Postgres:
 * `sourceTitle`, `sourceType`, chunk `text` (truncated to 35k chars), and optional `page`.
 *
 * @param source - The parent source record
 * @param chunks - Chunk rows already saved in Postgres (must have `id`)
 * @returns Updated source record with status `READY`
 *
 * @example Pinecone record shape (one per chunk)
 * ```ts
 * {
 *   id: "chunk_1",
 *   values: [0.012, -0.034, ...],  // 1536-dim embedding vector
 *   metadata: {
 *     workspaceId: "ws_xyz",
 *     sourceId: "src_abc123",
 *     chunkId: "chunk_1",
 *     chunkIndex: 0,
 *     sourceTitle: "ML Notes",
 *     sourceType: "PDF",
 *     text: "Introduction to machine learning...",
 *     page: 1
 *   }
 * }
 * ```
 *
 * @example Source after indexing
 * ```ts
 * DB: {
 *   status: "READY",
 *    metadata: {
 *      chunkCount: 12,
 *      indexedAt: "2026-08-03T10:00:00.000Z",
 *      processingError: undefined
 *    }
 *  }
 * ```
 */
export async function embedAndIndexSource(
    source: SourceRecord,
    chunks: SourceChunkRecord[],
) {
    const batchSize = 50;
    const records: PineconeRecord<VectorMetadata>[] = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        const embeddings = await embedTexts(batch.map((chunk) => chunk.content));

        for (let j = 0; j < batch.length; j += 1) {
            const chunk = batch[j]!;
            const embedding = embeddings[j]!;
            const chunkMetadata =
                chunk.metadata &&
                    typeof chunk.metadata === "object" &&
                    !Array.isArray(chunk.metadata)
                    ? (chunk.metadata as Record<string, unknown>)
                    : {};

            records.push({
                id: chunk.id,
                values: embedding,
                metadata: {
                    workspaceId: source.workspaceId,
                    sourceId: source.id,
                    chunkId: chunk.id,
                    chunkIndex: chunk.index,
                    sourceTitle: source.title,
                    sourceType: source.type,
                    text: chunk.content.slice(0, 35000),
                    ...(typeof chunkMetadata.page === "number"
                        ? { page: chunkMetadata.page }
                        : {}),
                },
            });
        }
    }

    await upsertSourceVectors(source.workspaceId, records);

    const metadata = asMetadata(source.metadata);

    return updateSourceRecord(source.id, {
        status: "READY",
        metadata: {
            ...metadata,
            chunkCount: chunks.length,
            indexedAt: new Date().toISOString(),
            processingError: undefined,
        },
    });
}

/**
 * Runs the full source processing pipeline in one call.
 *
 * ```
 * markSourceProcessing
 *   → extractSourceContent
 *   → chunkSourceContent
 *   → embedAndIndexSource
 * ```
 *
 * On any error, calls `markSourceFailed` and re-throws.
 *
 * @example Success
 * ```ts
 * await processSourceById("src_abc123")
 * → updated source with status: "READY", metadata.chunkCount: 12
 * ```
 *
 * @example Failure
 * ```ts
 * await processSourceById("src_missing_pdf")
 *  → source status set to "FAILED"
 *  → metadata.processingError: "PDF source is missing fileUrl metadata"
 * → throws the same error
 * ```
 */
export async function processSourceById(sourceId: string) {
    const source = await findSourceById(sourceId);
    if (!source) {
        throw new Error("Source not found");
    }

    await markSourceProcessing(sourceId);

    try {
        const extracted = await extractSourceContent(sourceId);
        const chunks = await chunkSourceContent(
            sourceId,
            extracted.text,
            extracted.pages,
        );
        const updatedSource =
            (await findSourceById(sourceId)) ?? extracted.source;

        return embedAndIndexSource(updatedSource, chunks);
    } catch (error) {
        const current = await findSourceById(sourceId);
        if (current) {
            await markSourceFailed(sourceId, error, current.metadata);
        }
        throw error;
    }
}

/**
 * Removes a source from the vector index and deletes its chunks from Postgres.
 * Used when a source is deleted or needs to be fully re-indexed from scratch.
 *
 * @example
 * ```ts
 * await removeSourceFromIndex("ws_xyz", "src_abc123")
 *  → Pinecone vectors for source deleted
 *  → All source_chunk rows for sourceId deleted
 * ```
 */
export async function removeSourceFromIndex(
    workspaceId: string,
    sourceId: string,
) {
    await deleteSourceVectors(workspaceId, sourceId);
    await deleteChunksBySourceId(sourceId);
}

/**
 * Returns all chunks for a source plus the total count.
 * Useful for debugging, admin UI, or verifying processing completed.
 *
 * @example
 * ```ts
 * await listChunksForSource("src_abc123")
 *  → {
 *    chunks: [
 *      { id: "chunk_1", index: 0, content: "...", tokenCount: 42, metadata: { page: 1 }, ... },
 *      { id: "chunk_2", index: 1, content: "...", tokenCount: 38, metadata: { page: 2 }, ... }
 *   ],
 *    count: 2
 * }
 * ```
 */
export async function listChunksForSource(sourceId: string) {
    const [chunks, count] = await Promise.all([
        findChunksBySourceId(sourceId),
        countChunksBySourceId(sourceId),
    ]);

    return { chunks, count };
}
