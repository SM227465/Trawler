import { describe, expect, it } from "vitest";
import { rlePieces } from "../detailPoller";

/**
 * A 20 GB torrent has ~10,000 pieces. Sending that array every 2 s is what this
 * encoding exists to avoid, so the compression ratio is the point, not a detail.
 */
describe("rlePieces", () => {
	it("collapses a complete torrent to a single pair", () => {
		expect(rlePieces(Array(987).fill(2))).toEqual([[2, 987]]);
	});

	it("encodes runs in order", () => {
		expect(rlePieces([0, 0, 0, 1, 2, 2])).toEqual([
			[0, 3],
			[1, 1],
			[2, 2],
		]);
	});

	it("keeps single-piece runs distinct rather than merging neighbours", () => {
		expect(rlePieces([2, 0, 2])).toEqual([
			[2, 1],
			[0, 1],
			[2, 1],
		]);
	});

	it("handles an empty piece list", () => {
		expect(rlePieces([])).toEqual([]);
	});

	it("round-trips: expanding the encoding reproduces the input", () => {
		const input = [2, 2, 2, 0, 1, 1, 2, 0, 0, 0, 2];
		const expanded = rlePieces(input).flatMap(([state, count]) => Array(count).fill(state));
		expect(expanded).toEqual(input);
	});

	it("compresses a realistic mostly-done torrent to very few pairs", () => {
		// 10,000 pieces, one missing near the end — the case the doc calls out.
		const states = Array(10_000).fill(2);
		states[9_500] = 0;
		const rle = rlePieces(states);
		expect(rle).toEqual([
			[2, 9_500],
			[0, 1],
			[2, 499],
		]);
		// 10,000 numbers become 3 pairs.
		expect(rle.length).toBeLessThan(10);
	});
});
