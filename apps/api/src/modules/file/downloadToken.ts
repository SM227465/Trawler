import { jwtVerify, SignJWT } from "jose";
import { env } from "@/common/utils/envConfig";

const key = new TextEncoder().encode(env.JWT_SECRET);

/**
 * Download tokens are separate from access tokens and MUST NOT be
 * interchangeable. Both are HS256 over the same secret, so the audience claim is
 * what keeps them apart: an access token presented to /dl is rejected because it
 * carries no `aud: "dl"`, and a download token presented to a normal API route
 * is rejected by `requireAuth`'s verifier, which does not accept this audience.
 *
 * They are also deliberately NOT revocable. They are short-lived and scoped to
 * one file; revocation is what SHARE links are for (doc 01 §5.5), where a DB row
 * can be killed individually.
 */
const AUDIENCE = "dl";

/**
 * A token names EITHER a torrent_files row (`fileId`) or a root-relative path
 * (`filePath`, from the file browser, which lists the filesystem and so covers
 * files with no DB row). Both are resolved and containment-checked before any
 * byte is served — the token is an authorisation, never a path oracle.
 */
export type DownloadClaims =
	| { fileId: string; filePath?: undefined; dirPath?: undefined; userId: string }
	| { filePath: string; fileId?: undefined; dirPath?: undefined; userId: string }
	/** A folder, served as a streamed zip. Cannot go through Caddy. */
	| { dirPath: string; fileId?: undefined; filePath?: undefined; userId: string };

const payloadFor = (c: DownloadClaims) => {
	if (c.fileId !== undefined) return { fid: c.fileId };
	if (c.filePath !== undefined) return { fp: c.filePath };
	return { dp: c.dirPath };
};

export const signDownloadToken = (claims: DownloadClaims) =>
	new SignJWT(payloadFor(claims))
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(claims.userId)
		.setAudience(AUDIENCE)
		.setIssuedAt()
		.setExpirationTime(`${env.DOWNLOAD_TOKEN_TTL_SECONDS}s`)
		.sign(key);

export type DownloadVerify = { ok: true; claims: DownloadClaims } | { ok: false; expired: boolean };

export const verifyDownloadToken = async (token: string): Promise<DownloadVerify> => {
	try {
		const { payload } = await jwtVerify(token, key, { audience: AUDIENCE });
		if (!payload.sub) return { ok: false, expired: false };

		const fileId = typeof payload.fid === "string" ? payload.fid : null;
		const filePath = typeof payload.fp === "string" ? payload.fp : null;
		const dirPath = typeof payload.dp === "string" ? payload.dp : null;

		// Exactly ONE target. A token naming two things, or none, is malformed.
		const targets = [fileId, filePath, dirPath].filter((v) => v !== null);
		if (targets.length !== 1) return { ok: false, expired: false };

		if (fileId) return { ok: true, claims: { fileId, userId: payload.sub } };
		if (filePath) return { ok: true, claims: { filePath, userId: payload.sub } };
		return { ok: true, claims: { dirPath: dirPath as string, userId: payload.sub } };
	} catch (err) {
		return { ok: false, expired: (err as { code?: string }).code === "ERR_JWT_EXPIRED" };
	}
};
