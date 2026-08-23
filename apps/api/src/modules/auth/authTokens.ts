import { createHash, randomBytes } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { env } from "@/common/utils/envConfig";

const accessKey = new TextEncoder().encode(env.JWT_SECRET);

/**
 * HS256, not RS256. The skill reference suggests asymmetric, which matters when
 * a third party verifies without the signing key. Here one service both issues
 * and verifies, so symmetric is correct and simpler.
 */
export const signAccessToken = (user: { id: string; email: string }) =>
	new SignJWT({ email: user.email })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(user.id)
		.setIssuedAt()
		.setExpirationTime(env.ACCESS_TOKEN_TTL)
		.sign(accessKey);

type VerifyResult = { ok: true; user: { id: string; email: string } } | { ok: false; expired: boolean };

export const verifyAccessToken = async (token: string): Promise<VerifyResult> => {
	try {
		const { payload } = await jwtVerify(token, accessKey);
		if (!payload.sub) return { ok: false, expired: false };
		return { ok: true, user: { id: payload.sub, email: String(payload.email ?? "") } };
	} catch (err) {
		const expired = (err as { code?: string }).code === "ERR_JWT_EXPIRED";
		return { ok: false, expired };
	}
};

/** Refresh tokens are opaque random bytes — never JWTs. Only the hash is stored. */
export const mintRefreshToken = () => randomBytes(32).toString("base64url");
export const hashRefreshToken = (raw: string) => createHash("sha256").update(raw).digest("hex");

export const REFRESH_COOKIE = "ct_refresh";
export const ACCESS_COOKIE = "ct_access";
