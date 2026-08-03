/**
 * Zod validation error formatting for API responses.
 */

import { flattenError, type ZodError } from "zod";

/**
 * Flattens a Zod validation error into per-field error message arrays.
 *
 * Used by controllers to return `{ fieldErrors: { title: ["Required"], ... } }`.
 *
 * @param error - Zod error from `safeParse`
 * @returns Field name → array of error message strings
 *
 * @example Input → Output
 * ```ts
 * const result = createWorkspaceSchema.safeParse({ title: "" });
 * if (!result.success) {
 *   getZodFieldErrors(result.error)
 * }
 * // → { title: ["Title is required"] }
 * ```
 *
 * @example Input → Output (multiple fields)
 * ```ts
 * getZodFieldErrors(zodError)
 * // → {
 * //   title: ["Title is required"],
 * //   defaultModel: ["Invalid enum value"]
 * // }
 * ```
 */
export function getZodFieldErrors(error: ZodError) {
    return flattenError(error).fieldErrors;
}
