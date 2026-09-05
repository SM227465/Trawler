import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { uploadController } from "./uploadController";
import { CreateUploadSchema, UploadIdParams, UploadSchema } from "./uploadModel";

export const uploadRegistry = new OpenAPIRegistry();
export const uploadRouter: Router = express.Router();

uploadRegistry.register("Upload", UploadSchema);
uploadRouter.use(requireAuth);

uploadRegistry.registerPath({
	method: "get",
	path: "/api/v1/uploads",
	tags: ["Upload"],
	description:
		"Recent uploads. Progress for running transfers is read live from rclone rather than the database, which would otherwise take a write per second per transfer.",
	responses: createApiResponse(z.array(UploadSchema), "Uploads"),
});
uploadRouter.get("/", uploadController.list);

uploadRegistry.registerPath({
	method: "post",
	path: "/api/v1/uploads",
	tags: ["Upload"],
	description:
		"Copy a downloaded path to a configured remote. The path is containment- and symlink-checked exactly as browsing and downloading are.",
	request: { body: { content: { "application/json": { schema: CreateUploadSchema.shape.body } } } },
	responses: createApiResponse(UploadSchema, "Queued"),
});
uploadRouter.post("/", validateRequest(CreateUploadSchema), uploadController.create);

uploadRegistry.registerPath({
	method: "post",
	path: "/api/v1/uploads/{id}/retry",
	tags: ["Upload"],
	description:
		"Re-queue a failed transfer with the same source and destination. Recorded as a new row, so the failure stays in the history.",
	request: { params: z.object({ id: z.string() }) },
	responses: createApiResponse(UploadSchema, "Queued"),
});
uploadRouter.post("/:id/retry", validateRequest(UploadIdParams), uploadController.retry);

uploadRegistry.registerPath({
	method: "delete",
	path: "/api/v1/uploads/finished",
	tags: ["Upload"],
	description: "Remove completed, failed and cancelled rows from the list. Live transfers are untouched.",
	responses: createApiResponse(z.object({ removed: z.number() }), "Cleared"),
});
// Before /:id, or "finished" is parsed as an upload id.
uploadRouter.delete("/finished", uploadController.clear);

uploadRegistry.registerPath({
	method: "delete",
	path: "/api/v1/uploads/{id}",
	tags: ["Upload"],
	description:
		"Stop a transfer. Whatever already reached the remote is left there — this app does not delete data at a provider.",
	request: { params: z.object({ id: z.string() }) },
	responses: createApiResponse(UploadSchema, "Cancelled"),
});
uploadRouter.delete("/:id", validateRequest(UploadIdParams), uploadController.cancel);
