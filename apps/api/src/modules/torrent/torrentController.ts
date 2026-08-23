import type { Request, RequestHandler, Response } from "express";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { torrentService } from "./torrentService";

class TorrentController {
	public add: RequestHandler = async (req: Request, res: Response) => {
		const { magnet, pinned } = req.body;
		handleServiceResponse(await torrentService.add(magnet, req.user!.id, pinned ?? false), res);
	};

	public addFile: RequestHandler = async (req: Request, res: Response) => {
		const file = (req as Request & { file?: Express.Multer.File }).file;
		if (!file) {
			return handleServiceResponse(
				ServiceResponse.failure("No .torrent file uploaded", null, 400, "VALIDATION_ERROR"),
				res,
			);
		}
		handleServiceResponse(await torrentService.addFromFile(file.buffer, file.originalname, req.user!.id, false), res);
	};

	public addBatch: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await torrentService.addMany(req.body.magnets, req.user!.id), res);
	};

	public addFiles: RequestHandler = async (req: Request, res: Response) => {
		const files = (req as Request & { files?: Express.Multer.File[] }).files ?? [];
		if (files.length === 0) {
			return handleServiceResponse(
				ServiceResponse.failure("No .torrent files uploaded", null, 400, "VALIDATION_ERROR"),
				res,
			);
		}
		handleServiceResponse(await torrentService.addManyFiles(files, req.user!.id), res);
	};

	public list: RequestHandler = async (req: Request, res: Response) => {
		const { status, q, limit, offset } = req.query as unknown as {
			status?: string;
			q?: string;
			limit: number;
			offset: number;
		};
		handleServiceResponse(await torrentService.list({ status, q, limit, offset }), res);
	};

	public get: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.get(req.params.id as string), res);
	};

	public files: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.files(req.params.id as string), res);
	};

	public pause: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.pause(req.params.id as string), res);
	};

	public resume: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.resume(req.params.id as string), res);
	};

	public recheck: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.recheck(req.params.id as string), res);
	};

	public pin: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.setPinned(req.params.id as string, true), res);
	};

	public unpin: RequestHandler = async (req, res) => {
		handleServiceResponse(await torrentService.setPinned(req.params.id as string, false), res);
	};

	public remove: RequestHandler = async (req, res) => {
		const deleteFiles = (req.query as unknown as { deleteFiles: boolean }).deleteFiles;
		const result = await torrentService.remove(req.params.id as string, deleteFiles);
		if (result.success) {
			// deleteFiles is the difference between "removed from the list" and
			// "gone from disk". Without it the entry cannot answer the only
			// question anyone asks afterwards.
			audit.recordFromRequest(req, {
				action: "torrent.remove",
				targetType: "torrent",
				targetId: req.params.id as string,
				metadata: { deleteFiles: Boolean(deleteFiles) },
			});
		}
		handleServiceResponse(result, res);
	};
}

export const torrentController = new TorrentController();
