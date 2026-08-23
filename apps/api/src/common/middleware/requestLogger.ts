import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import pinoHttp from "pino-http";
import { logger } from "@/common/utils/logger";

const getLogLevel = (status: number) => {
	if (status >= StatusCodes.INTERNAL_SERVER_ERROR) return "error";
	if (status >= StatusCodes.BAD_REQUEST) return "warn";
	return "info";
};

/** Single source of the request id. `handleServiceResponse` reads res.locals. */
const addRequestId = (req: Request, res: Response, next: NextFunction) => {
	const incoming = req.headers["x-request-id"];
	const id = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();

	req.headers["x-request-id"] = id;
	res.locals.requestId = id;
	res.setHeader("x-request-id", id);
	next();
};

const httpLogger = pinoHttp({
	logger,
	genReqId: (req) => req.headers["x-request-id"] as string,
	customLogLevel: (_req, res) => getLogLevel(res.statusCode),
	customSuccessMessage: (req) => `${req.method} ${req.url} completed`,
	customErrorMessage: (_req, res) => `Request failed with status code: ${res.statusCode}`,
	serializers: {
		req: (req) => ({ method: req.method, url: req.url, id: req.id }),
	},
});

export default [addRequestId, httpLogger];
