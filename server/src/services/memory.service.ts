import {
    addUserMemory,
    deleteUserMemory,
    listUserMemories,
    updateUserMemory,
    type AppMemory,
} from "../lib/mem0.js";
import { ValidationError } from "../types/app-error.js";

export type { AppMemory };

/**
 * Lists all long-term memories stored for a user via Mem0.
 *
 * @param userId - Authenticated user's id
 * @returns Array of memory records with id, text, timestamps, and source
 *
 * @example Input → Output
 * ```ts
 * await listMemoriesForUser("user_abc123")
 * // → [
 * //   {
 * //     id: "mem_001",
 * //     memory: "User prefers concise explanations",
 * //     createdAt: "2026-08-03T10:00:00.000Z",
 * //     updatedAt: "2026-08-03T10:00:00.000Z",
 * //     source: "manual",
 * //     metadata: { source: "manual" }
 * //   },
 * //   {
 * //     id: "mem_002",
 * //     memory: "User is studying transformers",
 * //     source: "learned",
 * //     ...
 * //   }
 * // ]
 * ```
 */
export async function listMemoriesForUser(userId: string) {
    return listUserMemories(userId);
}

/**
 * Creates a user-authored memory (not inferred by Mem0).
 *
 * @param userId - Owner of the memory
 * @param input - Raw memory text from the client
 * @returns Created Mem0 memory record
 * @throws {ValidationError} When memory text is empty after trimming
 *
 * @example Input → Output
 * ```ts
 * await createMemoryForUser("user_abc123", {
 *   memory: "  I learn best with analogies  "
 * })
 * // → {
 * //   id: "mem_new789",
 * //   memory: "I learn best with analogies",
 * //   source: "manual",
 * //   metadata: { source: "manual" },
 * //   createdAt: "2026-08-03T10:00:00.000Z",
 * //   updatedAt: "2026-08-03T10:00:00.000Z"
 * // }
 * ```
 *
 * @example Input → Error
 * ```ts
 * await createMemoryForUser("user_abc123", { memory: "   " })
 * // → throws ValidationError("Memory text is required")
 * ```
 */
export async function createMemoryForUser(
    userId: string,
    input: { memory: string },
) {
    const memory = input.memory.trim();

    if (!memory) {
        throw new ValidationError("Memory text is required");
    }

    return addUserMemory(userId, {
        memory,
        infer: false,
        metadata: { source: "manual" },
    });
}

/**
 * Updates the text of an existing memory by id.
 *
 * @param _userId - Reserved for future ownership checks
 * @param memoryId - Mem0 memory id to update
 * @param input - New memory text
 * @returns Updated Mem0 memory record
 * @throws {ValidationError} When memory is missing or empty
 *
 * @example Input → Output
 * ```ts
 * await updateMemoryForUser("user_abc123", "mem_001", {
 *   memory: "User prefers step-by-step explanations"
 * })
 * // → {
 * //   id: "mem_001",
 * //   memory: "User prefers step-by-step explanations",
 * //   updatedAt: "2026-08-03T11:00:00.000Z",
 * //   ...
 * // }
 * ```
 */
export async function updateMemoryForUser(
    _userId: string,
    memoryId: string,
    input: { memory?: string },
) {
    if (input.memory === undefined) {
        throw new ValidationError("Memory text is required");
    }

    const memory = input.memory.trim();

    if (!memory) {
        throw new ValidationError("Memory text is required");
    }

    return updateUserMemory(memoryId, { memory });
}

/**
 * Permanently deletes a memory from Mem0.
 *
 * @param _userId - Reserved for future ownership checks
 * @param memoryId - Mem0 memory id to delete
 * @returns Resolves when Mem0 confirms deletion
 *
 * @example Input → Output
 * ```ts
 * await deleteMemoryForUser("user_abc123", "mem_001")
 * // → void
 * ```
 */
export async function deleteMemoryForUser(_userId: string, memoryId: string) {
    await deleteUserMemory(memoryId);
}
