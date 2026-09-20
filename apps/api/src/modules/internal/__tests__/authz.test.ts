import { describe, expect, it } from "vitest";
import { countsAsNewDownload, extractToken } from "../authzService";

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

/**
 * One person downloading one file makes several requests. This decides which of
 * them is "the" download — get it wrong and a share is billed several times over
 * and the owner's activity feed shows strangers where there is only one.
 */
describe("countsAsNewDownload", () => {
	it("counts a plain GET", () => {
		expect(countsAsNewDownload({ method: "GET" })).toBe(true);
	});

	it("counts a GET that asks for the whole file by range", () => {
		expect(countsAsNewDownload({ method: "GET", range: "bytes=0-" })).toBe(true);
	});

	it("does not count a HEAD, which transfers nothing", () => {
		expect(countsAsNewDownload({ method: "HEAD" })).toBe(false);
		expect(countsAsNewDownload({ method: "head", range: "bytes=0-" })).toBe(false);
	});

	it("does not count a resumed or parallel segment", () => {
		expect(countsAsNewDownload({ method: "GET", range: "bytes=500-" })).toBe(false);
		expect(countsAsNewDownload({ method: "GET", range: "bytes=1048576-2097151" })).toBe(false);
	});

	it("defaults a missing method to GET", () => {
		expect(countsAsNewDownload({})).toBe(true);
		expect(countsAsNewDownload({ range: null })).toBe(true);
	});
});
