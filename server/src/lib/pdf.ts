/**
 * PDF text extraction utilities using `unpdf`.
 *
 * Supports in-memory buffers, direct URLs, and Cloudinary-hosted PDFs
 * (with signed URL fallback when public access returns 401).
 */

import { extractText, getDocumentProxy } from "unpdf";
import { getSignedCloudinaryDownloadUrl } from "./cloudinary.js";

/** Result of extracting text from a PDF document. */
export type PdfExtractResult = {
    text: string;
    pages: string[];
    pageCount: number;
};

/**
 * Converts a Node.js Buffer to a standalone ArrayBuffer for `unpdf`.
 *
 * @param buffer - Node Buffer from Multer upload
 * @returns ArrayBuffer view of the same bytes
 */
function bufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
}

/**
 * Extracts plain text from a PDF buffer (upload-time or downloaded file).
 *
 * @param buffer - PDF bytes as Buffer or ArrayBuffer
 * @returns Joined full text, per-page strings, and total page count
 * @throws When no text could be extracted from the PDF
 *
 * @example Input → Output
 * ```ts
 * await extractPdfFromBuffer(uploadedFile.buffer)
 * // → {
 * //   text: "Chapter 1\n\nIntroduction to ML...\n\nChapter 2\n\n...",
 * //   pages: ["Chapter 1\n\nIntroduction...", "Chapter 2\n\n..."],
 * //   pageCount: 12
 * // }
 * ```
 */
export async function extractPdfFromBuffer(
    buffer: ArrayBuffer | Buffer,
): Promise<PdfExtractResult> {
    const arrayBuffer =
        buffer instanceof Buffer ? bufferToArrayBuffer(buffer) : buffer;

    const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
    const { totalPages, text } = await extractText(pdf, { mergePages: false });

    const pages = Array.isArray(text)
        ? text.map((page) => page.trim())
        : [String(text).trim()];

    const joined = pages.filter(Boolean).join("\n\n");

    if (!joined) {
        throw new Error("No text could be extracted from the PDF");
    }

    return {
        text: joined,
        pages,
        pageCount: totalPages,
    };
}

/**
 * Downloads a PDF from a URL and extracts its text.
 *
 * @param url - Public or signed URL to the PDF file
 * @returns Extracted text and per-page content
 * @throws When download fails or extraction yields no text
 *
 * @example Input → Output
 * ```ts
 * await extractPdfFromUrl("https://example.com/paper.pdf")
 * // → { text: "Abstract\n\n...", pages: ["Abstract\n\n..."], pageCount: 8 }
 * ```
 */
async function downloadPdf(url: string) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`Failed to download PDF (${response.status})`);
    }

    return response.arrayBuffer();
}

export async function extractPdfFromUrl(url: string): Promise<PdfExtractResult> {
    const buffer = await downloadPdf(url);
    return extractPdfFromBuffer(buffer);
}

/**
 * Extracts text from a PDF stored on Cloudinary.
 *
 * Tries the public `fileUrl` first; on 401, falls back to a signed download URL
 * when `publicId` and Cloudinary API credentials are available.
 *
 * @param input - Cloudinary file URL, public id, and resource type
 * @returns Extracted text and per-page content
 * @throws When download or extraction fails, or signed URL cannot be generated
 *
 * @example Input → Output
 * ```ts
 * await extractPdfFromCloudinary({
 *   fileUrl: "https://res.cloudinary.com/demo/raw/upload/v1/chaibook/pdfs/notes.pdf",
 *   publicId: "chaibook/pdfs/notes",
 *   resourceType: "raw"
 * })
 * // → {
 * //   text: "Full PDF text...",
 * //   pages: ["Page 1 text...", "Page 2 text..."],
 * //   pageCount: 5
 * // }
 * ```
 */
export async function extractPdfFromCloudinary(input: {
    fileUrl: string;
    publicId?: string;
    resourceType?: "raw" | "image";
}): Promise<PdfExtractResult> {
    const resourceType = input.resourceType ?? "raw";

    try {
        return await extractPdfFromUrl(input.fileUrl);
    } catch (error) {
        const isUnauthorized =
            error instanceof Error && error.message.includes("(401)");

        if (!isUnauthorized || !input.publicId) {
            throw error;
        }

        const signedUrl = getSignedCloudinaryDownloadUrl(
            input.publicId,
            resourceType,
        );

        if (!signedUrl) {
            throw new Error(
                "PDF download requires authentication. Add CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET to server/.env, or re-upload the PDF.",
            );
        }

        const buffer = await downloadPdf(signedUrl);
        return extractPdfFromBuffer(buffer);
    }
}
