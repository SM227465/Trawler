import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { shareService } from "./shareService";

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
		handleServiceResponse(await shareService.publicView(req.params.id, unlocked), res);
	};

	public unlock: RequestHandler = async (req: Request, res: Response) => {
		const result = await shareService.unlock(req.params.id, req.body.password);
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
