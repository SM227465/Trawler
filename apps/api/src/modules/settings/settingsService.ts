import { ServiceResponse } from "@/common/models/serviceResponse";
import { env } from "@/common/utils/envConfig";
import { logger } from "@/common/utils/logger";
import { qbt } from "@/integrations/qbittorrent/client";

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

export class SettingsService {
	/**
	 * WebDAV credentials, for the owner's own file manager. Served only to an
	 * authenticated session; the UI keeps the password masked until asked.
	 * These are separate from the app login because WebDAV clients speak Basic
	 * auth, and this credential gets pasted into Finder and Explorer.
	 */
	getWebdav() {
		return ServiceResponse.success("WebDAV access", {
			enabled: env.WEBDAV_PASSWORD.length > 0,
			url: `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/webdav`,
			username: env.WEBDAV_USER,
			password: env.WEBDAV_PASSWORD,
			readOnly: true,
		});
	}

	async getTransfer() {
		const [limits, prefs] = await Promise.all([qbt.getTransferLimits(), qbt.getPreferences()]);

		return ServiceResponse.success("Transfer settings", {
			...limits,
			maxRatio: num(prefs.max_ratio, -1),
			maxRatioEnabled: bool(prefs.max_ratio_enabled, false),
			maxSeedingMinutes: num(prefs.max_seeding_time, -1),
			maxSeedingTimeEnabled: bool(prefs.max_seeding_time_enabled, false),
		});
	}

	async updateTransfer(patch: {
		dlLimitBps?: number;
		upLimitBps?: number;
		maxRatio?: number;
		maxRatioEnabled?: boolean;
		maxSeedingMinutes?: number;
		maxSeedingTimeEnabled?: boolean;
	}) {
		if (patch.dlLimitBps !== undefined || patch.upLimitBps !== undefined) {
			await qbt.setTransferLimits(patch);
		}

		// qBittorrent keeps ratio/seeding-time in preferences, not the transfer
		// API, so they need a second call with its own key names.
		const prefs: Record<string, unknown> = {};
		if (patch.maxRatio !== undefined) prefs.max_ratio = patch.maxRatio;
		if (patch.maxRatioEnabled !== undefined) prefs.max_ratio_enabled = patch.maxRatioEnabled;
		if (patch.maxSeedingMinutes !== undefined) prefs.max_seeding_time = patch.maxSeedingMinutes;
		if (patch.maxSeedingTimeEnabled !== undefined) prefs.max_seeding_time_enabled = patch.maxSeedingTimeEnabled;
		if (Object.keys(prefs).length > 0) await qbt.setPreferences(prefs);

		logger.info({ patch }, "transfer settings updated");
		return this.getTransfer();
	}
}

export const settingsService = new SettingsService();
