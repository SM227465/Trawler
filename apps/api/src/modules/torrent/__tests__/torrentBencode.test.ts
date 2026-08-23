import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseTorrentFile } from "../torrentBencode";

/** Builds a minimal but structurally valid .torrent buffer. */
function makeTorrent(name: string, extra = ""): { buf: Buffer; expectedHash: string } {
	const info = `d6:lengthi1024e4:name${Buffer.byteLength(name)}:${name}12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae`;
	const body = `d8:announce20:http://tracker.test/${extra}4:info${info}e`;
	const buf = Buffer.from(body, "binary");
	const expectedHash = createHash("sha1").update(Buffer.from(info, "binary")).digest("hex");
	return { buf, expectedHash };
}

describe("parseTorrentFile", () => {
	it("computes the v1 infohash over the raw info-dict bytes", () => {
		const { buf, expectedHash } = makeTorrent("Example File.mkv");
		expect(parseTorrentFile(buf).infoHash).toBe(expectedHash);
	});

	it("extracts the display name", () => {
		const { buf } = makeTorrent("Example File.mkv");
		expect(parseTorrentFile(buf).name).toBe("Example File.mkv");
	});

	it("is unaffected by keys appearing before info", () => {
		const a = makeTorrent("Same.mkv");
		const b = makeTorrent("Same.mkv", "13:creation datei1700000000e");
		expect(parseTorrentFile(a.buf).infoHash).toBe(parseTorrentFile(b.buf).infoHash);
	});

	it("rejects non-bencode input", () => {
		expect(() => parseTorrentFile(Buffer.from("hello world"))).toThrow();
		expect(() => parseTorrentFile(Buffer.alloc(0))).toThrow();
	});

	it("rejects a bencoded dict with no info key", () => {
		expect(() => parseTorrentFile(Buffer.from("d8:announce5:helloe"))).toThrow(/no info dictionary/);
	});

	it("rejects a truncated file", () => {
		const { buf } = makeTorrent("Truncated.mkv");
		expect(() => parseTorrentFile(buf.subarray(0, buf.length - 12))).toThrow();
	});
});
