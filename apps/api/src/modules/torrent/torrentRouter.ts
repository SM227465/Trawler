import { OpenAPIRegistry } from "@asteasolutions/zod-to-openapi";
import express, { type Router } from "express";
import multer from "multer";
import { z } from "zod";
import { createApiResponse } from "@/api-docs/openAPIResponseBuilders";
import { requireAuth } from "@/common/middleware/requireAuth";
import { validateRequest } from "@/common/utils/httpHandlers";
import { torrentController } from "./torrentController";
import {
	AddTorrentSchema,
	BatchAddSchema,
	BatchResultSchema,
	DeleteTorrentSchema,
	ListTorrentsSchema,
	TorrentIdSchema,
	TorrentSchema,
} from "./torrentModel";

export const torrentRegistry = new OpenAPIRegistry();
export const torrentRouter: Router = express.Router();

// In-memory: a .torrent is metadata, never more than a few hundred KB.
const upload = multer({
	storage: multer.memoryStorage(),
	limits: { fileSize: 2 * 1024 * 1024, files: 20 },
	fileFilter: (_req, file, cb) => {
		const ok = file.mimetype === "application/x-bittorrent" || /\.torrent$/i.test(file.originalname);
		cb(null, ok);
	},
});

torrentRegistry.register("Torrent", TorrentSchema);

// Every route below is owner-only.
torrentRouter.use(requireAuth);

torrentRegistry.registerPath({
	method: "get",
	path: "/api/v1/torrents",
	tags: ["Torrent"],
	request: { query: ListTorrentsSchema.shape.query },
	responses: createApiResponse(z.array(TorrentSchema), "Success"),
});
torrentRouter.get("/", validateRequest(ListTorrentsSchema), torrentController.list);

torrentRegistry.registerPath({
	method: "post",
	path: "/api/v1/torrents",
	tags: ["Torrent"],
	request: { body: { content: { "application/json": { schema: AddTorrentSchema.shape.body } } } },
	responses: createApiResponse(TorrentSchema, "Created"),
});
torrentRouter.post("/", validateRequest(AddTorrentSchema), torrentController.add);

torrentRegistry.registerPath({
	method: "post",
	path: "/api/v1/torrents/file",
	tags: ["Torrent"],
	description: "Upload a .torrent file (multipart/form-data, field `torrent`).",
	request: {
		body: {
			content: {
				"multipart/form-data": {
					schema: z.object({ torrent: z.string().openapi({ type: "string", format: "binary" }) }),
				},
			},
		},
	},
	responses: createApiResponse(TorrentSchema, "Created"),
});
torrentRouter.post("/file", upload.single("torrent"), torrentController.addFile);

torrentRegistry.registerPath({
	method: "post",
	path: "/api/v1/torrents/batch",
	tags: ["Torrent"],
	description: "Add up to 50 magnets at once. Each item reports its own outcome.",
	request: {
		body: { content: { "application/json": { schema: z.object({ magnets: z.array(z.string()) }) } } },
	},
	responses: createApiResponse(BatchResultSchema, "Batch complete"),
});
torrentRouter.post("/batch", validateRequest(BatchAddSchema), torrentController.addBatch);

torrentRegistry.registerPath({
	method: "post",
	path: "/api/v1/torrents/files",
	tags: ["Torrent"],
	description: "Upload several .torrent files at once (field `torrents`).",
	responses: createApiResponse(BatchResultSchema, "Batch complete"),
});
torrentRouter.post("/files", upload.array("torrents", 20), torrentController.addFiles);

torrentRegistry.registerPath({
	method: "get",
	path: "/api/v1/torrents/{id}",
	tags: ["Torrent"],
	request: { params: TorrentIdSchema.shape.params },
	responses: createApiResponse(TorrentSchema, "Success"),
});
torrentRouter.get("/:id", validateRequest(TorrentIdSchema), torrentController.get);

torrentRegistry.registerPath({
	method: "get",
	path: "/api/v1/torrents/{id}/files",
	tags: ["Torrent"],
	request: { params: TorrentIdSchema.shape.params },
	responses: createApiResponse(z.array(z.object({}).passthrough()), "Success"),
});
torrentRouter.get("/:id/files", validateRequest(TorrentIdSchema), torrentController.files);

// Actions — POST, because CRUD verbs do not fit. Doc 03 §A5.
for (const [path, handler] of [
	["pause", torrentController.pause],
	["resume", torrentController.resume],
	["recheck", torrentController.recheck],
	["pin", torrentController.pin],
	["unpin", torrentController.unpin],
] as const) {
	torrentRegistry.registerPath({
		method: "post",
		path: `/api/v1/torrents/{id}/${path}`,
		tags: ["Torrent"],
		request: { params: TorrentIdSchema.shape.params },
		responses: createApiResponse(z.null(), "Success"),
	});
	torrentRouter.post(`/:id/${path}`, validateRequest(TorrentIdSchema), handler);
}

torrentRegistry.registerPath({
	method: "delete",
	path: "/api/v1/torrents/{id}",
	tags: ["Torrent"],
	request: { params: TorrentIdSchema.shape.params, query: DeleteTorrentSchema.shape.query },
	responses: createApiResponse(z.null(), "Deleted"),
});
torrentRouter.delete("/:id", validateRequest(DeleteTorrentSchema), torrentController.remove);
