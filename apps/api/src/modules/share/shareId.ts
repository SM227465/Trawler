import { randomBytes } from "node:crypto";

/**
 * URL-safe opaque id, nanoid's alphabet and default length.
 *
 * Hand-rolled rather than pulling in `nanoid`: it is ten lines, `nanoid` v5 is
 * ESM-only and `tsx` emits CJS here (doc 03 §A11), and this way the alphabet is
 * ours to reason about — no look-alike characters to mis-transcribe over chat.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZabcdefghijkmnpqrstvwxyz";
const LENGTH = 16;

export function newShareId(length = LENGTH): string {
	// Rejection-free: 256 % 55 != 0 introduces a tiny bias, so mask to the next
	// power of two and resample instead.
	const mask = (1 << Math.ceil(Math.log2(ALPHABET.length))) - 1;
	let out = "";
	while (out.length < length) {
		for (const byte of randomBytes(length * 2)) {
			const idx = byte & mask;
			if (idx < ALPHABET.length) {
				out += ALPHABET[idx];
				if (out.length === length) break;
			}
		}
	}
	return out;
}

/** Cheap shape check before touching the database. */
export const isShareIdShape = (s: string) => s.length >= 8 && s.length <= 32 && /^[0-9A-Za-z]+$/.test(s);
