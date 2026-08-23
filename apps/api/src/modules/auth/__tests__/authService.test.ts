import { eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, expect, it } from "vitest";
import { env } from "@/common/utils/envConfig";
import { db, pool } from "@/db/client";
import { refreshTokens, users } from "@/db/schema";
import { hashPassword } from "@/modules/auth/authService";
import { app } from "@/server";
import { describeWithDb } from "@/test/dbAvailable";

// Integration test against the dev Postgres. Doc 03 §A10 lists refresh-token
// rotation as non-negotiable regardless of coverage target.
const creds = { email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD };

const cookieOf = (res: request.Response) =>
	(res.headers["set-cookie"] as unknown as string[])?.find((c) => c.startsWith("ct_refresh="))?.split(";")[0] ?? "";

describeWithDb("auth", () => {
	let ownerId: string;

	beforeAll(async () => {
		// Seed the owner if absent rather than demanding `pnpm db:seed` first.
		// Requiring a manual step made this suite fail on a fresh clone with an
		// error about the fixture instead of anything to do with auth.
		let owner = await db.query.users.findFirst({ where: eq(users.email, creds.email.toLowerCase()) });

		if (!owner) {
			[owner] = await db
				.insert(users)
				.values({
					id: uuidv7(),
					email: creds.email.toLowerCase(),
					passwordHash: await hashPassword(creds.password),
				})
				.returning();
		}

		ownerId = owner.id;
		await db.delete(refreshTokens).where(eq(refreshTokens.userId, ownerId));
	});

	afterAll(async () => {
		await db.delete(refreshTokens).where(eq(refreshTokens.userId, ownerId));
		await pool.end();
	});

	it("rejects a wrong password with INVALID_CREDENTIALS", async () => {
		const res = await request(app)
			.post("/api/v1/auth/login")
			.send({ ...creds, password: "definitely-wrong" });
		expect(res.status).toBe(401);
		expect(res.body.code).toBe("INVALID_CREDENTIALS");
	});

	it("rejects a malformed email with VALIDATION_ERROR", async () => {
		const res = await request(app).post("/api/v1/auth/login").send({ email: "nope", password: "12345678" });
		expect(res.status).toBe(400);
		expect(res.body.code).toBe("VALIDATION_ERROR");
	});

	it("logs in and issues an access token plus a refresh cookie", async () => {
		const res = await request(app).post("/api/v1/auth/login").send(creds);
		expect(res.status).toBe(200);
		expect(res.body.responseObject.accessToken).toBeTruthy();
		expect(cookieOf(res)).toMatch(/^ct_refresh=/);
	});

	it("401s a protected route without a token", async () => {
		const res = await request(app).get("/api/v1/auth/me");
		expect(res.status).toBe(401);
		expect(res.body.code).toBe("AUTHENTICATION_REQUIRED");
	});

	it("accepts a protected route with a valid token", async () => {
		const login = await request(app).post("/api/v1/auth/login").send(creds);
		const res = await request(app)
			.get("/api/v1/auth/me")
			.set("authorization", `Bearer ${login.body.responseObject.accessToken}`);
		expect(res.status).toBe(200);
		expect(res.body.responseObject.email).toBe(creds.email.toLowerCase());
	});

	it("rotates the refresh token, issuing a different one", async () => {
		const login = await request(app).post("/api/v1/auth/login").send(creds);
		const first = cookieOf(login);
		const refreshed = await request(app).post("/api/v1/auth/refresh").set("Cookie", first);
		expect(refreshed.status).toBe(200);
		expect(cookieOf(refreshed)).not.toBe(first);
	});

	it("detects reuse of a spent refresh token and revokes the whole family", async () => {
		const login = await request(app).post("/api/v1/auth/login").send(creds);
		const stolen = cookieOf(login);

		const rotated = await request(app).post("/api/v1/auth/refresh").set("Cookie", stolen);
		const current = cookieOf(rotated);

		// Replay the spent token — this is the theft signal.
		const replay = await request(app).post("/api/v1/auth/refresh").set("Cookie", stolen);
		expect(replay.status).toBe(401);
		expect(replay.body.code).toBe("REFRESH_TOKEN_REUSED");

		// The legitimate holder's live token must die too, or theft is survivable.
		const after = await request(app).post("/api/v1/auth/refresh").set("Cookie", current);
		expect(after.status).toBe(401);
	});

	it("revokes on logout", async () => {
		const login = await request(app).post("/api/v1/auth/login").send(creds);
		const c = cookieOf(login);
		await request(app).post("/api/v1/auth/logout").set("Cookie", c).expect(200);
		const res = await request(app).post("/api/v1/auth/refresh").set("Cookie", c);
		expect(res.status).toBe(401);
	});
});
