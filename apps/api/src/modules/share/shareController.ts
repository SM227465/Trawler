import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { shareService } from "./shareService";

/** Cookie proving a password-protected share was unlocked in this browser. */
export const shareUnlockCookie = (id: string) => `ct_share_${id}`;

class ShareController {
	public create: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await shareService.create(req.body, req.user!.id), res);
	};

	public list: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await shareService.list(req.user!.id), res);
	};

	public revoke: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await shareService.revoke(req.params.id, req.user!.id), res);
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
