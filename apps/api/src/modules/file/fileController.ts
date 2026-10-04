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

	/**
	 * Raw JPEG bytes, not a ServiceResponse: an <img> reads this directly,
	 * authenticated by the access cookie (GET only — see requireAuth).
	 */
	public browseThumb: RequestHandler = async (req: Request, res: Response) => {
		const result = await browseService.thumbnail(req.query.path as string | undefined);
		if ("file" in result) {
			// The URL carries the file's mtime, so a cached copy can never be stale.
			res.setHeader("Cache-Control", "private, max-age=604800, immutable");
			return res.sendFile(result.file);
		}
		// Remembered for a day, so a file with no thumbnail is not asked again on
		// every scroll. A busy queue is not remembered: it will have room soon.
		res.setHeader("Cache-Control", result.status === 404 ? "private, max-age=86400" : "no-store");
		return res.status(result.status).end();
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
