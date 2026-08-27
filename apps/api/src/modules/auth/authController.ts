import type { Request, RequestHandler, Response } from "express";
import { env } from "@/common/utils/envConfig";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "@/modules/audit/auditService";
import { authService } from "./authService";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "./authTokens";

/** Mirrors the access token into a GET-only cookie so EventSource can auth. */
const accessCookieOptions = {
	httpOnly: true,
	secure: env.isProduction,
	sameSite: "lax" as const,
	path: "/api/v1",
	maxAge: 60 * 60 * 1000,
};

const cookieOptions = {
	httpOnly: true,
	secure: env.isProduction,
	sameSite: "lax" as const,
	path: "/api/v1/auth",
	maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

class AuthController {
	public login: RequestHandler = async (req: Request, res: Response) => {
		const { email, password } = req.body;
		const { response, refreshToken } = await authService.login(email, password);
		if (refreshToken) res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
		const at = response.responseObject?.accessToken;
		if (at) res.cookie(ACCESS_COOKIE, at, accessCookieOptions);

		// Failures matter more than successes here: this box has exactly one
		// account and is reachable from the whole internet, so a run of
		// login_failed rows from one IP is the only warning you will get.
		// The email is recorded, never the password.
		audit.record({
			...audit.requestContext(req),
			action: response.success ? "auth.login" : "auth.login_failed",
			actorId: response.responseObject?.user?.id ?? null,
			metadata: { email: typeof email === "string" ? email.slice(0, 200) : null },
		});

		handleServiceResponse(response, res);
	};

	public refresh: RequestHandler = async (req: Request, res: Response) => {
		const { response, refreshToken } = await authService.refresh(req.cookies?.[REFRESH_COOKIE]);
		if (refreshToken) res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions);
		else res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
		const at2 = response.responseObject?.accessToken;
		if (at2) res.cookie(ACCESS_COOKIE, at2, accessCookieOptions);
		else res.clearCookie(ACCESS_COOKIE, { path: accessCookieOptions.path });
		handleServiceResponse(response, res);
	};

	public logout: RequestHandler = async (req: Request, res: Response) => {
		const response = await authService.logout(req.cookies?.[REFRESH_COOKIE]);
		// req.user is absent here (logout is not behind requireAuth), so this is
		// an actorless row — the point is the timeline, not who.
		audit.record({ ...audit.requestContext(req), action: "auth.logout" });
		res.clearCookie(REFRESH_COOKIE, { path: cookieOptions.path });
		res.clearCookie(ACCESS_COOKIE, { path: accessCookieOptions.path });
		handleServiceResponse(response, res);
	};

	public me: RequestHandler = async (req: Request, res: Response) => {
		handleServiceResponse(await authService.me(req.user!.id), res);
	};
}

export const authController = new AuthController();
