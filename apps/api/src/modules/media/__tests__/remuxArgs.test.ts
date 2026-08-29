import { describe, expect, it } from "vitest";
import { buildArgs } from "../remuxService";

/**
 * The argument order is the load-bearing part. Getting -ss on the wrong side of
 * -i turns an instant seek into minutes of decoding, and dropping -c:v copy
 * turns a rewrap into a re-encode this box cannot afford.
 */
describe("buildArgs", () => {
	it("never re-encodes video", () => {
		const args = buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac" });
		expect(args).toContain("-c:v");
		expect(args[args.indexOf("-c:v") + 1]).toBe("copy");
	});

	it("copies audio a browser already accepts", () => {
		const args = buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac" });
		expect(args[args.indexOf("-c:a") + 1]).toBe("copy");
	});

	it("re-encodes audio an MP4 cannot carry", () => {
		const args = buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "ac3" });
		expect(args[args.indexOf("-c:a") + 1]).toBe("aac");
	});

	it("puts -ss BEFORE -i so the seek is a read-head move, not a decode", () => {
		const args = buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac", startSeconds: 300 });
		expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"));
		expect(args[args.indexOf("-ss") + 1]).toBe("300");
	});

	it("omits -ss entirely when starting from the beginning", () => {
		expect(buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac", startSeconds: 0 })).not.toContain("-ss");
		expect(buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac" })).not.toContain("-ss");
	});

	it("produces a fragmented MP4, which is what streams without a length", () => {
		const args = buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac" });
		expect(args[args.indexOf("-movflags") + 1]).toContain("frag_keyframe");
		expect(args[args.indexOf("-movflags") + 1]).toContain("empty_moov");
	});

	it("drops subtitles, which would otherwise abort the mux", () => {
		expect(buildArgs({ absPath: "/downloads/a.mkv", audioCodec: "aac" })).toContain("-sn");
	});
});
