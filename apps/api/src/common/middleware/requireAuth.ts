import type { NextFunction, Request, Response } from "express";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { ACCESS_COOKIE, verifyAccessToken } from "@/modules/auth/authTokens";

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
	const header = req.headers.authorization;
	// Cookie fallback for EventSource, which cannot set headers. GET only: no
	// state-changing request is ever cookie-authenticated, so CSRF is moot.
	const cookieToken = req.method === "GET" ? (req.cookies?.[ACCESS_COOKIE] as string | undefined) : undefined;
	const token = header?.startsWith("Bearer ") ? header.slice(7) : cookieToken;

	if (!token) {
		return handleServiceResponse(
			ServiceResponse.failure(
				"Authentication required",
				null,
				ErrorCode.AUTHENTICATION_REQUIRED,
				"AUTHENTICATION_REQUIRED",
			),
			res,
		);
	}

	const result = await verifyAccessToken(token);
	if (!result.ok) {
		return handleServiceResponse(
			ServiceResponse.failure(
				result.expired ? "Access token expired" : "Invalid access token",
				null,
				ErrorCode.INVALID_TOKEN,
				result.expired ? "TOKEN_EXPIRED" : "INVALID_TOKEN",
			),
			res,
		);
	}

	req.user = result.user;
	next();
};
