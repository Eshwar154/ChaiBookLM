import {
    addUserMemory,
    deleteUserMemory,
    listUserMemories,
    updateUserMemory,
    type AppMemory,
} from "../lib/mem0.js";
import { ValidationError } from "../types/app-error.js";

export type { AppMemory };

export async function listMemoriesForUser(userId: string) {
    return listUserMemories(userId);
}

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

export async function deleteMemoryForUser(_userId: string, memoryId: string) {
    await deleteUserMemory(memoryId);
}
