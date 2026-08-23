import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { fileController } from "./fileController";
import { DownloadLinkSchema, FileIdParams, FileSchema, UpdateFileSchema } from "./fileModel";

export const fileRegistry = new OpenAPIRegistry();
export const fileRouter: Router = express.Router();

fileRegistry.register("File", FileSchema);
fileRegistry.register("DownloadLink", DownloadLinkSchema);

fileRouter.use(requireAuth);

fileRegistry.registerPath({
	method: "get",
	path: "/api/v1/files/browse",
	tags: ["File"],
	description: "List a directory under the downloads root. Path is containment- and symlink-checked.",
	request: { query: z.object({ path: z.string().optional() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Directory listing"),
});
fileRouter.get("/browse", fileController.browse);

fileRegistry.registerPath({
	method: "get",
	path: "/api/v1/files/browse/link",
	tags: ["File"],
	description: "Mint a download link for a browsed file.",
	request: { query: z.object({ path: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Link created"),
});
fileRouter.get("/browse/link", fileController.browseLink);

fileRegistry.registerPath({
	method: "get",
	path: "/api/v1/files/browse/zip-link",
	tags: ["File"],
	description: "Mint a streamed-zip link for a folder.",
	request: { query: z.object({ path: z.string() }) },
	responses: createApiResponse(z.object({}).passthrough(), "Link created"),
});
fileRouter.get("/browse/zip-link", fileController.browseZipLink);

fileRegistry.registerPath({
	method: "get",
	path: "/api/v1/files/{id}/link",
	tags: ["File"],
	description: "Mint a short-lived download URL served directly by Caddy.",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: createApiResponse(DownloadLinkSchema, "Link created"),
});
fileRouter.get("/:id/link", validateRequest(FileIdParams), fileController.getLink);

fileRegistry.registerPath({
	method: "patch",
	path: "/api/v1/files/{id}",
	tags: ["File"],
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: { content: { "application/json": { schema: z.object({ priority: z.number().int() }) } } },
	},
	responses: createApiResponse(FileSchema, "Updated"),
});
fileRouter.patch("/:id", validateRequest(UpdateFileSchema), fileController.update);
