import type { Request, RequestHandler, Response } from "express";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
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

	public update: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await fileService.setPriority(req.params.id, req.body.priority), res);
	};
}

export const fileController = new FileController();
