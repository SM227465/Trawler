import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { shareController } from "./shareController";
import { CreateShareSchema, ShareIdParams, ShareSchema, UnlockShareSchema } from "./shareModel";

export const shareRegistry = new OpenAPIRegistry();

/** Owner-only management. */
export const shareRouter: Router = express.Router();
shareRouter.use(requireAuth);

shareRegistry.register("Share", ShareSchema);

shareRegistry.registerPath({
	method: "get",
	path: "/api/v1/shares",
	tags: ["Share"],
	responses: createApiResponse(z.array(ShareSchema), "Shares"),
});
shareRouter.get("/", shareController.list);

shareRegistry.registerPath({
	method: "post",
	path: "/api/v1/shares",
	tags: ["Share"],
	description: "Create a revocable link to one file or a whole torrent.",
	request: { body: { content: { "application/json": { schema: ShareSchema.partial() } } } },
	responses: createApiResponse(ShareSchema, "Created"),
});
shareRouter.post("/", validateRequest(CreateShareSchema), shareController.create);

shareRegistry.registerPath({
	method: "delete",
	path: "/api/v1/shares/{id}",
	tags: ["Share"],
	description: "Revoke. The row is kept so the audit trail survives.",
	request: { params: z.object({ id: z.string() }) },
	responses: createApiResponse(ShareSchema, "Revoked"),
});
shareRegistry.registerPath({
	method: "delete",
	path: "/api/v1/shares/dead",
	tags: ["Share"],
	description:
		"Permanently delete every share that can no longer serve anything — revoked, expired, or over its byte cap. Their access history goes with them.",
	responses: createApiResponse(z.object({ removed: z.number() }), "Cleared"),
});
// Before /:id/access and /:id, or "dead" is parsed as a share id.
shareRouter.delete("/dead", shareController.clearDead);

shareRegistry.registerPath({
	method: "get",
	path: "/api/v1/shares/{id}/access",
	tags: ["Share"],
	description:
		"Access history for one share: counts per kind, distinct visitors, and the recent entries with IP, user agent and outcome.",
	request: { params: z.object({ id: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Share access"),
});
shareRouter.get("/:id/access", validateRequest(ShareIdParams), shareController.access);

shareRouter.delete("/:id", validateRequest(ShareIdParams), shareController.revoke);

/**
 * PUBLIC — no auth. Mounted separately so `requireAuth` above can never be
 * accidentally extended over it.
 */
export const publicShareRouter: Router = express.Router();

shareRegistry.registerPath({
	method: "get",
	path: "/api/v1/public/shares/{id}",
	tags: ["Share"],
	description: "What a visitor may see. Withholds name and size until unlocked.",
	request: { params: z.object({ id: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Share"),
});
publicShareRouter.get("/:id", validateRequest(ShareIdParams), shareController.publicView);

shareRegistry.registerPath({
	method: "post",
	path: "/api/v1/public/shares/{id}/unlock",
	tags: ["Share"],
	request: {
		params: z.object({ id: z.string() }),
		body: { content: { "application/json": { schema: z.object({ password: z.string() }) } } },
	},
	responses: createApiResponse(z.object({}).passthrough(), "Unlocked"),
});
publicShareRouter.post("/:id/unlock", validateRequest(UnlockShareSchema), shareController.unlock);
