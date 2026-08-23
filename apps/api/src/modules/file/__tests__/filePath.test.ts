import { rm, symlink } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDownloadPath, resolveRealPath } from "../filePath";

/**
 * torrent_files.path comes from .torrent metadata, which is attacker-controlled.
 * These are the cases that must never produce a servable path.
 */
describe("resolveDownloadPath — containment", () => {
	it("accepts an ordinary nested file", () => {
		const r = resolveDownloadPath("Big Buck Bunny/Big Buck Bunny.mp4");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.absPath).toBe("/downloads/Big Buck Bunny/Big Buck Bunny.mp4");
	});

	it.each([
		["../etc/passwd", "parent traversal"],
		["../../../../etc/shadow", "deep traversal"],
		["Movie/../../etc/passwd", "traversal after a valid segment"],
		["/etc/passwd", "absolute path"],
		["/downloads/../etc/passwd", "absolute with traversal"],
		["", "empty"],
	])("rejects %s (%s)", (input) => {
		expect(resolveDownloadPath(input).ok).toBe(false);
	});

	it("rejects a NUL byte, which can truncate the path downstream", () => {
		expect(resolveDownloadPath("Movie.mp4\0.txt").ok).toBe(false);
	});

	it("rejects a sibling directory sharing the root's prefix", () => {
		// The classic startsWith() bug: "/downloads-evil" starts with "/downloads".
		expect(resolveDownloadPath("../downloads-evil/secret.txt").ok).toBe(false);
	});

	it("normalises harmless . segments rather than rejecting them", () => {
		const r = resolveDownloadPath("./Movie/./file.mkv");
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.absPath).toBe("/downloads/Movie/file.mkv");
	});
});

describe("resolveDownloadPath — accel URI", () => {
	it("percent-encodes spaces but keeps separators", () => {
		const r = resolveDownloadPath("Big Buck Bunny/Big Buck Bunny.mp4");
		expect(r.ok && r.accelPath).toBe("/Big%20Buck%20Bunny/Big%20Buck%20Bunny.mp4");
	});

	it("encodes characters that would otherwise change the URI's meaning", () => {
		const r = resolveDownloadPath("Show S01E01 [1080p]/ep #1 ?final.mkv");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.accelPath).not.toContain("#");
			expect(r.accelPath).not.toContain("?");
			expect(r.accelPath).toContain("%23");
			expect(r.accelPath).toContain("%3F");
		}
	});

	it("round-trips: decoding each segment returns the original", () => {
		const original = "Movie (2024) [x265]/Movie & Friends #2.mkv";
		const r = resolveDownloadPath(original);
		expect(r.ok).toBe(true);
		if (r.ok) {
			const decoded = r.accelPath.slice(1).split("/").map(decodeURIComponent).join("/");
			expect(decoded).toBe(original);
		}
	});
});

describe("resolveRealPath — symlink containment", () => {
	const root = "/downloads";
	const link = path.join(root, "vitest-escape-link");

	afterEach(async () => {
		await rm(link, { force: true });
	});

	it("refuses a symlink pointing outside the downloads root", async () => {
		try {
			await symlink("/etc", link);
		} catch {
			return; // /downloads not writable in this environment — skip
		}
		const r = await resolveRealPath("vitest-escape-link/passwd");
		expect(r.ok).toBe(false);
		if (!r.ok) expect(r.reason).toMatch(/symlink/);
	});

	it("still accepts an ordinary contained path", async () => {
		const r = await resolveRealPath("Some Folder/file.mkv");
		expect(r.ok).toBe(true);
	});

	it("rejects lexical traversal before ever touching the filesystem", async () => {
		const r = await resolveRealPath("../etc/passwd");
		expect(r.ok).toBe(false);
	});
});
