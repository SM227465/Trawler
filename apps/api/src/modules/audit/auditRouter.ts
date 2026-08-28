import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Request, type RequestHandler, type Response, type Router } from "express";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { handleServiceResponse } from "@/common/utils/httpHandlers";
import { audit } from "./auditService";

export const auditRegistry = new OpenAPIRegistry();
export const auditRouter: Router = express.Router();

auditRouter.use(requireAuth);

const num = (v: unknown): number | undefined => {
	const n = Number(v);
	return Number.isFinite(n) ? n : undefined;
};

const listAudit: RequestHandler = async (req: Request, res: Response) => {
	const page = await audit.list({
		limit: num(req.query.limit),
		before: num(req.query.before),
		// Anything unrecognised simply matches nothing rather than 400ing — the
		// filter is a convenience, not a contract worth failing a page load over.
		action: typeof req.query.action === "string" && req.query.action ? req.query.action : undefined,
	});
	handleServiceResponse(ServiceResponse.success("Audit entries", page), res);
};

auditRegistry.registerPath({
	method: "get",
	path: "/api/v1/audit",
	tags: ["Audit"],
	description:
		"Recent owner-initiated changes, newest first. Read-only: there is deliberately no way to edit or delete entries through the API — the nightly job prunes them at 30 days.",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(200).optional(),
			before: z.coerce.number().optional().describe("Keyset cursor: return entries with a lower id"),
			action: z.string().optional().describe("Exact action, e.g. auth.login_failed"),
		}),
	},
	responses: createApiResponse(
		z.object({ entries: z.array(z.object({}).passthrough()), nextCursor: z.number().nullable() }),
		"Audit entries",
	),
});
auditRouter.get("/", listAudit);

const listShares: RequestHandler = async (req: Request, res: Response) => {
	const page = await audit.listShareAccess({
		limit: num(req.query.limit),
		before: num(req.query.before),
		kind: typeof req.query.kind === "string" && req.query.kind ? req.query.kind : undefined,
	});
	handleServiceResponse(ServiceResponse.success("Share access", page), res);
};

auditRegistry.registerPath({
	method: "get",
	path: "/api/v1/audit/shares",
	tags: ["Audit"],
	description:
		"Access to share links across every share, newest first: kind, source address, user agent and outcome. Read-only; pruned at 30 days with the rest.",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(200).optional(),
			before: z.coerce.number().optional().describe("Keyset cursor: return entries with a lower id"),
			kind: z.enum(["view", "download", "denied", "unlock_failed"]).optional(),
		}),
	},
	responses: createApiResponse(
		z.object({ entries: z.array(z.object({}).passthrough()), nextCursor: z.number().nullable() }),
		"Share access",
	),
});
auditRouter.get("/shares", listShares);

const clearHandler =
	(target: "audit" | "shares"): RequestHandler =>
	async (req: Request, res: Response) => {
		const removed = await audit.clear(target);
		// Written after the delete, so it survives it. The trail can be emptied,
		// never silently emptied.
		audit.recordFromRequest(req, { action: "audit.clear", targetType: target, metadata: { removed } });
		handleServiceResponse(ServiceResponse.success("Cleared", { removed }), res);
	};

for (const [path, target] of [
	["/", "audit"],
	["/shares", "shares"],
] as const) {
	auditRegistry.registerPath({
		method: "delete",
		path: `/api/v1/audit${path === "/" ? "" : path}`,
		tags: ["Audit"],
		description: `Permanently delete every ${target === "shares" ? "share access" : "activity"} entry. The clear itself is recorded.`,
		responses: createApiResponse(z.object({ removed: z.number() }), "Cleared"),
	});
	auditRouter.delete(path, clearHandler(target));
}
