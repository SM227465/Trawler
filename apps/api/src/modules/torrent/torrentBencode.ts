import { createHash } from "node:crypto";

/**
 * Minimal bencode scanner — just enough to locate the `info` dictionary's exact
 * byte range inside a .torrent file. The v1 infohash is SHA-1 over those raw
 * bytes, so they must be sliced from the original buffer: re-encoding a decoded
 * structure would change key order and produce a different (wrong) hash.
 *
 * We do NOT decode the whole file into JS values. We only need spans.
 */

class Scanner {
	pos = 0;
	constructor(readonly buf: Buffer) {}

	byte() {
		return this.buf[this.pos];
	}

	/** Advances past one bencoded value and returns [start, end). */
	skipValue(): [number, number] {
		const start = this.pos;
		const c = String.fromCharCode(this.byte());

		if (c === "d" || c === "l") {
			this.pos++; // past 'd' | 'l'
			while (String.fromCharCode(this.byte()) !== "e") {
				if (this.pos >= this.buf.length) throw new Error("unterminated container");
				this.skipValue();
			}
			this.pos++; // past 'e'
			return [start, this.pos];
		}

		if (c === "i") {
			const end = this.buf.indexOf(0x65, this.pos); // 'e'
			if (end < 0) throw new Error("unterminated integer");
			this.pos = end + 1;
			return [start, this.pos];
		}

		if (c >= "0" && c <= "9") {
			const colon = this.buf.indexOf(0x3a, this.pos); // ':'
			if (colon < 0) throw new Error("malformed string length");
			const len = Number.parseInt(this.buf.subarray(this.pos, colon).toString("ascii"), 10);
			if (!Number.isFinite(len) || len < 0) throw new Error("bad string length");
			this.pos = colon + 1 + len;
			if (this.pos > this.buf.length) throw new Error("string overruns buffer");
			return [start, this.pos];
		}

		throw new Error(`unexpected bencode byte '${c}'`);
	}

	/** Reads a bencoded byte string and returns it. */
	readString(): Buffer {
		const [start, end] = this.skipValue();
		const colon = this.buf.indexOf(0x3a, start);
		return this.buf.subarray(colon + 1, end);
	}
}

export interface TorrentMeta {
	infoHash: string;
	name: string | null;
}

/** Throws on anything that is not a well-formed .torrent. */
export function parseTorrentFile(buf: Buffer): TorrentMeta {
	if (buf.length === 0 || String.fromCharCode(buf[0]) !== "d") {
		throw new Error("not a bencoded dictionary");
	}

	const s = new Scanner(buf);
	s.pos = 1; // into the root dict

	let infoSpan: [number, number] | null = null;

	while (s.pos < buf.length && String.fromCharCode(s.byte()) !== "e") {
		const key = s.readString().toString("utf8");
		const span = s.skipValue();
		if (key === "info") {
			infoSpan = span;
			break; // everything after `info` is irrelevant to the hash
		}
	}

	if (!infoSpan) throw new Error("no info dictionary");

	const infoHash = createHash("sha1").update(buf.subarray(infoSpan[0], infoSpan[1])).digest("hex");

	return { infoHash, name: readInfoName(buf, infoSpan) };
}

function readInfoName(buf: Buffer, [start, end]: [number, number]): string | null {
	try {
		const s = new Scanner(buf.subarray(start, end));
		s.pos = 1;
		while (s.pos < s.buf.length && String.fromCharCode(s.byte()) !== "e") {
			const key = s.readString().toString("utf8");
			if (key === "name") return s.readString().toString("utf8");
			s.skipValue();
		}
	} catch {
		/* name is a nicety — the hash is what matters */
	}
	return null;
}
