import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { remoteController } from "./remoteController";
import { CreateOAuthRemoteSchema, CreateRemoteSchema, RemoteNameParams, RemoteSchema } from "./remoteModel";

export const remoteRegistry = new OpenAPIRegistry();
export const remoteRouter: Router = express.Router();

remoteRegistry.register("Remote", RemoteSchema);

remoteRouter.use(requireAuth);

remoteRegistry.registerPath({
	method: "get",
	path: "/api/v1/remotes",
	tags: ["Remote"],
	description:
		"External storage remotes. Config is returned with every secret-shaped field masked — the raw values are a working credential and are never sent to a client.",
	responses: createApiResponse(z.object({ available: z.boolean(), remotes: z.array(RemoteSchema) }), "Remotes"),
});
remoteRouter.get("/", remoteController.list);

remoteRegistry.registerPath({
	method: "post",
	path: "/api/v1/remotes",
	tags: ["Remote"],
	description:
		"Add a remote. The connection is tested before it is kept: a remote that cannot reach its bucket is rolled back rather than left looking configured.",
	request: { body: { content: { "application/json": { schema: CreateRemoteSchema.shape.body } } } },
	responses: createApiResponse(z.object({}).passthrough(), "Remote added"),
});
remoteRouter.post("/", validateRequest(CreateRemoteSchema), remoteController.create);

remoteRegistry.registerPath({
	method: "post",
	path: "/api/v1/remotes/oauth",
	tags: ["Remote"],
	description:
		"Add a Drive, OneDrive, Dropbox or pCloud remote from a token produced by `rclone authorize` on a machine with a browser. This server has none, so it cannot complete the round trip itself.",
	request: { body: { content: { "application/json": { schema: CreateOAuthRemoteSchema.shape.body } } } },
	responses: createApiResponse(z.object({}).passthrough(), "Remote added"),
});
// Before /:name/test, or "oauth" would be read as a remote name.
remoteRouter.post("/oauth", validateRequest(CreateOAuthRemoteSchema), remoteController.createOAuth);

remoteRegistry.registerPath({
	method: "post",
	path: "/api/v1/remotes/{name}/test",
	tags: ["Remote"],
	description: "Re-check that a remote still authenticates and its bucket still exists.",
	request: { params: z.object({ name: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Reachable"),
});
remoteRouter.post("/:name/test", validateRequest(RemoteNameParams), remoteController.test);

remoteRegistry.registerPath({
	method: "delete",
	path: "/api/v1/remotes/{name}",
	tags: ["Remote"],
	description:
		"Forget a remote. Nothing is deleted at the provider — this only removes the credentials and the link to it.",
	request: { params: z.object({ name: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Removed"),
});
remoteRouter.delete("/:name", validateRequest(RemoteNameParams), remoteController.remove);
