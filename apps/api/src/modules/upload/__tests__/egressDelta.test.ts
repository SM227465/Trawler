import { describe, expect, it } from "vitest";
import { egressDelta } from "../uploadService";

/**
 * This decides what the month's egress number says, and the number decides
 * whether share links get throttled. Charging twice for the same bytes is as
 * wrong as never charging for them.
 */
describe("egressDelta", () => {
	const up = (bytesDone: number) => ({ bytesDone, direction: "up" });

	it("charges only what moved since the last tick", () => {
		expect(egressDelta(up(4_000), 10_000)).toBe(6_000);
	});

	it("charges nothing when nothing moved", () => {
		expect(egressDelta(up(10_000), 10_000)).toBe(0);
	});

	it("never refunds when rclone forgets a group and reports zero", () => {
		// A restarted daemon loses its counters. That is a lost measurement, not
		// bytes coming back — and a negative would silently credit the month.
		expect(egressDelta(up(9_000), 0)).toBe(0);
	});

	it("ignores a restore, which is inbound and unmetered", () => {
		expect(egressDelta({ bytesDone: 0, direction: "down" }, 10_000)).toBe(0);
	});

	it("sums to the total across a whole transfer, not a multiple of it", () => {
		// Three ticks and a finish, each banking against the previous watermark.
		const ticks = [2_000, 5_000, 9_000, 12_000];
		let done = 0;
		let banked = 0;
		for (const bytes of ticks) {
			banked += egressDelta(up(done), bytes);
			done = bytes;
		}
		expect(banked).toBe(12_000);
	});
});
