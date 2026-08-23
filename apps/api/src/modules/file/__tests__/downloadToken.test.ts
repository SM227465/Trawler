import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { env } from "@/common/utils/envConfig";
import { signAccessToken } from "@/modules/auth/authTokens";
import { signDownloadToken, verifyDownloadToken } from "../downloadToken";

describe("download tokens", () => {
	const claims = { fileId: "11111111-1111-1111-1111-111111111111", userId: "22222222-2222-2222-2222-222222222222" };

	it("round-trips its claims", async () => {
		const r = await verifyDownloadToken(await signDownloadToken(claims));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.claims).toEqual(claims);
	});

	it("rejects a tampered token", async () => {
		const token = await signDownloadToken(claims);
		const forged = `${token.slice(0, -3)}aaa`;
		expect((await verifyDownloadToken(forged)).ok).toBe(false);
	});

	it("rejects garbage", async () => {
		expect((await verifyDownloadToken("not-a-token")).ok).toBe(false);
		expect((await verifyDownloadToken("")).ok).toBe(false);
	});

	/**
	 * The important one. Access and download tokens share a signing secret, so
	 * only the audience claim stops an access token from being replayed at /dl
	 * to reach ANY file — it carries a user id but no file scope.
	 */
	it("REFUSES an access token, despite the shared signing secret", async () => {
		const access = await signAccessToken({ id: claims.userId, email: "owner@example.com" });
		expect((await verifyDownloadToken(access)).ok).toBe(false);
	});
});

describe("token targets are mutually exclusive", () => {
	const userId = "22222222-2222-2222-2222-222222222222";

	it("round-trips a folder (zip) claim", async () => {
		const r = await verifyDownloadToken(await signDownloadToken({ dirPath: "Big Buck Bunny", userId }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.claims).toEqual({ dirPath: "Big Buck Bunny", userId });
	});

	it("round-trips a path claim", async () => {
		const r = await verifyDownloadToken(await signDownloadToken({ filePath: "a/b.mkv", userId }));
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.claims).toEqual({ filePath: "a/b.mkv", userId });
	});

	/**
	 * A token naming two targets is ambiguous, and ambiguity in an authorisation
	 * token is a bug waiting to be exploited — the two consumers could disagree
	 * about which one wins.
	 */
	it("REFUSES a token that names more than one target", async () => {
		const forged = await new SignJWT({ fid: "x", dp: "../../etc" })
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(userId)
			.setAudience("dl")
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(env.JWT_SECRET));
		expect((await verifyDownloadToken(forged)).ok).toBe(false);
	});

	it("REFUSES a token that names no target", async () => {
		const empty = await new SignJWT({})
			.setProtectedHeader({ alg: "HS256" })
			.setSubject(userId)
			.setAudience("dl")
			.setIssuedAt()
			.setExpirationTime("1h")
			.sign(new TextEncoder().encode(env.JWT_SECRET));
		expect((await verifyDownloadToken(empty)).ok).toBe(false);
	});
});
