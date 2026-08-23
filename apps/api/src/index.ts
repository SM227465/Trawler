import { env } from "@/common/utils/envConfig";
import { systemSampler } from "@/modules/system/systemSampler";
import { qbtPoller } from "@/realtime/qbtPoller";
import { sseHub } from "@/realtime/sseHub";
import { app, logger } from "@/server";

const server = app.listen(env.PORT, () => {
	const { NODE_ENV, HOST, PORT } = env;
	logger.info(`Server (${NODE_ENV}) running on port http://${HOST}:${PORT}`);
	// Realtime pollers run in the api process, not the worker — doc 01 §5.2.
	void qbtPoller.start();
	systemSampler.start();
});

const onCloseSignal = () => {
	logger.info("sigint received, shutting down");
	qbtPoller.stop();
	systemSampler.stop();
	sseHub.closeAll();
	server.close(() => {
		logger.info("server closed");
		process.exit();
	});
	setTimeout(() => process.exit(1), 10000).unref(); // Force shutdown after 10s
};

process.on("SIGINT", onCloseSignal);
process.on("SIGTERM", onCloseSignal);
