import express, { type Request, type Response, type Router } from "express";
import { logger } from "@/common/utils/logger";
import { verifyDownloadToken } from "@/modules/file/downloadToken";
import { resolveRealPath } from "@/modules/file/filePath";
import { fileRepository } from "@/modules/file/fileRepository";
import { isShareIdShape } from "@/modules/share/shareId";
import { shareRepository } from "@/modules/share/shareRepository";
import { isActive } from "@/modules/share/shareState";
import { mediaRepository } from "./mediaRepository";
import { streamRemux } from "./remuxService";

/**
 * `/remux/<token>/<name>.mp4` — a playable stream of a file a browser refuses.
 *
 * Mounted OUTSIDE /api/v1 and proxied straight through by Caddy, exactly like
 * /zip and for the same reason: the output does not exist on disk. It
 * authenticates by token alone, so the URL works in a <video> element without a
 * session, which is what makes it usable on the share page too.
 *
 * `?t=<seconds>` is how seeking works. A fragmented MP4 has no index, so the
 * browser cannot byte-range seek it — the player asks for a new stream starting
 * at the offset instead, and ffmpeg restarts there.
 */
export const remuxRouter: Router = express.Router();

remuxRouter.get("/:token/:name", async (req: Request, res: Response) => {
	const token = req.params.token;

	let relPath: string | null = null;
	let probe: { audioCodec: string | null; videoCodec: string | null } | undefined;

	// A SHARE ID, not a signed token. /dl accepts both because Caddy's
	// forward_auth resolves them, but this route is reached directly — so it has
	// to do the same job, or the share page's player 403s while its download
	// works. The share must be live and must actually permit streaming.
	if (isShareIdShape(token)) {
		const found = await shareRepository.findWithTarget(token);
		if (!found || !isActive(found.share) || !found.share.allowStream || !found.file) {
			logger.warn({ shareId: token }, "remux denied for share");
			return res.status(403).end();
		}
		if (!found.file.isComplete) return res.status(409).end();
		relPath = found.file.path;
		probe = await mediaRepository.byFileId(found.file.id);
	} else {
		const verified = await verifyDownloadToken(token);
		if (!verified.ok) {
			logger.warn({ expired: verified.expired }, "remux denied");
			return res.status(403).end();
		}

		const { claims } = verified;
		if (claims.fileId) {
			const row = await fileRepository.findWithTorrent(claims.fileId);
			if (!row) return res.status(404).end();
			relPath = row.file.path;
			probe = await mediaRepository.byFileId(claims.fileId);
		} else if (claims.filePath) {
			relPath = claims.filePath;
			// The file browser's links name a path, not a file id. Without the
			// probe behind it, HEVC went out unretagged (and Safari refused it)
			// and audio was re-encoded whether it needed it or not.
			const fileId = (await fileRepository.idsByPaths([claims.filePath])).get(claims.filePath);
			if (fileId) probe = await mediaRepository.byFileId(fileId);
		}
	}

	if (!relPath) return res.status(400).end();

	const resolved = await resolveRealPath(relPath);
	if (!resolved.ok) {
		logger.error({ reason: resolved.reason }, "remux refused a path outside the downloads root");
		return res.status(403).end();
	}

	const t = Number(req.query.t);
	await streamRemux(res, {
		absPath: resolved.absPath,
		startSeconds: Number.isFinite(t) && t > 0 ? t : undefined,
		audioCodec: probe?.audioCodec ?? null,
		videoCodec: probe?.videoCodec ?? null,
	});
});
