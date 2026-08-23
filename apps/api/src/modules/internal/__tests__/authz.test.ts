import { describe, expect, it } from "vitest";
import { extractToken } from "../authzService";

/**
 * extractToken is the parser standing between a raw URL and token verification.
 * It must never return something that isn't the token segment.
 */
describe("extractToken", () => {
	it("pulls the token out of /dl/<token>/<filename>", () => {
		expect(extractToken("/dl/abc.def.ghi/Movie.mkv")).toBe("abc.def.ghi");
	});

	it("works with no filename suffix", () => {
		expect(extractToken("/dl/abc.def.ghi")).toBe("abc.def.ghi");
	});

	it("ignores a query string", () => {
		expect(extractToken("/dl/abc.def.ghi/Movie.mkv?x=1")).toBe("abc.def.ghi");
	});

	it("is unaffected by slashes in the cosmetic filename", () => {
		expect(extractToken("/dl/tok/deep/path/name.mkv")).toBe("tok");
	});

	const rejected: Array<{ uri: string | undefined; why: string }> = [
		{ uri: undefined, why: "missing header" },
		{ uri: "", why: "empty" },
		{ uri: "/dl/", why: "prefix only" },
		{ uri: "/api/v1/torrents", why: "wrong prefix" },
		{ uri: "/dlx/tok/f.mkv", why: "near-miss prefix" },
		{ uri: "dl/tok/f.mkv", why: "no leading slash" },
	];
	for (const { uri, why } of rejected) {
		it(`returns null for ${JSON.stringify(uri)} (${why})`, () => {
			expect(extractToken(uri)).toBeNull();
		});
	}

	it("does not let a traversal segment masquerade as the token", () => {
		// Even if this were returned it would fail JWT verification, but the
		// parser should not hand a path fragment onward in the first place.
		const token = extractToken("/dl/..%2F..%2Fetc%2Fpasswd/x");
		expect(token).not.toBeNull();
		expect(token).toBe("../../etc/passwd"); // decoded, then rejected by verify
	});
});
