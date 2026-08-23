import express, { type Request, type Response, type Router } from "express";
import { logger } from "@/common/utils/logger";
import { shareRepository } from "@/modules/share/shareRepository";
import { authorizeDownload } from "./authzService";

/**
 * NOT mounted under /api/v1 and NOT proxied by Caddy — the Caddyfile routes
 * only /api/*, /dl/* and /. This is reachable solely from inside the compose
 * network, by Caddy's forward_auth.
 *
 * Even if it were exposed it hands out a path header, never bytes; serving
 * requires Caddy's file_server. But keep it unrouted regardless.
 */
export const internalRouter: Router = express.Router();

internalRouter.get("/authz", async (req: Request, res: Response) => {
	const decision = await authorizeDownload({
		forwardedUri: req.header("X-Forwarded-Uri") ?? undefined,
		forwardedMethod: req.header("X-Forwarded-Method") ?? undefined,
	});

	if (!decision.allow) {
		logger.warn({ reason: decision.reason, uri: req.header("X-Forwarded-Uri") }, "download denied");
		// Bare 403: no body, no code, nothing to distinguish failure modes.
		return res.status(403).end();
	}

	// Quota accounting for share links.
	//
	// Charged at AUTHORISATION time, not on bytes actually delivered: Caddy
	// serves the file itself, so we never see the transfer finish, and a Range
	// request would under-count anyway. Over-counting a cancelled download is
	// the safe direction for a limit whose job is to cap exposure.
	if (decision.shareId) {
		void shareRepository
			.recordServed(decision.shareId, decision.sizeBytes)
			.catch((err) => logger.error({ err, shareId: decision.shareId }, "share accounting failed"));

		void shareRepository
			.logAccess({
				shareId: decision.shareId,
				ip: req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? null,
				userAgent: req.header("User-Agent")?.slice(0, 300) ?? null,
				bytes: decision.sizeBytes,
				status: 200,
			})
			.catch(() => {
				/* the log is best-effort; never block a download for it */
			});
	}

	// Caddy copies this header back onto the request, then rewrites the URI to
	// it. `copy_headers X-Accel-Path` in the Caddyfile is what makes that work.
	res.setHeader("X-Accel-Path", decision.accelPath);
	res.status(200).end();
});
