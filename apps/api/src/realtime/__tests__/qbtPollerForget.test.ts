import { describe, expect, it, vi } from "vitest";
import { qbtPoller } from "../qbtPoller";
import { GLOBAL_CHANNEL, sseHub } from "../sseHub";

/**
 * A removal has to reach clients WITH the torrent's id. The tick used to look
 * the id up after forgetting it, so every "removed" frame was empty and deleted
 * torrents stayed in other tabs' filter counts until a page reload.
 */
describe("qbtPoller.forget", () => {
	// `ids` (infohash → uuid) is private and normally filled from the database.
	const ids = (qbtPoller as unknown as { ids: Map<string, string> }).ids;

	it("tells clients which torrent went, once", () => {
		const broadcast = vi.spyOn(sseHub, "broadcast").mockImplementation(() => {});
		ids.set("abc123", "torrent-uuid");

		qbtPoller.forget("abc123");
		// The API deletes and forgets, then qBittorrent reports the same removal.
		qbtPoller.forget("abc123");

		expect(broadcast).toHaveBeenCalledTimes(1);
		expect(broadcast).toHaveBeenCalledWith(GLOBAL_CHANNEL, "removed", ["torrent-uuid"]);
	});

	it("stays quiet for a torrent it never knew", () => {
		const broadcast = vi.spyOn(sseHub, "broadcast").mockImplementation(() => {});
		qbtPoller.forget("never-seen");
		expect(broadcast).not.toHaveBeenCalled();
	});
});
