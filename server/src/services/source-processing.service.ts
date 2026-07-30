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

function asMetadata(metadata: SourceRecord["metadata"]): SourceMetadata {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        return {};
    }
    return metadata as SourceMetadata;
}

function estimateTokenCount(text: string) {
    return Math.ceil(text.length / 4);
}

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

export async function markSourceProcessing(sourceId: string) {
    return updateSourceRecord(sourceId, { status: "PROCESSING" });
}

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

export async function removeSourceFromIndex(
    workspaceId: string,
    sourceId: string,
) {
    await deleteSourceVectors(workspaceId, sourceId);
    await deleteChunksBySourceId(sourceId);
}

export async function listChunksForSource(sourceId: string) {
    const [chunks, count] = await Promise.all([
        findChunksBySourceId(sourceId),
        countChunksBySourceId(sourceId),
    ]);

    return { chunks, count };
}
