import { describe, expect, it } from "vitest";
import { ETA_UNKNOWN, mapState, normalizeEta, parseDisplayName, parseInfoHash } from "../torrentState";

describe("mapState", () => {
	it("maps v4 paused* and v5 stopped* to the same status", () => {
		// qBittorrent 5.0 renamed these. Both must work or an image bump
		// silently turns every paused torrent into "unknown".
		for (const s of ["pausedDL", "pausedUP", "stoppedDL", "stoppedUP"]) {
			expect(mapState(s), s).toBe("paused");
		}
	});

	it("treats seeding states as completed", () => {
		for (const s of ["uploading", "stalledUP", "queuedUP", "forcedUP"]) {
			expect(mapState(s), s).toBe("completed");
		}
	});

	it("treats metadata fetch and checking as downloading", () => {
		for (const s of ["metaDL", "forcedMetaDL", "stalledDL", "checkingDL", "checkingResumeData", "moving"]) {
			expect(mapState(s), s).toBe("downloading");
		}
	});

	it("maps error states", () => {
		expect(mapState("error")).toBe("errored");
		expect(mapState("missingFiles")).toBe("errored");
	});

	it("falls back to queued for unknown or missing", () => {
		expect(mapState(undefined)).toBe("queued");
		expect(mapState("somethingNew")).toBe("queued");
	});
});

describe("normalizeEta", () => {
	it("turns the 8640000 sentinel into null, not 100 days", () => {
		expect(normalizeEta(ETA_UNKNOWN)).toBeNull();
		expect(normalizeEta(ETA_UNKNOWN + 1)).toBeNull();
	});
	it("passes real values through", () => {
		expect(normalizeEta(722)).toBe(722);
		expect(normalizeEta(0)).toBe(0);
	});
	it("handles undefined", () => {
		expect(normalizeEta(undefined)).toBeNull();
	});
});

describe("parseInfoHash", () => {
	const hex = "dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c";

	it("reads a 40-char hex infohash", () => {
		expect(parseInfoHash(`magnet:?xt=urn:btih:${hex}&dn=x`)).toBe(hex);
	});

	it("lowercases", () => {
		expect(parseInfoHash(`magnet:?xt=urn:btih:${hex.toUpperCase()}`)).toBe(hex);
	});

	it("decodes a 32-char base32 infohash", () => {
		// base32 of the same 20 bytes — older trackers still emit this form.
		expect(parseInfoHash("magnet:?xt=urn:btih:3WBFL3G4PSSV7MF37AJSHWDQMLNR63I4")).toBe(hex);
	});

	it("returns null when there is no infohash", () => {
		expect(parseInfoHash("magnet:?dn=no-hash-here")).toBeNull();
		expect(parseInfoHash("not a magnet")).toBeNull();
	});
});

describe("parseDisplayName", () => {
	it("decodes percent- and plus-encoding", () => {
		expect(parseDisplayName("magnet:?xt=urn:btih:x&dn=Big+Buck+Bunny")).toBe("Big Buck Bunny");
		expect(parseDisplayName("magnet:?xt=urn:btih:x&dn=A%20B")).toBe("A B");
	});
	it("returns null when absent", () => {
		expect(parseDisplayName("magnet:?xt=urn:btih:x")).toBeNull();
	});
});
