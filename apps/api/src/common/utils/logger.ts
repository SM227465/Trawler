import { pino } from "pino";
import { env } from "@/common/utils/envConfig";

/**
 * Plain NDJSON — deliberately no `transport: pino-pretty`. That runs in a
 * worker thread via thread-stream, which crashes under `tsx --watch`
 * ("this should not happen: undefined") and takes the process with it.
 * For readable local logs: `pnpm start:dev | pnpm exec pino-pretty`.
 */
export const logger = pino({
	name: "cloud-torrent-api",
	level: env.isProduction ? "info" : "debug",
	// A magnet link reveals exactly what is being downloaded — it does not
	// belong in log storage. Doc 03 §A8.
	redact: {
		paths: [
			"req.headers.authorization",
			"req.headers.cookie",
			"res.headers['set-cookie']",
			"*.password",
			"*.passwordHash",
			"*.magnet",
			"*.accessToken",
			"magnet",
		],
		censor: "[redacted]",
	},
});
