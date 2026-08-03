import {
    createWorkspaceRecord,
    deleteWorkspaceRecord,
    findWorkspaceByIdAndUserId,
    findWorkspacesByUserId,
    updateWorkspaceRecord,
    type WorkspaceRecord,
} from "../repositories/workspace.repository.js";
import { deleteWorkspaceVectors } from "../lib/pinecone.js";
import { NotFoundError } from "../types/app-error.js";
import type {
    CreateWorkspaceInput,
    UpdateWorkspaceInput,
} from "../validators/workspace.validator.js";

/**
 * Lists all workspaces owned by a user, ordered by most recently updated.
 *
 * @param userId - Authenticated user's id
 * @returns Workspace records without internal user linkage fields
 *
 * @example Input → Output
 * ```ts
 * listWorkspacesByUser("user_abc123")
 * // → [
 * //   {
 * //     id: "ws_xyz789",
 * //     title: "Machine Learning Notes",
 * //     description: "Study workspace for ML course",
 * //     icon: "📚",
 * //     defaultModel: "gpt-4o-mini",
 * //     createdAt: Date,
 * //     updatedAt: Date
 * //   }
 * // ]
 * ```
 */
export function listWorkspacesByUser(userId: string) {
    return findWorkspacesByUserId(userId);
}

/**
 * Loads a workspace only if it belongs to the given user.
 *
 * @param workspaceId - Workspace to fetch
 * @param userId - Authenticated user's id
 * @returns The workspace record
 * @throws {NotFoundError} When the workspace does not exist or belongs to another user
 *
 * @example Input → Output
 * ```ts
 * await getWorkspaceByIdForUser("ws_xyz789", "user_abc123")
 * // → {
 * //   id: "ws_xyz789",
 * //   title: "Machine Learning Notes",
 * //   description: null,
 * //   icon: null,
 * //   defaultModel: "gpt-4o-mini",
 * //   createdAt: Date,
 * //   updatedAt: Date
 * // }
 * ```
 *
 * @example Input → Error
 * ```ts
 * await getWorkspaceByIdForUser("ws_other", "user_abc123")
 * // → throws NotFoundError("Workspace not found")
 * ```
 */
export async function getWorkspaceByIdForUser(
    workspaceId: string,
    userId: string,
): Promise<WorkspaceRecord> {
    const workspace = await findWorkspaceByIdAndUserId(workspaceId, userId);

    if (!workspace) {
        throw new NotFoundError("Workspace not found");
    }

    return workspace;
}

/**
 * Creates a new workspace for the authenticated user.
 *
 * @param userId - Owner of the new workspace
 * @param input - Workspace fields validated by {@link CreateWorkspaceInput}
 * @returns Newly created workspace record
 *
 * @example Input → Output
 * ```ts
 * createWorkspaceForUser("user_abc123", {
 *   title: "React Study",
 *   description: "Notes from frontend course",
 *   defaultModel: "gpt-4o-mini"
 * })
 * // → {
 * //   id: "ws_new456",
 * //   title: "React Study",
 * //   description: "Notes from frontend course",
 * //   icon: null,
 * //   defaultModel: "gpt-4o-mini",
 * //   createdAt: Date,
 * //   updatedAt: Date
 * // }
 * ```
 */
export function createWorkspaceForUser(
    userId: string,
    input: CreateWorkspaceInput,
) {
    return createWorkspaceRecord(userId, input);
}

/**
 * Updates workspace settings after verifying the user owns it.
 *
 * @param workspaceId - Workspace to update
 * @param userId - Authenticated user's id
 * @param input - Partial workspace fields to change
 * @returns Updated workspace record
 * @throws {NotFoundError} When the workspace is not found for this user
 *
 * @example Input → Output
 * ```ts
 * await updateWorkspaceForUser("ws_xyz789", "user_abc123", {
 *   title: "ML Notes (Updated)",
 *   defaultModel: "gpt-4o"
 * })
 * // → {
 * //   id: "ws_xyz789",
 * //   title: "ML Notes (Updated)",
 * //   defaultModel: "gpt-4o",
 * //   ...
 * // }
 * ```
 */
export async function updateWorkspaceForUser(
    workspaceId: string,
    userId: string,
    input: UpdateWorkspaceInput,
) {
    await getWorkspaceByIdForUser(workspaceId, userId);
    return updateWorkspaceRecord(workspaceId, input);
}

/**
 * Deletes a workspace and its Pinecone vector namespace.
 *
 * Pinecone cleanup is best-effort: deletion continues even if vector removal fails.
 *
 * @param workspaceId - Workspace to delete
 * @param userId - Authenticated user's id
 * @returns Resolves when the workspace row is deleted
 * @throws {NotFoundError} When the workspace is not found for this user
 *
 * @example Input → Output
 * ```ts
 * await deleteWorkspaceForUser("ws_xyz789", "user_abc123")
 * // → void (workspace row deleted, Pinecone namespace cleared)
 * ```
 */
export async function deleteWorkspaceForUser(
    workspaceId: string,
    userId: string,
) {
    await getWorkspaceByIdForUser(workspaceId, userId);

    try {
        await deleteWorkspaceVectors(workspaceId);
    } catch (error) {
        console.error("Failed to delete Pinecone namespace:", error);
    }

    await deleteWorkspaceRecord(workspaceId);
}
