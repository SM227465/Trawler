import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { authController } from "./authController";
import { AuthPayloadSchema, LoginSchema, PublicUserSchema } from "./authModel";

export const authRegistry = new OpenAPIRegistry();
export const authRouter: Router = express.Router();

authRegistry.register("PublicUser", PublicUserSchema);

authRegistry.registerPath({
	method: "post",
	path: "/api/v1/auth/login",
	tags: ["Auth"],
	request: {
		body: { content: { "application/json": { schema: LoginSchema.shape.body } } },
	},
	responses: createApiResponse(AuthPayloadSchema, "Authenticated"),
});
authRouter.post("/login", validateRequest(LoginSchema), authController.login);

authRegistry.registerPath({
	method: "post",
	path: "/api/v1/auth/refresh",
	tags: ["Auth"],
	responses: createApiResponse(AuthPayloadSchema, "Rotated"),
});
authRouter.post("/refresh", authController.refresh);

authRegistry.registerPath({
	method: "post",
	path: "/api/v1/auth/logout",
	tags: ["Auth"],
	responses: createApiResponse(PublicUserSchema.nullable(), "Logged out"),
});
authRouter.post("/logout", authController.logout);

authRegistry.registerPath({
	method: "get",
	path: "/api/v1/auth/me",
	tags: ["Auth"],
	responses: createApiResponse(PublicUserSchema, "Current user"),
});
authRouter.get("/me", requireAuth, authController.me);
