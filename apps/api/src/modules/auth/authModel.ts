import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export const PublicUserSchema = z.object({
	id: z.string().uuid(),
	email: z.string().email(),
	createdAt: z.date(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const LoginSchema = z.object({
	body: z.object({
		email: z.string().email().max(255),
		password: z.string().min(8).max(256),
	}),
});

export const AuthPayloadSchema = z.object({
	accessToken: z.string(),
	user: PublicUserSchema,
});
export type AuthPayload = z.infer<typeof AuthPayloadSchema>;
