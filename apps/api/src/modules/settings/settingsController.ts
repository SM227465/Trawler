import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { settingsService } from "./settingsService";

class SettingsController {
	public getTransfer: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await settingsService.getTransfer(), res);
	};

	public getWebdav: RequestHandler = (_req: Request, res: Response) => {
		handleServiceResponse(settingsService.getWebdav(), res);
	};

	public updateTransfer: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await settingsService.updateTransfer(req.body), res);
	};
}

export const settingsController = new SettingsController();
