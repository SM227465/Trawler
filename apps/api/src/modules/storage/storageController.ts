import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { storageService } from "./storageService";

class StorageController {
	public status: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await storageService.getStatus(), res);
	};

	public updateSettings: RequestHandler = async (req: Request, res: Response) => {
		const result = await storageService.updateSettings(req.body);
		if (result.success) {
			// Turning eviction on is the single most consequential switch here: it
			// is the only setting that lets the box delete downloads unattended.
			audit.recordFromRequest(req, { action: "settings.storage", metadata: { ...req.body } });
		}
		handleServiceResponse(result, res);
	};

	public runEviction: RequestHandler = async (req: Request, res: Response) => {
		const result = await storageService.triggerEviction();
		if (result.success) {
			audit.recordFromRequest(req, { action: "storage.evict", metadata: { ...(result.responseObject ?? {}) } });
		}
		handleServiceResponse(result, res);
	};
}

export const storageController = new StorageController();
