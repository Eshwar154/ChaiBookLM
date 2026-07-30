import { Router } from "express";
import { z } from "zod";
import prisma from "../lib/db.js";
import { requireAuth } from "../middleware/require-auth.js";

const createWorkspaceSchema = z.object({
    title: z.string().trim().min(1, "Title is required").max(120),
    description: z.string().trim().max(500).optional(),
    icon: z.string().trim().max(8).optional(),
});

const updateWorkspaceSchema = createWorkspaceSchema.partial().refine(
    (data) => Object.keys(data).length > 0,
    { message: "At least one field is required" },
);

const workspaceSelect = {
    id: true,
    title: true,
    description: true,
    icon: true,
    createdAt: true,
    updatedAt: true,
} as const;

export const workspacesRouter = Router();

workspacesRouter.use(requireAuth);

workspacesRouter.get("/", async (req, res) => {
    const workspaces = await prisma.workspace.findMany({
        where: { userId: req.session.user.id },
        select: workspaceSelect,
        orderBy: { updatedAt: "desc" },
    });

    res.json(workspaces);
});

workspacesRouter.post("/", async (req, res) => {
    const parsed = createWorkspaceSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }

    const workspace = await prisma.workspace.create({
        data: {
            userId: req.session.user.id,
            ...parsed.data,
        },
        select: workspaceSelect,
    });

    res.status(201).json(workspace);
});

workspacesRouter.get("/:id", async (req, res) => {
    const workspace = await prisma.workspace.findFirst({
        where: {
            id: req.params.id,
            userId: req.session.user.id,
        },
        select: workspaceSelect,
    });

    if (!workspace) {
        res.status(404).json({ error: "Workspace not found" });
        return;
    }

    res.json(workspace);
});

workspacesRouter.patch("/:id", async (req, res) => {
    const parsed = updateWorkspaceSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "Validation failed",
            details: parsed.error.flatten().fieldErrors,
        });
        return;
    }

    const existing = await prisma.workspace.findFirst({
        where: {
            id: req.params.id,
            userId: req.session.user.id,
        },
        select: { id: true },
    });

    if (!existing) {
        res.status(404).json({ error: "Workspace not found" });
        return;
    }

    const workspace = await prisma.workspace.update({
        where: { id: existing.id },
        data: parsed.data,
        select: workspaceSelect,
    });

    res.json(workspace);
});

workspacesRouter.delete("/:id", async (req, res) => {
    const existing = await prisma.workspace.findFirst({
        where: {
            id: req.params.id,
            userId: req.session.user.id,
        },
        select: { id: true },
    });

    if (!existing) {
        res.status(404).json({ error: "Workspace not found" });
        return;
    }

    await prisma.workspace.delete({
        where: { id: existing.id },
    });

    res.status(204).send();
});
