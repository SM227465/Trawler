import { Algorithm, hash, verify } from "@node-rs/argon2";
import { v7 as uuidv7 } from "uuid";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import type { AuthPayload, PublicUser } from "./authModel";
import { authRepository } from "./authRepository";
import { hashRefreshToken, mintRefreshToken, signAccessToken } from "./authTokens";

const ARGON = { algorithm: Algorithm.Argon2id } as const;

// Burned when the email is unknown, so a missing user and a wrong password take
// the same time. Prevents user enumeration via response latency.
const DUMMY_HASH = "$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$Q9Yk6+3xJ5wTtLZ3Hn6VvVQnJZLZ7lqZ0Zx8Yt0kQ0M";

export type AuthResult = { response: ServiceResponse<AuthPayload | null>; refreshToken?: string };

const toPublic = (u: { id: string; email: string; createdAt: Date }): PublicUser => ({
	id: u.id,
	email: u.email,
	createdAt: u.createdAt,
});

export const hashPassword = (plain: string) => hash(plain, ARGON);

/** Shared with share unlocking so argon parameters are defined in one place. */
export const verifyPassword = (storedHash: string, plain: string) =>
	verify(storedHash, plain, ARGON).catch(() => false);

export class AuthService {
	private async issue(user: { id: string; email: string; createdAt: Date }, familyId: string): Promise<AuthResult> {
		const raw = mintRefreshToken();
		const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);

		await authRepository.createToken({
			userId: user.id,
			familyId,
			tokenHash: hashRefreshToken(raw),
			expiresAt,
		});

		const accessToken = await signAccessToken(user);
		return {
			response: ServiceResponse.success<AuthPayload>("Authenticated", { accessToken, user: toPublic(user) }),
			refreshToken: raw,
		};
	}

	async login(email: string, password: string): Promise<AuthResult> {
		const user = await authRepository.findUserByEmail(email);

		if (!user) {
			await verify(DUMMY_HASH, password, ARGON).catch(() => false);
			return { response: this.invalidCredentials() };
		}

		const ok = await verify(user.passwordHash, password, ARGON).catch(() => false);
		if (!ok) return { response: this.invalidCredentials() };

		return this.issue(user, uuidv7());
	}

	async refresh(rawToken: string | undefined): Promise<AuthResult> {
		if (!rawToken) return { response: this.unauthorized("No refresh token", "AUTHENTICATION_REQUIRED") };

		const row = await authRepository.findTokenByHash(hashRefreshToken(rawToken));
		if (!row) return { response: this.unauthorized("Invalid refresh token", "INVALID_TOKEN") };

		// Reuse detection: a token presented twice means the chain leaked.
		// Kill the whole family — the legitimate holder must log in again.
		if (row.usedAt) {
			await authRepository.revokeFamily(row.familyId);
			logger.warn({ familyId: row.familyId, userId: row.userId }, "refresh token reuse — family revoked");
			return { response: this.unauthorized("Refresh token reuse detected", "REFRESH_TOKEN_REUSED") };
		}

		if (row.revokedAt) return { response: this.unauthorized("Refresh token revoked", "INVALID_TOKEN") };
		if (row.expiresAt.getTime() < Date.now()) {
			return { response: this.unauthorized("Refresh token expired", "TOKEN_EXPIRED") };
		}

		const user = await authRepository.findUserById(row.userId);
		if (!user) return { response: this.unauthorized("Invalid refresh token", "INVALID_TOKEN") };

		await authRepository.markUsed(row.id);
		return this.issue(user, row.familyId); // same family — rotation, not a new chain
	}

	async logout(rawToken: string | undefined): Promise<ServiceResponse<null>> {
		if (rawToken) {
			const row = await authRepository.findTokenByHash(hashRefreshToken(rawToken));
			if (row) await authRepository.revokeFamily(row.familyId);
		}
		return ServiceResponse.success<null>("Logged out", null);
	}

	async me(userId: string): Promise<ServiceResponse<PublicUser | null>> {
		const user = await authRepository.findUserById(userId);
		if (!user) {
			return ServiceResponse.failure("User not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		return ServiceResponse.success<PublicUser>("OK", toPublic(user));
	}

	private invalidCredentials() {
		return ServiceResponse.failure<null>(
			"Invalid email or password",
			null,
			ErrorCode.INVALID_CREDENTIALS,
			"INVALID_CREDENTIALS",
		);
	}

	private unauthorized(message: string, code: string) {
		return ServiceResponse.failure<null>(message, null, ErrorCode.AUTHENTICATION_REQUIRED, code);
	}
}

export const authService = new AuthService();
