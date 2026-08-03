/**
 * A single piece of text ready for embedding or retrieval.
 *
 * Long documents are split into many `TextChunk`s so an LLM/RAG pipeline can:
 * - embed each chunk as a vector
 * - search for the most relevant chunks for a user question
 * - stay within model token limits
 *
 * @example
 * ```ts
 * {
 *   index: 0,
 *   content: "Machine learning is a subset of AI.",
 *   metadata: { page: 1 }
 * }
 * ```
 */
export type TextChunk = {
    index: number;
    content: string;
    metadata?: Record<string, unknown>;
};

/** Default maximum characters per chunk when no option is passed. */
const DEFAULT_CHUNK_SIZE = 1000;

/** Default overlap between consecutive chunks (helps preserve context at boundaries). */
const DEFAULT_CHUNK_OVERLAP = 100;

/**
 * Separators tried in order, from "most natural" to "most aggressive".
 *
 * The splitter walks this list and uses the first separator that actually
 * breaks the text into multiple parts. If none work, it falls back to raw
 * character slicing (the empty string `""` case in `splitText`).
 */
const SEPARATORS = ["\n\n", "\n", ". ", " ", ""];

/**
 * Combines small text splits into larger chunks without exceeding `chunkSize`.
 *
 * Think of this as packing sentences/paragraphs into boxes: keep adding splits
 * until the next one would overflow the box, then seal the box and start a new one.
 *
 * @param splits - Pieces produced by splitting on one separator (e.g. paragraphs)
 * @param separator - The separator to re-join with (e.g. `"\n\n"`)
 * @param chunkSize - Maximum characters allowed in one merged chunk
 * @returns An array of merged chunk strings
 *
 * @example
 * ```ts
 * mergeSplits(["Hello", "world", "from", "chunking"], " ", 12)
 *  Returns:
 *  [
 *   "Hello world",   // 11 chars — next word would exceed 12
 *   "from chunking"  // remaining splits joined
 * ]
 * ```
 */
function mergeSplits(splits: string[], separator: string, chunkSize: number) {
    const docs: string[] = [];
    let current: string[] = [];
    let total = 0;

    for (const split of splits) {
        const len = split.length;
        const sepLen = current.length > 0 ? separator.length : 0;

        if (total + len + sepLen > chunkSize && current.length > 0) {
            docs.push(current.join(separator));
            total = 0;
            current = [];
        }

        current.push(split);
        total += len + sepLen;
    }

    if (current.length > 0) {
        docs.push(current.join(separator));
    }

    return docs;
}

/**
 * Splits raw text into chunk strings using a recursive separator strategy.
 *
 * **How it works (step by step):**
 * 1. Try splitting on double newlines (`\n\n`) → keeps paragraphs together when possible
 * 2. If that fails, try single newlines (`\n`) → keeps lines together
 * 3. Then sentence boundaries (`. `)
 * 4. Then word boundaries (` `)
 * 5. Last resort: slice by character count with overlap
 *
 * The first separator that produces usable chunks wins; later separators are skipped.
 *
 * @param text - Full text to split
 * @param chunkSize - Target max characters per chunk
 * @param chunkOverlap - Characters repeated between adjacent chunks (character fallback only)
 * @returns Array of non-empty chunk strings (no `index` or `metadata` yet)
 *
 * @example
 * ```ts
 * const text = "Para one.\n\nPara two.\n\nPara three.";
 *
 * splitText(text, 20, 5)
 *  Tries "\n\n" first → splits into 3 paragraphs, merges to fit size 20
 *  Returns something like:
 *  [
 *   "Para one.",
 *   "Para two.",
 *   "Para three."
 * ]
 *
 * splitText("abcdefghijklmnop", 8, 2)
 *  No separator helps → character fallback with overlap
 *  Returns:
 *  [
 *   "abcdefgh",   // chars 0–7
 *   "ghijklmn",   // starts at 6 (8 - 2 overlap)
 *   "klmnop"      // remainder
 * ]
 * ```
 */
function splitText(text: string, chunkSize: number, chunkOverlap: number) {
    const chunks: string[] = [];

    for (const separator of SEPARATORS) {
        if (separator) {
            const splits = text.split(separator).filter(Boolean);
            if (splits.length === 1) {
                continue;
            }
            chunks.push(...mergeSplits(splits, separator, chunkSize));
        } else {
            for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
                chunks.push(text.slice(i, i + chunkSize));
            }
        }

        if (chunks.length > 0) {
            break;
        }
    }

    return chunks.filter((chunk) => chunk.trim().length > 0);
}

/**
 * Public API: split any plain string into numbered `TextChunk` objects.
 *
 * This is the function you call for articles, transcripts, scraped web text, etc.
 * Each chunk gets a sequential `index` and optional shared `metadata`.
 *
 * @param text - The full document text
 * @param options.chunkSize - Max characters per chunk (default: 1000)
 * @param options.chunkOverlap - Overlap for character-level splits (default: 100)
 * @param options.metadata - Extra fields attached to every chunk (e.g. `{ sourceId: "abc" }`)
 * @returns Array of `TextChunk` ready for embedding/storage
 *
 * @example
 * ```ts
 * const article = `
 * Introduction to RAG.
 *
 * Retrieval-Augmented Generation combines search with LLMs.
 * It helps answers stay grounded in your own documents.
 * `.trim();
 *
 * chunkText(article, { chunkSize: 60, chunkOverlap: 10, metadata: { source: "blog" } })
 *  Returns:
 *  [
 *    {
 *      index: 0,
 *     content: "Introduction to RAG.",
 *      metadata: { source: "blog" }
 *    },
 *    {
 *      index: 1,
 *      content: "Retrieval-Augmented Generation combines search with LLMs.",
 *      metadata: { source: "blog" }
 *    },
 *    {
 *      index: 2,
 *      content: "It helps answers stay grounded in your own documents.",
 *      metadata: { source: "blog" }
 *    }
 *  ]
 * ```
 */
export function chunkText(
    text: string,
    options: {
        chunkSize?: number;
        chunkOverlap?: number;
        metadata?: Record<string, unknown>;
    } = {},
): TextChunk[] {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const chunkOverlap = options.chunkOverlap ?? DEFAULT_CHUNK_OVERLAP;
    const parts = splitText(text.trim(), chunkSize, chunkOverlap);

    return parts.map((content, index) => ({
        index,
        content,
        metadata: options.metadata,
    }));
}

/**
 * Chunk a multi-page document (e.g. PDF pages) while preserving page numbers.
 *
 * Unlike `chunkText`, this:
 * - processes each page separately (chunks never span two pages)
 * - assigns `metadata.page` (1-based) to every chunk from that page
 * - re-numbers `index` globally across all pages (0, 1, 2, …)
 *
 * Empty or whitespace-only pages are skipped.
 *
 * @param pages - Array of page texts, e.g. from `extractPdfPages()`
 * @param options.chunkSize - Max characters per chunk (default: 1000)
 * @param options.chunkOverlap - Overlap for character-level splits (default: 100)
 * @returns Flat list of chunks from all pages with page metadata
 *
 * @example
 * ```ts
 * const pages = [
 *   "Page 1: Title and abstract content here.",
 *   "Page 2: Methods section with more details.",
 *   "", // empty page — skipped
 * ];
 *
 * chunkPages(pages, { chunkSize: 40, chunkOverlap: 5 })
 * Returns:
 *  [
 *    {
 *      index: 0,
 *      content: "Page 1: Title and abstract content here.",
 *      metadata: { page: 1 }
 *    },
 *    {
 *      index: 1,
 *      content: "Page 2: Methods section with more details.",
 *      metadata: { page: 2 }
 *    }
 *  ]
 *
 *  If page 2 were longer than chunkSize, you'd get multiple chunks
 *  with the same metadata.page but different global indexes:
 *  { index: 2, content: "...", metadata: { page: 2 } }
 *  { index: 3, content: "...", metadata: { page: 2 } }
 * ```
 */
export function chunkPages(
    pages: string[],
    options: {
        chunkSize?: number;
        chunkOverlap?: number;
    } = {},
): TextChunk[] {
    const chunks: TextChunk[] = [];
    let index = 0;

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const pageText = pages[pageIndex]?.trim();
        if (!pageText) {
            continue;
        }

        const pageChunks = chunkText(pageText, {
            ...options,
            metadata: { page: pageIndex + 1 },
        });

        for (const chunk of pageChunks) {
            chunks.push({
                index,
                content: chunk.content,
                metadata: chunk.metadata,
            });
            index += 1;
        }
    }

    return chunks;
}
