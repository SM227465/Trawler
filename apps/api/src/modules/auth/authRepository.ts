import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "@/db/client";
import { refreshTokens, users } from "@/db/schema";

export class AuthRepository {
	findUserByEmail(email: string) {
		return db.query.users.findFirst({ where: eq(users.email, email.toLowerCase()) });
	}

	findUserById(id: string) {
		return db.query.users.findFirst({ where: eq(users.id, id) });
	}

	findTokenByHash(tokenHash: string) {
		return db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
	}

	async createToken(input: { userId: string; familyId: string; tokenHash: string; expiresAt: Date }) {
		const [row] = await db
			.insert(refreshTokens)
			.values({ id: uuidv7(), ...input })
			.returning();
		return row;
	}

	markUsed(id: string) {
		return db.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, id));
	}

	/** Theft response: kill every live token in the rotation chain. */
	revokeFamily(familyId: string) {
		return db
			.update(refreshTokens)
			.set({ revokedAt: new Date() })
			.where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
	}
}

export const authRepository = new AuthRepository();
