import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../types/app-error.js";
import { getZodFieldErrors } from "../utils/zod-error.js";

export function errorHandler(
    error: unknown,
    _req: Request,
    res: Response,
    _next: NextFunction,
): void {
    if (error instanceof AppError) {
        res.status(error.statusCode).json({
            error: error.message,
            ...(error.details ? { details: error.details } : {}),
        });
        return;
    }

    if (error instanceof ZodError) {
        res.status(400).json({
            error: "Validation failed",
            details: getZodFieldErrors(error),
        });
        return;
    }

    console.error(error);
    res.status(500).json({ error: "Internal server error" });
}
