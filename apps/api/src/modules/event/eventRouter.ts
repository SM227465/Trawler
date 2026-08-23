import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { qbtPoller } from "@/realtime/qbtPoller";
import { GLOBAL_CHANNEL, sseHub } from "@/realtime/sseHub";

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
