import express, { type Request, type Response, type Router } from "express";
import { logger } from "@/common/utils/logger";
import { verifyDownloadToken } from "./downloadToken";
import { streamZip } from "./zipService";

/**
 * `/zip/<token>/<name>.zip` — the folder download.
 *
 * Mounted OUTSIDE /api/v1 and proxied by Caddy straight through, because unlike
 * /dl this cannot be handed to file_server: the archive does not exist until it
 * is generated. It authenticates by token alone, exactly like /dl, so the URL is
 * copyable and shareable without a session.
 */
export const zipRouter: Router = express.Router();

zipRouter.get("/:token/:name", async (req: Request, res: Response) => {
	const verified = await verifyDownloadToken(req.params.token);

	if (!verified.ok || verified.claims.dirPath === undefined) {
		logger.warn({ expired: verified.ok ? false : verified.expired }, "zip download denied");
		// Bare 403, like /internal/authz: nothing to distinguish failure modes.
		return res.status(403).end();
	}

	await streamZip(verified.claims.dirPath, res);
});
