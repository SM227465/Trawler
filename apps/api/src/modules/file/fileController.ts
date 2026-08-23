import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { browseService } from "./browseService";
import { fileService } from "./fileService";

class FileController {
	public getLink: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await fileService.getDownloadLink(req.params.id, req.user!.id), res);
	};

	public browse: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await browseService.list(req.query.path as string | undefined), res);
	};

	public browseLink: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await browseService.link(req.query.path as string | undefined, req.user!.id), res);
	};

	public browseZipLink: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await browseService.zipLink(req.query.path as string | undefined, req.user!.id), res);
	};

	public browseDelete: RequestHandler = async (req: Request, res: Response) => {
		const target = req.query.path as string | undefined;
		const result = await browseService.remove(target);
		if (result.success) {
			const deleted = result.responseObject as { type?: string } | null;
			audit.recordFromRequest(req, {
				action: "file.delete",
				targetType: deleted?.type === "dir" ? "directory" : "file",
				targetId: target ?? null,
			});
		}
		handleServiceResponse(result, res);
	};

	public update: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await fileService.setPriority(req.params.id, req.body.priority), res);
	};
}

export const fileController = new FileController();
