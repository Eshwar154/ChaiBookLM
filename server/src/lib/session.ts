/**
 * Session type inferred from the Better Auth configuration.
 *
 * Use this type when typing Express request handlers that access `req.session`.
 */

import type { auth } from "../lib/auth.js";

/**
 * Authenticated session shape including `user` and `session` metadata.
 *
 * @example Input → Output (after auth middleware)
 * ```ts
 * // req.session.user:
 * // {
 * //   id: "user_abc123",
 * //   name: "Jane Doe",
 * //   email: "jane@example.com",
 * //   image: "https://..."
 * // }
 * ```
 */
export type Session = typeof auth.$Infer.Session;
