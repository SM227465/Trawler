export const PIECE = { MISSING: 0, DOWNLOADING: 1, HAVE: 2 } as const;

export type PieceRle = Array<[state: number, count: number]>;

/**
 * Expands the run-length encoding into one state per canvas column.
 *
 * WORST-WINS, never an average. A 10,000-piece torrent drawn 1,200px wide packs
 * ~8 pieces per column; averaging would make a single missing piece invisible,
 * and a single missing piece is exactly what someone opens this view to find.
 */
export function bucketise(rle: PieceRle, total: number, columns: number): Uint8Array {
	const out = new Uint8Array(Math.max(0, columns)).fill(PIECE.HAVE);
	if (total <= 0 || columns <= 0) return out;

	let piece = 0;
	for (const [state, count] of rle) {
		if (count <= 0) continue;
		// The run covers pieces [piece, piece + count). Its column span is the
		// half-open interval mapped the same way — `ceil(end) - 1`, NOT
		// `floor(lastPiece)`. With more columns than pieces the floor form leaves
		// trailing columns unpainted: a 2-piece torrent with everything missing
		// rendered two-thirds red and one-third GREEN, because those columns kept
		// the default fill.
		const from = Math.floor((piece / total) * columns);
		const to = Math.min(columns - 1, Math.ceil(((piece + count) / total) * columns) - 1);
		for (let c = from; c <= to; c++) {
			// Lower number = worse state. A column is only "have" if every piece
			// mapped into it is.
			if (state < out[c]) out[c] = state;
		}
		piece += count;
	}
	return out;
}

export function countStates(rle: PieceRle) {
	return rle.reduce(
		(acc, [state, count]) => {
			if (state === PIECE.HAVE) acc.have += count;
			else if (state === PIECE.DOWNLOADING) acc.downloading += count;
			else acc.missing += count;
			return acc;
		},
		{ have: 0, downloading: 0, missing: 0 },
	);
}
