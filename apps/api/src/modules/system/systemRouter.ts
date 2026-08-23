import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Request, type Response, type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { systemService } from "./systemService";

export const systemRegistry = new OpenAPIRegistry();
export const systemRouter: Router = express.Router();

systemRouter.use(requireAuth);

systemRegistry.registerPath({
	method: "get",
	path: "/api/v1/system",
	tags: ["System"],
	description: "Host, memory (cgroup-aware), disk and service health.",
	responses: createApiResponse(z.object({}).passthrough(), "System status"),
});
systemRouter.get("/", async (_req: Request, res: Response) => {
	handleServiceResponse(await systemService.getStatus(), res);
});
