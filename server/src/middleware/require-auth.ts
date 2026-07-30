import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Session } from "../lib/session.js";
import { auth } from "../lib/auth.js";

declare module "express-serve-static-core" {
    interface Request {
        session: Session;
    }
}

export async function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers),
    });

    if (!session?.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
    }

    req.session = session;
    next();
}
