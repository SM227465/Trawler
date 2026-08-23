import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { torrentRepository } from "@/modules/torrent/torrentRepository";
import { detailPoller } from "@/realtime/detailPoller";
import { qbtPoller } from "@/realtime/qbtPoller";
import { GLOBAL_CHANNEL, sseHub, torrentChannel } from "@/realtime/sseHub";

export const eventRegistry = new OpenAPIRegistry();
export const eventRouter: Router = express.Router();

eventRegistry.registerPath({
	method: "get",
	path: "/api/v1/events",
	tags: ["Events"],
	description: "SSE stream: `stats` (global), `torrents` (list deltas), `removed`.",
	responses: createApiResponse(z.null(), "text/event-stream"),
});

eventRouter.get("/", requireAuth, (req: Request, res: Response) => {
	const clientId = sseHub.add(res, GLOBAL_CHANNEL);

	// Seed the client with current state so it renders immediately instead of
	// waiting for something to change.
	const snapshot = qbtPoller.snapshot();
	res.write(`event: stats\ndata: ${JSON.stringify(snapshot.stats)}\n\n`);
	res.write(`event: torrents\ndata: ${JSON.stringify(snapshot.torrents)}\n\n`);

	req.on("close", () => sseHub.remove(clientId));
});

eventRegistry.registerPath({
	method: "get",
	path: "/api/v1/torrents/{id}/events",
	tags: ["Events"],
	description:
		"Per-torrent SSE: `properties`, `peers`, `trackers`, `pieces`. Polling for this torrent starts when the first client connects and stops when the last disconnects.",
	responses: createApiResponse(z.null(), "text/event-stream"),
});

/**
 * The subscription IS the URL (doc 04 §3.1). No subscribe/unsubscribe protocol:
 * opening this stream starts the per-torrent pollers, closing it stops them.
 */
export const torrentEventRouter: Router = express.Router({ mergeParams: true });

torrentEventRouter.get("/:id/events", requireAuth, async (req: Request, res: Response) => {
	const torrent = await torrentRepository.findById(req.params.id);
	if (!torrent) {
		res.status(404).end();
		return;
	}

	const channel = torrentChannel(torrent.id);
	const clientId = sseHub.add(res, channel);
	detailPoller.subscribe(torrent.id, torrent.infoHash);

	req.on("close", () => {
		sseHub.remove(clientId);
		// Last viewer out turns the lights off — otherwise four extra qBittorrent
		// endpoints keep being polled for a torrent nobody is watching.
		if (sseHub.countFor(channel) === 0) detailPoller.unsubscribe(torrent.id);
	});
});
