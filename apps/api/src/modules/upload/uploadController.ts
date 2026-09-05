import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { uploadService } from "./uploadService";

class UploadController {
	public list: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await uploadService.list(), res);
	};

	public create: RequestHandler = async (req: Request, res: Response) => {
		const direction = (req.body.direction ?? "up") as "up" | "down";
		const result = await uploadService.queue(req.body.remote, req.body.path, direction);
		if (result.success) {
			const row = result.responseObject as { id?: string } | null;
			// Started here rather than queued through pg-boss. Only the worker runs
			// boss, so the api cannot send to it — and it does not need to: start()
			// needs rclone and the database, both of which this process has, and
			// rclone does the transfer asynchronously anyway. Fire-and-forget so
			// the response does not wait on the provider's first byte; the
			// reconciler starts anything this misses.
			if (row?.id) void uploadService.start(row.id);
			audit.recordFromRequest(req, {
				action: "storage.upload",
				targetType: "upload",
				targetId: row?.id ?? null,
				metadata: { remote: req.body.remote, path: req.body.path, direction },
			});
		}
		handleServiceResponse(result, res);
	};

	public retry: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await uploadService.retry(req.params.id), res);
	};

	public cancel: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await uploadService.cancel(req.params.id), res);
	};

	public clear: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await uploadService.clearFinished(), res);
	};
}

export const uploadController = new UploadController();
