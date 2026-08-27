import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { settingsService } from "./settingsService";

class SettingsController {
	public getTransfer: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await settingsService.getTransfer(), res);
	};

	public getWebdav: RequestHandler = (_req: Request, res: Response) => {
		handleServiceResponse(settingsService.getWebdav(), res);
	};

	public updateTransfer: RequestHandler = async (req: Request, res: Response) => {
		const result = await settingsService.updateTransfer(req.body);
		if (result.success) {
			// These limits are what stand between seeding and the 10 TB egress
			// allowance, so a change to them is worth being able to date.
			audit.recordFromRequest(req, { action: "settings.transfer", metadata: { ...req.body } });
		}
		handleServiceResponse(result, res);
	};
}

export const settingsController = new SettingsController();
