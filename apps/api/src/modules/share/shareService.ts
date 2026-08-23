import { eq } from "drizzle-orm";
import { ErrorCode } from "@/common/models/errorCodes";
import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { db } from "@/db/client";
import { appSettings } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/modules/auth/authService";
import { fileRepository } from "@/modules/file/fileRepository";
import { torrentRepository } from "@/modules/torrent/torrentRepository";
import { newShareId } from "./shareId";
import { shareRepository } from "./shareRepository";
import { shareState } from "./shareState";

const DEFAULTS = { ttlHours: 168, maxBytesMultiplier: 5 };

async function shareDefaults() {
	try {
		const rows = await db.select().from(appSettings).where(eq(appSettings.key, "share.defaultTtlHours"));
		const ttl = Number(rows[0]?.value ?? DEFAULTS.ttlHours);
		const mult = await db.select().from(appSettings).where(eq(appSettings.key, "share.defaultMaxBytesMultiplier"));
		return {
			ttlHours: Number.isFinite(ttl) ? ttl : DEFAULTS.ttlHours,
			maxBytesMultiplier: Number(mult[0]?.value ?? DEFAULTS.maxBytesMultiplier) || DEFAULTS.maxBytesMultiplier,
		};
	} catch {
		return DEFAULTS;
	}
}

type ShareRow = Awaited<ReturnType<typeof shareRepository.findById>>;

/** Public shape. NEVER leaks password_hash — only whether one is set. */
export function toDto(row: NonNullable<ShareRow>) {
	const state = shareState(row);
	return {
		id: row.id,
		scope: row.scope,
		torrentId: row.torrentId,
		fileId: row.fileId,
		label: row.label,
		hasPassword: row.passwordHash !== null,
		allowStream: row.allowStream,
		allowDownload: row.allowDownload,
		maxBytes: row.maxBytes,
		bytesServed: row.bytesServed,
		requestCount: row.requestCount,
		expiresAt: row.expiresAt?.toISOString() ?? null,
		revokedAt: row.revokedAt?.toISOString() ?? null,
		lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/s/${row.id}`,
		state: state.active ? ("active" as const) : state.reason,
	};
}

export class ShareService {
	async create(
		input: {
			fileId?: string;
			torrentId?: string;
			label?: string;
			password?: string;
			expiresInHours?: number | null;
			maxBytes?: number | null;
			allowDownload?: boolean;
			allowStream?: boolean;
		},
		userId: string,
	) {
		const defaults = await shareDefaults();
		let sizeBytes = 0;

		if (input.fileId) {
			const row = await fileRepository.findWithTorrent(input.fileId);
			if (!row) {
				return ServiceResponse.failure("File not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
			}
			sizeBytes = row.file.sizeBytes;
		} else {
			const t = await torrentRepository.findById(input.torrentId as string);
			if (!t) {
				return ServiceResponse.failure("Torrent not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
			}
			sizeBytes = t.sizeBytes;
		}

		// `undefined` means "use the default"; explicit `null` means "no limit".
		const expiresAt =
			input.expiresInHours === null
				? null
				: new Date(Date.now() + (input.expiresInHours ?? defaults.ttlHours) * 3600_000);

		const maxBytes =
			input.maxBytes === null
				? null
				: (input.maxBytes ?? (sizeBytes > 0 ? sizeBytes * defaults.maxBytesMultiplier : null));

		const row = await shareRepository.create({
			id: newShareId(),
			scope: input.fileId ? "file" : "torrent",
			fileId: input.fileId ?? null,
			torrentId: input.torrentId ?? null,
			createdBy: userId,
			label: input.label ?? null,
			passwordHash: input.password ? await hashPassword(input.password) : null,
			allowDownload: input.allowDownload ?? true,
			allowStream: input.allowStream ?? true,
			expiresAt,
			maxBytes,
		});

		// The id is the secret. Log that a share exists, never which link it is.
		logger.info({ shareId: row.id, scope: row.scope, hasPassword: row.passwordHash !== null }, "share created");
		return ServiceResponse.success("Share created", toDto(row), 201);
	}

	async list(userId: string) {
		const rows = await shareRepository.listByOwner(userId);
		return ServiceResponse.success("Shares retrieved", rows.map(toDto));
	}

	async revoke(id: string, userId: string) {
		const [row] = await shareRepository.revoke(id, userId);
		if (!row) {
			// Already revoked, or not this user's — same answer either way.
			return ServiceResponse.failure("Share not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		logger.info({ shareId: id }, "share revoked");
		return ServiceResponse.success("Share revoked", toDto(row));
	}

	/** Public view for /s/<id>. Reveals nothing until the password is satisfied. */
	async publicView(id: string, unlocked: boolean) {
		const found = await shareRepository.findWithTarget(id);
		if (!found) {
			return ServiceResponse.failure("Share not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}

		const { share, file, torrent } = found;
		const state = shareState(share);

		if (!state.active) {
			const map = {
				revoked: ["This link has been revoked", "SHARE_REVOKED", ErrorCode.PERMISSION_DENIED],
				expired: ["This link has expired", "SHARE_EXPIRED", ErrorCode.RESOURCE_NOT_FOUND],
				quota: ["This link has reached its download limit", "SHARE_QUOTA_EXCEEDED", ErrorCode.SHARE_QUOTA_EXCEEDED],
			} as const;
			const [message, code, status] = map[state.reason];
			return ServiceResponse.failure(message, { state: state.reason }, status, code);
		}

		const locked = share.passwordHash !== null && !unlocked;

		return ServiceResponse.success("Share", {
			id: share.id,
			state: "active" as const,
			locked,
			// Name and size are withheld until unlocked — a password that still
			// reveals what is behind it is decoration.
			label: locked ? null : (share.label ?? file?.path.split("/").pop() ?? torrent?.name ?? null),
			name: locked ? null : (file?.path.split("/").pop() ?? torrent?.name ?? null),
			sizeBytes: locked ? null : (file?.sizeBytes ?? torrent?.sizeBytes ?? null),
			scope: share.scope,
			allowDownload: share.allowDownload,
			allowStream: share.allowStream,
			expiresAt: share.expiresAt?.toISOString() ?? null,
			bytesServed: share.bytesServed,
			maxBytes: share.maxBytes,
		});
	}

	async unlock(id: string, password: string) {
		const row = await shareRepository.findById(id);
		if (!row || row.passwordHash === null) {
			return ServiceResponse.failure("Share not found", null, ErrorCode.RESOURCE_NOT_FOUND, "RESOURCE_NOT_FOUND");
		}
		if (!shareState(row).active) {
			return ServiceResponse.failure(
				"This link is no longer active",
				null,
				ErrorCode.PERMISSION_DENIED,
				"SHARE_REVOKED",
			);
		}
		if (!(await verifyPassword(row.passwordHash, password))) {
			return ServiceResponse.failure(
				"Incorrect password",
				null,
				ErrorCode.PERMISSION_DENIED,
				"SHARE_PASSWORD_REQUIRED",
			);
		}
		return ServiceResponse.success("Unlocked", { id: row.id });
	}
}

export const shareService = new ShareService();
