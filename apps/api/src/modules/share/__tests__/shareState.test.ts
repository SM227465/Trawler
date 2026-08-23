import { describe, expect, it } from "vitest";
import { isShareIdShape, newShareId } from "../shareId";
import { isActive, protectsFromEviction, type ShareLike, shareState } from "../shareState";

/**
 * Doc 03 §A10 marks this matrix non-negotiable. A bug here either keeps serving
 * a link the owner revoked, or kills a link that should work.
 */

const NOW = new Date("2026-08-23T12:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 3600_000);

const share = (over: Partial<ShareLike> = {}): ShareLike => ({
	revokedAt: null,
	expiresAt: null,
	maxBytes: null,
	bytesServed: 0,
	...over,
});

describe("shareState — active", () => {
	it("a plain share with no limits is active", () => {
		expect(shareState(share(), NOW)).toEqual({ active: true });
	});

	it("is active while the expiry is still in the future", () => {
		expect(isActive(share({ expiresAt: hoursFromNow(1) }), NOW)).toBe(true);
	});

	it("is active while under quota", () => {
		expect(isActive(share({ maxBytes: 1000, bytesServed: 999 }), NOW)).toBe(true);
	});
});

describe("shareState — inactive", () => {
	it("revoked", () => {
		expect(shareState(share({ revokedAt: hoursFromNow(-1) }), NOW)).toEqual({ active: false, reason: "revoked" });
	});

	it("expired", () => {
		expect(shareState(share({ expiresAt: hoursFromNow(-1) }), NOW)).toEqual({ active: false, reason: "expired" });
	});

	it("expiry exactly now counts as expired, not active", () => {
		// The boundary. `>` instead of `>=` here would serve one extra request.
		expect(shareState(share({ expiresAt: new Date(NOW) }), NOW)).toEqual({ active: false, reason: "expired" });
	});

	it("quota exactly met counts as spent", () => {
		expect(shareState(share({ maxBytes: 1000, bytesServed: 1000 }), NOW)).toEqual({
			active: false,
			reason: "quota",
		});
	});

	it("quota exceeded", () => {
		expect(shareState(share({ maxBytes: 1000, bytesServed: 5000 }), NOW)).toEqual({
			active: false,
			reason: "quota",
		});
	});
});

describe("shareState — precedence", () => {
	it("reports revoked ahead of expired — revocation is what the owner did", () => {
		const s = share({ revokedAt: hoursFromNow(-2), expiresAt: hoursFromNow(-1) });
		expect(shareState(s, NOW)).toEqual({ active: false, reason: "revoked" });
	});

	it("reports revoked ahead of quota", () => {
		const s = share({ revokedAt: hoursFromNow(-1), maxBytes: 10, bytesServed: 999 });
		expect(shareState(s, NOW)).toEqual({ active: false, reason: "revoked" });
	});

	it("reports expired ahead of quota", () => {
		const s = share({ expiresAt: hoursFromNow(-1), maxBytes: 10, bytesServed: 999 });
		expect(shareState(s, NOW)).toEqual({ active: false, reason: "expired" });
	});

	it("a revoked share is never resurrected by a future expiry", () => {
		expect(isActive(share({ revokedAt: hoursFromNow(-1), expiresAt: hoursFromNow(99) }), NOW)).toBe(false);
	});
});

describe("protectsFromEviction — deliberately broader than isActive", () => {
	it("a spent quota does NOT release eviction protection", () => {
		// The distinction that matters: raising the quota must not require the
		// files to still be there by luck.
		const s = share({ maxBytes: 1000, bytesServed: 1000 });
		expect(isActive(s, NOW)).toBe(false);
		expect(protectsFromEviction(s, NOW)).toBe(true);
	});

	it("revoked releases protection", () => {
		expect(protectsFromEviction(share({ revokedAt: hoursFromNow(-1) }), NOW)).toBe(false);
	});

	it("expired releases protection", () => {
		expect(protectsFromEviction(share({ expiresAt: hoursFromNow(-1) }), NOW)).toBe(false);
	});

	it("matches doc 02 §4's eviction query exactly: revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())", () => {
		const cases: Array<[ShareLike, boolean]> = [
			[share(), true],
			[share({ expiresAt: hoursFromNow(1) }), true],
			[share({ expiresAt: hoursFromNow(-1) }), false],
			[share({ revokedAt: hoursFromNow(-1) }), false],
			[share({ maxBytes: 1, bytesServed: 99 }), true],
		];
		for (const [s, expected] of cases) expect(protectsFromEviction(s, NOW)).toBe(expected);
	});
});

describe("share ids", () => {
	it("are 16 URL-safe characters", () => {
		const id = newShareId();
		expect(id).toHaveLength(16);
		expect(id).toMatch(/^[0-9A-Za-z]+$/);
	});

	it("omit look-alike characters that get mis-transcribed", () => {
		// No I, l, O, o, U, u — a share id gets read aloud and retyped.
		for (let i = 0; i < 200; i++) expect(newShareId()).not.toMatch(/[IlOoUu]/);
	});

	it("do not collide across many draws", () => {
		const seen = new Set(Array.from({ length: 5000 }, () => newShareId()));
		expect(seen.size).toBe(5000);
	});

	it("shape check rejects obvious rubbish", () => {
		expect(isShareIdShape(newShareId())).toBe(true);
		expect(isShareIdShape("../../etc")).toBe(false);
		expect(isShareIdShape("short")).toBe(false);
		expect(isShareIdShape("")).toBe(false);
	});
});
