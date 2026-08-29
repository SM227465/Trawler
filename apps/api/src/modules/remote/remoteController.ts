import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { remoteService } from "./remoteService";

class RemoteController {
	public list: RequestHandler = async (_req: Request, res: Response) => {
		handleServiceResponse(await remoteService.list(), res);
	};

	public create: RequestHandler = async (req: Request, res: Response) => {
		const result = await remoteService.create(req.body);
		if (result.success) {
			// Credentials are never in metadata — only which provider and where.
			audit.recordFromRequest(req, {
				action: "storage.remote.add",
				targetType: "remote",
				targetId: req.body.name,
				metadata: { kind: req.body.kind, bucket: req.body.bucket },
			});
		}
		handleServiceResponse(result, res);
	};

	public test: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await remoteService.test(req.params.name), res);
	};

	public remove: RequestHandler = async (req: Request, res: Response) => {
		const result = await remoteService.remove(req.params.name);
		if (result.success) {
			audit.recordFromRequest(req, {
				action: "storage.remote.remove",
				targetType: "remote",
				targetId: req.params.name,
			});
		}
		handleServiceResponse(result, res);
	};
}

export const remoteController = new RemoteController();
