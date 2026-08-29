import { describe, expect, it } from "vitest";
import { relativeDownloadPath } from "../storageService";

/**
 * The path handed to an upload before a torrent is deleted. Getting it wrong
 * either archives the wrong thing or skips archiving and deletes anyway, so it
 * refuses rather than guesses.
 */
describe("relativeDownloadPath", () => {
	it("strips the downloads root", () => {
		expect(relativeDownloadPath("/downloads/Big Buck Bunny")).toBe("Big Buck Bunny");
		expect(relativeDownloadPath("/downloads/Show/S01/ep1.mkv")).toBe("Show/S01/ep1.mkv");
	});

	it("refuses anything outside the root", () => {
		expect(relativeDownloadPath("/etc/passwd")).toBeNull();
		// The prefix matches as a string but is a different directory.
		expect(relativeDownloadPath("/downloads-evil/x")).toBeNull();
	});

	it("refuses the root itself, which would archive the entire library", () => {
		expect(relativeDownloadPath("/downloads")).toBeNull();
		expect(relativeDownloadPath("/downloads/")).toBeNull();
	});

	it("refuses a missing path rather than defaulting to something", () => {
		expect(relativeDownloadPath(null)).toBeNull();
	});
});
