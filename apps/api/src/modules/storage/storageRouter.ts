import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { storageController } from "./storageController";
import { EvictionSettingsSchema, StorageStatusSchema, UpdateSettingsSchema } from "./storageModel";

export const storageRegistry = new OpenAPIRegistry();
export const storageRouter: Router = express.Router();

storageRegistry.register("StorageStatus", StorageStatusSchema);
storageRouter.use(requireAuth);

storageRegistry.registerPath({
	method: "get",
	path: "/api/v1/storage",
	tags: ["Storage"],
	description: "Disk usage, eviction policy, and what the next pass would delete.",
	responses: createApiResponse(StorageStatusSchema, "Storage status"),
});
storageRouter.get("/", storageController.status);

storageRegistry.registerPath({
	method: "patch",
	path: "/api/v1/storage/settings",
	tags: ["Storage"],
	description: "Update the cleanup policy. Partial — send only what changes.",
	request: { body: { content: { "application/json": { schema: EvictionSettingsSchema.partial() } } } },
	responses: createApiResponse(EvictionSettingsSchema, "Settings updated"),
});
storageRouter.patch("/settings", validateRequest(UpdateSettingsSchema), storageController.updateSettings);

storageRegistry.registerPath({
	method: "post",
	path: "/api/v1/storage/evict",
	tags: ["Storage"],
	description: "Run an eviction pass now instead of waiting for the 5-minute schedule.",
	responses: createApiResponse(StorageStatusSchema, "Eviction complete"),
});
storageRouter.post("/evict", storageController.runEviction);
