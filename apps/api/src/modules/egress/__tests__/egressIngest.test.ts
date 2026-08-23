import { describe, expect, it } from "vitest";
import { shareIdFromUri } from "../egressIngest";

/**
 * Attributing bytes to the right bucket is the whole job. Mis-parsing here
 * either bills a share for owner traffic or loses share traffic entirely.
 */
describe("shareIdFromUri", () => {
	it("pulls a share id out of a /dl path", () => {
		expect(shareIdFromUri("/dl/K7ss6bK7dPDP507g/Movie.mp4")).toBe("K7ss6bK7dPDP507g");
	});

	it("pulls a share id out of a /zip path", () => {
		expect(shareIdFromUri("/zip/K7ss6bK7dPDP507g/Folder.zip")).toBe("K7ss6bK7dPDP507g");
	});

	it("ignores a query string", () => {
		expect(shareIdFromUri("/dl/K7ss6bK7dPDP507g/x.mp4?t=1")).toBe("K7ss6bK7dPDP507g");
	});

	it("returns null for an owner JWT download, not a bogus share id", () => {
		const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJmaWQiOiJhYmMifQ.c2lnbmF0dXJl";
		expect(shareIdFromUri(`/dl/${jwt}/Movie.mp4`)).toBeNull();
	});

	it.each(["/api/v1/torrents", "/", "/s/abc", "/webdav/x", undefined, ""])("returns null for %s", (uri) => {
		expect(shareIdFromUri(uri as string | undefined)).toBeNull();
	});

	it("returns null when the path has no token segment", () => {
		expect(shareIdFromUri("/dl/")).toBeNull();
	});
});
