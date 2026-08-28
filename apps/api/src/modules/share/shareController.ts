import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { shareRepository } from "./shareRepository";
import { shareService } from "./shareService";

/** Caddy fronts these, so req.ip is the proxy — XFF carries the real caller. */
const clientIp = (req: Request) => req.header("X-Forwarded-For")?.split(",")[0]?.trim() ?? req.ip ?? null;
const userAgent = (req: Request) => req.header("User-Agent")?.slice(0, 300) ?? null;

/** Cookie proving a password-protected share was unlocked in this browser. */
export const shareUnlockCookie = (id: string) => `ct_share_${id}`;

class ShareController {
	public create: RequestHandler = async (req: Request, res: Response) => {
		const result = await shareService.create(req.body, req.user!.id);
		if (result.success) {
			const share = result.responseObject as { id?: string } | null;
			audit.recordFromRequest(req, {
				action: "share.create",
				targetType: "share",
				targetId: share?.id ?? null,
				// A share link is a capability handed to strangers, so what it
				// permits is exactly what you want on record when one leaks.
				metadata: {
					label: req.body?.label ?? null,
					hasPassword: Boolean(req.body?.password),
					expiryHours: req.body?.expiryHours ?? null,
					allowDownload: req.body?.allowDownload ?? true,
				},
			});
		}
		handleServiceResponse(result, res);
	};

	public list: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await shareService.list(req.user!.id), res);
	};

	public clearDead: RequestHandler = async (req: Request, res: Response) => {
		const result = await shareService.clearDead(req.user!.id);
		if (result.success) {
			const out = result.responseObject as { removed?: number } | null;
			audit.recordFromRequest(req, {
				action: "share.clear",
				targetType: "share",
				metadata: { removed: out?.removed ?? 0 },
			});
		}
		handleServiceResponse(result, res);
	};

	public access: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await shareService.access(req.params.id), res);
	};

	public revoke: RequestHandler = async (req: Request, res: Response) => {
		const result = await shareService.revoke(req.params.id, req.user!.id);
		if (result.success) {
			audit.recordFromRequest(req, { action: "share.revoke", targetType: "share", targetId: req.params.id });
		}
		handleServiceResponse(result, res);
	};

	// ── public, unauthenticated ──
	public publicView: RequestHandler = async (req: Request, res: Response) => {
		const unlocked = req.cookies?.[shareUnlockCookie(req.params.id)] === "1";
		const result = await shareService.publicView(req.params.id, unlocked);

		// Views were never recorded, so "40 downloads" could be one download and
		// 39 people opening the page. Only logged once the share is known to
		// exist — logging misses would let anyone fill the table with garbage.
		//
		// `x-trawler-view` is set by the page render only. Next also calls this
		// endpoint from generateMetadata, which would otherwise double every
		// count, and link-preview crawlers hit that path too.
		if (result.success && req.header("x-trawler-view") === "1") {
			shareRepository.logAccessSafe({
				shareId: req.params.id,
				kind: "view",
				status: 200,
				ip: clientIp(req),
				userAgent: userAgent(req),
				bytes: 0,
			});
		}
		handleServiceResponse(result, res);
	};

	public unlock: RequestHandler = async (req: Request, res: Response) => {
		const result = await shareService.unlock(req.params.id, req.body.password);

		// The whole point of a password on a share is that someone might try to
		// get past it. That attempt left no trace anywhere before this.
		if (!result.success) {
			shareRepository.logAccessSafe({
				shareId: req.params.id,
				kind: "unlock_failed",
				status: result.statusCode,
				reason: result.message,
				ip: clientIp(req),
				userAgent: userAgent(req),
				bytes: 0,
			});
		}

		if (result.success) {
			res.cookie(shareUnlockCookie(req.params.id), "1", {
				httpOnly: true,
				sameSite: "lax",
				secure: process.env.NODE_ENV === "production",
				maxAge: 12 * 3600_000,
				path: "/",
			});
		}
		handleServiceResponse(result, res);
	};
}

export const shareController = new ShareController();
