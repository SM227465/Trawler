import { OpenAPIRegistry, OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { auditRegistry } from "@/modules/audit/auditRouter";
import { authRegistry } from "@/modules/auth/authRouter";
import { eventRegistry } from "@/modules/event/eventRouter";
import { fileRegistry } from "@/modules/file/fileRouter";
import { healthCheckRegistry } from "@/modules/healthCheck/healthCheckRouter";
import { remoteRegistry } from "@/modules/remote/remoteRouter";
import { settingsRegistry } from "@/modules/settings/settingsRouter";
import { shareRegistry } from "@/modules/share/shareRouter";
import { storageRegistry } from "@/modules/storage/storageRouter";
import { systemRegistry } from "@/modules/system/systemRouter";
import { torrentRegistry } from "@/modules/torrent/torrentRouter";

export type OpenAPIDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;

export function generateOpenAPIDocument(): OpenAPIDocument {
	const registry = new OpenAPIRegistry([
		healthCheckRegistry,
		auditRegistry,
		remoteRegistry,
		fileRegistry,
		authRegistry,
		torrentRegistry,
		eventRegistry,
	]);
	const generator = new OpenApiGeneratorV3(registry.definitions);

	return generator.generateDocument({
		openapi: "3.0.0",
		info: {
			version: "1.0.0",
			title: "Trawler API",
		},
		externalDocs: {
			description: "View the raw OpenAPI Specification in JSON format",
			url: "/swagger.json",
		},
	});
}
