import { logger } from "@/common/utils/logger";
import { storageService } from "@/modules/storage/storageService";

export async function evictHandler() {
	const result = await storageService.runEviction();

	if (result.deleted.length > 0) {
		logger.info(
			{
				count: result.deleted.length,
				freedBytes: result.freedBytes,
				usedPctBefore: result.usedPctBefore,
				usedPctAfter: result.usedPctAfter,
				reason: result.reason,
			},
			"eviction pass complete",
		);
	} else {
		logger.debug({ reason: result.reason }, "eviction pass — nothing deleted");
	}
}
