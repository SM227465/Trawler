import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { settingsController } from "./settingsController";
import { TransferSettingsSchema, UpdateTransferSchema } from "./settingsModel";

export const settingsRegistry = new OpenAPIRegistry();
export const settingsRouter: Router = express.Router();

settingsRegistry.register("TransferSettings", TransferSettingsSchema);
settingsRouter.use(requireAuth);

settingsRegistry.registerPath({
	method: "get",
	path: "/api/v1/settings/transfer",
	tags: ["Settings"],
	responses: createApiResponse(TransferSettingsSchema, "Transfer settings"),
});
settingsRouter.get("/transfer", settingsController.getTransfer);

settingsRegistry.registerPath({
	method: "get",
	path: "/api/v1/settings/webdav",
	tags: ["Settings"],
	description: "Read-only WebDAV endpoint and its credentials.",
	responses: createApiResponse(z.object({}).passthrough(), "WebDAV access"),
});
settingsRouter.get("/webdav", settingsController.getWebdav);

settingsRegistry.registerPath({
	method: "patch",
	path: "/api/v1/settings/transfer",
	tags: ["Settings"],
	description: "Global speed caps and seeding limits. Guards the Oracle egress allowance.",
	request: { body: { content: { "application/json": { schema: TransferSettingsSchema.partial() } } } },
	responses: createApiResponse(TransferSettingsSchema, "Updated"),
});
settingsRouter.patch("/transfer", validateRequest(UpdateTransferSchema), settingsController.updateTransfer);
