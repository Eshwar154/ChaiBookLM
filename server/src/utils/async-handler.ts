/**
 * Express async route wrapper that forwards rejected promises to error middleware.
 */

import type {
    NextFunction,
    Request,
    RequestHandler,
    Response,
} from "express";

type AsyncRequestHandler = (
    req: Request,
    res: Response,
    next: NextFunction,
) => Promise<void>;

/**
 * Wraps an async Express handler so thrown errors and rejections reach `next(err)`.
 *
 * Without this wrapper, unhandled promise rejections in async routes would not
 * trigger the global error handler.
 *
 * @param handler - Async route handler function
 * @returns Express-compatible `RequestHandler`
 *
 * @example Input → Output
 * ```ts
 * router.get("/workspaces", asyncHandler(async (req, res) => {
 *   const workspaces = await listWorkspacesByUser(req.session.user.id);
 *   res.json(workspaces);
 * }));
 * // → Express calls handler; any thrown NotFoundError goes to error middleware
 * ```
 *
 * @example Input → Output (error propagation)
 * ```ts
 * asyncHandler(async () => { throw new NotFoundError("Not found"); })
 * // → next(NotFoundError) called automatically → 404 JSON response
 * ```
 */
export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
    return (req, res, next) => {
        void handler(req, res, next).catch(next);
    };
}
