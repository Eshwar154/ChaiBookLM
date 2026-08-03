import { uploadPdfToCloudinary } from "../lib/cloudinary.js";
import { extractPdfFromBuffer } from "../lib/pdf.js";
import { scrapeWebsite } from "../lib/firecrawl.js";
import { enqueueSourceProcessing } from "../lib/source-events.js";
import { fetchYoutubeTranscript } from "../lib/youtube.js";
import {
    createSourceRecord,
    deleteSourceRecord,
    findSourceByIdAndWorkspaceId,
    findSourcesByWorkspaceId,
    updateSourceRecord,
    type SourceRecord,
} from "../repositories/source.repository.js";
import { getWorkspaceByIdForUser } from "./workspace.service.js";
import { NotFoundError } from "../types/app-error.js";
import type {
    CreateSourceInput,
    ImportWebsiteInput,
    ImportWebSearchInput,
    ImportYoutubeInput,
    ListSourcesQuery,
    ReprocessSourcesInput,
} from "../validators/source.validator.js";
import { listChunksForSource, removeSourceFromIndex } from "./source-processing.service.js";

/**
 * Verifies the user owns the workspace before any source operation proceeds.
 *
 * @param workspaceId - Workspace being accessed
 * @param userId - Authenticated user's id
 * @throws {NotFoundError} When the workspace is not found for this user
 */
async function assertWorkspaceAccess(workspaceId: string, userId: string) {
    await getWorkspaceByIdForUser(workspaceId, userId);
}

/**
 * Persists a source row and enqueues the Inngest processing pipeline.
 *
 * @param data - Fields for the new source record
 * @returns Created source with status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await createAndProcessSource({
 *   workspaceId: "ws_xyz789",
 *   type: "TEXT",
 *   title: "My Notes",
 *   content: "Hello world",
 *   status: "PENDING"
 * })
 * // → {
 * //   id: "src_new123",
 * //   workspaceId: "ws_xyz789",
 * //   type: "TEXT",
 * //   title: "My Notes",
 * //   content: "Hello world",
 * //   status: "PENDING",
 * //   ...
 * // }
 * // (Inngest job enqueued: extract → chunk → embed)
 * ```
 */
async function createAndProcessSource(
    data: Parameters<typeof createSourceRecord>[0],
) {
    const source = await createSourceRecord(data);

    await enqueueSourceProcessing({
        sourceId: source.id,
        workspaceId: source.workspaceId,
    });

    return source;
}

/**
 * Lists sources in a workspace with optional search and filter query params.
 *
 * @param workspaceId - Workspace to list sources from
 * @param userId - Authenticated user's id
 * @param filters - Optional `q`, `type`, and `status` filters
 * @returns Matching source records
 *
 * @example Input → Output
 * ```ts
 * await listSourcesForWorkspace("ws_xyz789", "user_abc123", {
 *   type: "PDF",
 *   status: "READY"
 * })
 * // → [
 * //   {
 * //     id: "src_001",
 * //     workspaceId: "ws_xyz789",
 * //     type: "PDF",
 * //     title: "ML Textbook",
 * //     status: "READY",
 * //     content: "Full extracted text...",
 * //     metadata: { chunkCount: 42, indexedAt: "2026-08-03T10:00:00.000Z" },
 * //     ...
 * //   }
 * // ]
 * ```
 */
export async function listSourcesForWorkspace(
    workspaceId: string,
    userId: string,
    filters: ListSourcesQuery = {},
) {
    await assertWorkspaceAccess(workspaceId, userId);
    return findSourcesByWorkspaceId(workspaceId, filters);
}

/**
 * Loads a single source after verifying workspace ownership.
 *
 * @param workspaceId - Workspace the source belongs to
 * @param sourceId - Source to fetch
 * @param userId - Authenticated user's id
 * @returns Source record
 * @throws {NotFoundError} When the source does not exist in this workspace
 *
 * @example Input → Output
 * ```ts
 * await getSourceForWorkspace("ws_xyz789", "src_001", "user_abc123")
 * // → {
 * //   id: "src_001",
 * //   type: "WEBSITE",
 * //   title: "React Docs",
 * //   url: "https://react.dev",
 * //   status: "READY",
 * //   ...
 * // }
 * ```
 */
export async function getSourceForWorkspace(
    workspaceId: string,
    sourceId: string,
    userId: string,
): Promise<SourceRecord> {
    await assertWorkspaceAccess(workspaceId, userId);

    const source = await findSourceByIdAndWorkspaceId(sourceId, workspaceId);

    if (!source) {
        throw new NotFoundError("Source not found");
    }

    return source;
}

/**
 * Creates a plain-text or markdown source and queues it for RAG indexing.
 *
 * @param workspaceId - Workspace to attach the source to
 * @param userId - Authenticated user's id
 * @param input - Source type, title, and raw content
 * @returns New source with status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await createTextOrMarkdownSource("ws_xyz789", "user_abc123", {
 *   type: "MARKDOWN",
 *   title: "Lecture Notes",
 *   content: "## Week 1\n\nIntro to neural nets..."
 * })
 * // → {
 * //   id: "src_new456",
 * //   type: "MARKDOWN",
 * //   title: "Lecture Notes",
 * //   content: "## Week 1\n\nIntro to neural nets...",
 * //   status: "PENDING",
 * //   ...
 * // }
 * ```
 */
export async function createTextOrMarkdownSource(
    workspaceId: string,
    userId: string,
    input: CreateSourceInput,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    return createAndProcessSource({
        workspaceId,
        type: input.type,
        title: input.title,
        content: input.content,
        status: "PENDING",
    });
}

/**
 * Uploads a PDF to Cloudinary, optionally extracts text, and queues processing.
 *
 * Text extraction at upload time is best-effort; Inngest retries from Cloudinary if it fails.
 *
 * @param workspaceId - Workspace to attach the source to
 * @param userId - Authenticated user's id
 * @param file - Multer file buffer from the upload endpoint
 * @param title - Optional custom title (defaults to filename without `.pdf`)
 * @returns New PDF source with Cloudinary metadata and status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await uploadPdfSource("ws_xyz789", "user_abc123", multerFile, "ML Textbook")
 * // → {
 * //   id: "src_pdf789",
 * //   type: "PDF",
 * //   title: "ML Textbook",
 * //   content: "Extracted PDF text..." | null,
 * //   status: "PENDING",
 * //   metadata: {
 * //     fileUrl: "https://res.cloudinary.com/.../notes.pdf",
 * //     fileName: "notes.pdf",
 * //     fileSize: 204800,
 * //     publicId: "chaibook/notes",
 * //     pageCount: 12
 * //   }
 * // }
 * ```
 */
export async function uploadPdfSource(
    workspaceId: string,
    userId: string,
    file: Express.Multer.File,
    title?: string,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const upload = await uploadPdfToCloudinary(
        file.buffer,
        file.originalname,
    );

    let content: string | null = null;
    let pageCount: number | undefined;

    try {
        const extracted = await extractPdfFromBuffer(file.buffer);
        content = extracted.text;
        pageCount = extracted.pageCount;
    } catch {
        // Inngest will retry extraction from Cloudinary if upload-time parse fails.
    }

    return createAndProcessSource({
        workspaceId,
        type: "PDF",
        title: title?.trim() || file.originalname.replace(/\.pdf$/i, ""),
        content,
        status: "PENDING",
        metadata: {
            fileUrl: upload.secureUrl,
            fileName: upload.originalFilename,
            fileSize: upload.bytes,
            publicId: upload.publicId,
            resourceType: upload.resourceType,
            pageCount,
        },
    });
}

/**
 * Scrapes a website via Firecrawl and creates a source from the markdown content.
 *
 * @param workspaceId - Workspace to attach the source to
 * @param userId - Authenticated user's id
 * @param input - URL and optional custom title
 * @returns New WEBSITE source with scraped markdown and status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await importWebsiteSource("ws_xyz789", "user_abc123", {
 *   url: "https://react.dev/learn",
 *   title: "React Learn"
 * })
 * // → {
 * //   id: "src_web001",
 * //   type: "WEBSITE",
 * //   title: "React Learn",
 * //   url: "https://react.dev/learn",
 * //   content: "# Quick Start\n\nWelcome to React...",
 * //   status: "PENDING",
 * //   metadata: { importedFrom: "https://react.dev/learn" }
 * // }
 * ```
 */
export async function importWebsiteSource(
    workspaceId: string,
    userId: string,
    input: ImportWebsiteInput,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const scraped = await scrapeWebsite(input.url);

    return createAndProcessSource({
        workspaceId,
        type: "WEBSITE",
        title: input.title?.trim() || scraped.title || input.url,
        content: scraped.markdown,
        url: scraped.sourceUrl,
        status: "PENDING",
        metadata: {
            importedFrom: scraped.sourceUrl,
        },
    });
}

/**
 * Fetches a YouTube transcript and creates a source from the caption text.
 *
 * @param workspaceId - Workspace to attach the source to
 * @param userId - Authenticated user's id
 * @param input - YouTube URL and optional custom title
 * @returns New YOUTUBE source with transcript content and status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await importYoutubeSource("ws_xyz789", "user_abc123", {
 *   url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
 * })
 * // → {
 * //   id: "src_yt001",
 * //   type: "YOUTUBE",
 * //   title: "YouTube: dQw4w9WgXcQ",
 * //   url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
 * //   content: "Full transcript text...",
 * //   status: "PENDING",
 * //   metadata: { videoId: "dQw4w9WgXcQ" }
 * // }
 * ```
 */
export async function importYoutubeSource(
    workspaceId: string,
    userId: string,
    input: ImportYoutubeInput,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const transcript = await fetchYoutubeTranscript(input.url);

    return createAndProcessSource({
        workspaceId,
        type: "YOUTUBE",
        title: input.title?.trim() || `YouTube: ${transcript.videoId}`,
        content: transcript.content,
        url: input.url,
        status: "PENDING",
        metadata: {
            videoId: transcript.videoId,
        },
    });
}

/**
 * Deletes a source, its Pinecone vectors, and its Postgres chunks.
 *
 * @param workspaceId - Workspace the source belongs to
 * @param sourceId - Source to delete
 * @param userId - Authenticated user's id
 * @returns Resolves when the source row is deleted
 * @throws {NotFoundError} When the source is not found
 *
 * @example Input → Output
 * ```ts
 * await deleteSourceForWorkspace("ws_xyz789", "src_001", "user_abc123")
 * // → void (vectors + chunks removed, source row deleted)
 * ```
 */
export async function deleteSourceForWorkspace(
    workspaceId: string,
    sourceId: string,
    userId: string,
) {
    await getSourceForWorkspace(workspaceId, sourceId, userId);
    await removeSourceFromIndex(workspaceId, sourceId);
    await deleteSourceRecord(sourceId);
}

/**
 * Returns indexed chunks for a source (debugging / admin UI).
 *
 * @param workspaceId - Workspace the source belongs to
 * @param sourceId - Source whose chunks to list
 * @param userId - Authenticated user's id
 * @returns Chunk rows and total count
 *
 * @example Input → Output
 * ```ts
 * await getSourceChunksForWorkspace("ws_xyz789", "src_001", "user_abc123")
 * // → {
 * //   chunks: [
 * //     { id: "chunk_1", index: 0, content: "...", tokenCount: 42, metadata: { page: 1 } }
 * //   ],
 * //   count: 12
 * // }
 * ```
 */
export async function getSourceChunksForWorkspace(
    workspaceId: string,
    sourceId: string,
    userId: string,
) {
    await getSourceForWorkspace(workspaceId, sourceId, userId);
    return listChunksForSource(sourceId);
}

/**
 * Deletes multiple sources in sequence.
 *
 * @param workspaceId - Workspace containing the sources
 * @param userId - Authenticated user's id
 * @param sourceIds - Array of source ids to delete
 * @returns Resolves when all sources are deleted
 *
 * @example Input → Output
 * ```ts
 * await bulkDeleteSourcesForWorkspace("ws_xyz789", "user_abc123", ["src_001", "src_002"])
 * // → void
 * ```
 */
export async function bulkDeleteSourcesForWorkspace(
    workspaceId: string,
    userId: string,
    sourceIds: string[],
) {
    await assertWorkspaceAccess(workspaceId, userId);

    for (const sourceId of sourceIds) {
        await deleteSourceForWorkspace(workspaceId, sourceId, userId);
    }
}

/**
 * Re-queues failed sources for re-processing.
 *
 * When `sourceIds` is omitted, all `FAILED` sources in the workspace are reprocessed.
 * When provided, only failed sources whose id is in the list are reprocessed.
 *
 * @param workspaceId - Workspace containing the sources
 * @param userId - Authenticated user's id
 * @param input - Optional subset of source ids to reprocess
 * @returns Count of sources that were requeued
 *
 * @example Input → Output (all failed sources)
 * ```ts
 * await reprocessSourcesForWorkspace("ws_xyz789", "user_abc123")
 * // → { reprocessed: 3 }
 * ```
 *
 * @example Input → Output (specific ids)
 * ```ts
 * await reprocessSourcesForWorkspace("ws_xyz789", "user_abc123", {
 *   sourceIds: ["src_failed1", "src_failed2"]
 * })
 * // → { reprocessed: 2 }
 * ```
 */
export async function reprocessSourcesForWorkspace(
    workspaceId: string,
    userId: string,
    input: ReprocessSourcesInput = {},
) {
    await assertWorkspaceAccess(workspaceId, userId);

    const sources = await findSourcesByWorkspaceId(workspaceId, {
        status: "FAILED",
    });

    const targets = input.sourceIds?.length
        ? sources.filter((source) => input.sourceIds!.includes(source.id))
        : sources;

    for (const source of targets) {
        await reprocessSourceForWorkspace(workspaceId, source.id, userId);
    }

    return { reprocessed: targets.length };
}

/**
 * Clears vectors/chunks and re-queues a single source for full re-indexing.
 *
 * @param workspaceId - Workspace the source belongs to
 * @param sourceId - Source to reprocess
 * @param userId - Authenticated user's id
 * @returns Resolves when the source is reset to `PENDING` and re-enqueued
 * @throws {NotFoundError} When the source is not found
 *
 * @example Input → Output
 * ```ts
 * await reprocessSourceForWorkspace("ws_xyz789", "src_001", "user_abc123")
 * // → void
 * // DB: { id: "src_001", status: "PENDING", metadata.processingError: undefined }
 * // (Inngest job enqueued)
 * ```
 */
export async function reprocessSourceForWorkspace(
    workspaceId: string,
    sourceId: string,
    userId: string,
) {
    const source = await getSourceForWorkspace(workspaceId, sourceId, userId);

    await removeSourceFromIndex(workspaceId, sourceId);

    const metadata =
        source.metadata && typeof source.metadata === "object"
            ? { ...(source.metadata as Record<string, unknown>) }
            : {};

    delete metadata.processingError;

    await updateSourceRecord(sourceId, {
        status: "PENDING",
        metadata: metadata as Parameters<typeof updateSourceRecord>[1]["metadata"],
    });

    await enqueueSourceProcessing({ sourceId, workspaceId });
}

/**
 * Saves web search results (from Tavily) as a WEBSITE source for RAG indexing.
 *
 * Used when the user chooses to add a web search result to their workspace sources.
 *
 * @param workspaceId - Workspace to attach the source to
 * @param userId - Authenticated user's id
 * @param input - Title, scraped content, and source URL from search
 * @returns New WEBSITE source with status `PENDING`
 *
 * @example Input → Output
 * ```ts
 * await importWebSearchSource("ws_xyz789", "user_abc123", {
 *   title: "Latest on GPT-5",
 *   content: "OpenAI announced...",
 *   url: "https://example.com/article"
 * })
 * // → {
 * //   id: "src_search001",
 * //   type: "WEBSITE",
 * //   title: "Latest on GPT-5",
 * //   content: "OpenAI announced...",
 * //   url: "https://example.com/article",
 * //   status: "PENDING",
 * //   metadata: { importedFrom: "web-search", sourceUrl: "https://example.com/article" }
 * // }
 * ```
 */
export async function importWebSearchSource(
    workspaceId: string,
    userId: string,
    input: ImportWebSearchInput,
) {
    await assertWorkspaceAccess(workspaceId, userId);

    return createAndProcessSource({
        workspaceId,
        type: "WEBSITE",
        title: input.title,
        content: input.content,
        url: input.url,
        status: "PENDING",
        metadata: {
            importedFrom: "web-search",
            sourceUrl: input.url,
        },
    });
}
