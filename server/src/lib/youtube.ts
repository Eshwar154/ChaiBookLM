/**
 * YouTube transcript extraction for YOUTUBE source imports.
 */

import { YoutubeTranscript } from "youtube-transcript";
import { ValidationError } from "../types/app-error.js";

/**
 * Parses a YouTube URL and extracts the 11-character video id.
 *
 * Supports `watch?v=`, `youtu.be/`, `/embed/`, and `/shorts/` URL formats.
 *
 * @param url - YouTube page URL
 * @returns Video id string, or `null` if the URL is not recognized
 *
 * @example Input → Output
 * ```ts
 * extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
 * // → "dQw4w9WgXcQ"
 *
 * extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ")
 * // → "dQw4w9WgXcQ"
 *
 * extractYoutubeVideoId("https://example.com/not-youtube")
 * // → null
 * ```
 */
export function extractYoutubeVideoId(url: string) {
    const patterns = [
        /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/,
        /youtube\.com\/shorts\/([\w-]{11})/,
    ];

    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match?.[1]) {
            return match[1];
        }
    }

    return null;
}

/**
 * Fetches caption transcript text for a YouTube video.
 *
 * @param url - YouTube page URL
 * @returns Video id and concatenated transcript text
 * @throws {ValidationError} When the URL is invalid, captions are missing, or fetch fails
 *
 * @example Input → Output
 * ```ts
 * await fetchYoutubeTranscript("https://www.youtube.com/watch?v=abc12345678")
 * // → {
 * //   videoId: "abc12345678",
 * //   content: "Welcome to this lecture on neural networks. Today we will..."
 * // }
 * ```
 *
 * @example Input → Error
 * ```ts
 * await fetchYoutubeTranscript("https://example.com/video")
 * // → throws ValidationError("Enter a valid YouTube URL")
 * ```
 */
export async function fetchYoutubeTranscript(url: string) {
    const videoId = extractYoutubeVideoId(url);

    if (!videoId) {
        throw new ValidationError("Enter a valid YouTube URL");
    }

    try {
        const segments = await YoutubeTranscript.fetchTranscript(videoId);
        const content = segments.map((segment) => segment.text).join(" ").trim();

        if (!content) {
            throw new ValidationError(
                "No transcript found for this video",
            );
        }

        return { videoId, content };
    } catch {
        throw new ValidationError(
            "Could not fetch transcript. The video may not have captions.",
        );
    }
}
