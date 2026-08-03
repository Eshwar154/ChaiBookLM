/**
 * Cloudinary integration for PDF uploads and signed download URLs.
 *
 * Uploads use an unsigned preset (`CLOUDINARY_UPLOAD_PRESET`).
 * Signed downloads require `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`.
 */

import { v2 as cloudinary } from "cloudinary";
import { ValidationError } from "../types/app-error.js";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET ?? "dt2jgaj48";
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

/** Normalized result returned after a successful Cloudinary upload. */
export type CloudinaryUploadResult = {
    secureUrl: string;
    publicId: string;
    bytes: number;
    originalFilename: string;
    resourceType: "raw" | "image";
};

type CloudinaryUploadResponse = {
    secure_url: string;
    public_id: string;
    bytes: number;
    resource_type?: string;
    error?: { message: string };
};

/**
 * Configures the Cloudinary SDK when API credentials are present.
 *
 * @returns `true` when SDK is configured, `false` when credentials are missing
 */
function ensureCloudinarySdk() {
    if (!cloudName || !apiKey || !apiSecret) {
        return false;
    }

    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
    });

    return true;
}

/**
 * Builds a time-limited signed URL for downloading a private Cloudinary asset.
 *
 * Used as a fallback when public PDF URLs return 401 during extraction.
 *
 * @param publicId - Cloudinary public id (e.g. `"chaibook/pdfs/notes"`)
 * @param resourceType - Cloudinary resource type (`"raw"` for PDFs)
 * @returns Signed HTTPS URL, or `null` when API credentials are not configured
 *
 * @example Input → Output
 * ```ts
 * getSignedCloudinaryDownloadUrl("chaibook/pdfs/notes", "raw")
 * // → "https://res.cloudinary.com/demo/raw/upload/s--abc123--/v1/chaibook/pdfs/notes.pdf"
 *
 * getSignedCloudinaryDownloadUrl("chaibook/pdfs/notes", "raw")
 * // → null (when CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET missing)
 * ```
 */
export function getSignedCloudinaryDownloadUrl(
    publicId: string,
    resourceType: "raw" | "image" = "raw",
) {
    if (!ensureCloudinarySdk()) {
        return null;
    }

    return cloudinary.url(publicId, {
        resource_type: resourceType,
        type: "upload",
        sign_url: true,
        secure: true,
    });
}

/**
 * Uploads a PDF buffer to Cloudinary using an unsigned upload preset.
 *
 * @param buffer - PDF file bytes from Multer
 * @param filename - Original filename (used in the multipart form)
 * @returns Upload metadata including secure URL and public id
 * @throws {ValidationError} When Cloudinary is not configured or upload is rejected
 *
 * @example Input → Output
 * ```ts
 * await uploadPdfToCloudinary(pdfBuffer, "ml-notes.pdf")
 * // → {
 * //   secureUrl: "https://res.cloudinary.com/demo/raw/upload/v1/chaibook/pdfs/ml-notes.pdf",
 * //   publicId: "chaibook/pdfs/ml-notes",
 * //   bytes: 204800,
 * //   originalFilename: "ml-notes.pdf",
 * //   resourceType: "raw"
 * // }
 * ```
 */
export async function uploadPdfToCloudinary(
    buffer: Buffer,
    filename: string,
): Promise<CloudinaryUploadResult> {
    if (!cloudName) {
        throw new ValidationError("Cloudinary is not configured on the server");
    }

    if (!uploadPreset) {
        throw new ValidationError(
            "CLOUDINARY_UPLOAD_PRESET is required for PDF uploads",
        );
    }

    const form = new FormData();
    form.append(
        "file",
        new Blob([new Uint8Array(buffer)], { type: "application/pdf" }),
        filename,
    );
    form.append("upload_preset", uploadPreset);
    form.append("folder", "chaibook/pdfs");

    const response = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`,
        { method: "POST", body: form },
    );

    const result = (await response.json()) as CloudinaryUploadResponse;

    if (!response.ok) {
        const message =
            result.error?.message ??
            `Cloudinary upload failed (${response.status})`;

        if (response.status === 403) {
            throw new ValidationError(
                "Cloudinary rejected the upload. Check CLOUDINARY_UPLOAD_PRESET in server/.env matches an unsigned preset in your dashboard.",
            );
        }

        throw new ValidationError(message);
    }

    const resourceType =
        result.resource_type === "image" ? "image" : "raw";

    return {
        secureUrl: result.secure_url,
        publicId: result.public_id,
        bytes: result.bytes,
        originalFilename: filename,
        resourceType,
    };
}
