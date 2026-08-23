import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { storageService } from "./storageService";

class StorageController {
	public status: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await storageService.getStatus(), res);
	};

	public updateSettings: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await storageService.updateSettings(req.body), res);
	};

	public runEviction: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await storageService.triggerEviction(), res);
	};
}

export const storageController = new StorageController();
