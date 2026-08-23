import { StatusCodes } from "http-status-codes";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "@/server";

import { generateOpenAPIDocument } from "../openAPIDocumentGenerator";

/**
 * The docs used to be mounted at the ROOT with `swaggerUi.serve` on "/", which
 * made them a catch-all: every unmatched path returned 200 with Swagger HTML
 * instead of a 404, so a client could not tell "no such route" from success.
 * They now live under /docs, and unmatched paths 404 properly.
 */
describe("OpenAPI Router", () => {
	it("serves the spec at /docs/swagger.json", async () => {
		const response = await request(app).get("/docs/swagger.json");

		expect(response.status).toBe(StatusCodes.OK);
		expect(response.type).toBe("application/json");
		expect(response.body).toEqual(generateOpenAPIDocument());
	});

	it("serves the Swagger UI at /docs", async () => {
		const response = await request(app).get("/docs/");

		expect(response.status).toBe(StatusCodes.OK);
		expect(response.text).toContain("swagger-ui");
	});
});

describe("unmatched routes", () => {
	it("404 at the root, NOT the Swagger catch-all", async () => {
		const response = await request(app).get("/");
		expect(response.status).toBe(StatusCodes.NOT_FOUND);
		expect(response.text).not.toContain("swagger-ui");
	});

	it.each(["/api", "/api/v1/nope", "/zip/", "/definitely/not/a/route"])("404 for %s", async (path) => {
		const response = await request(app).get(path);
		expect(response.status).toBe(StatusCodes.NOT_FOUND);
		expect(response.body.code).toBe("RESOURCE_NOT_FOUND");
	});

	it("returns the standard envelope, not bare HTML", async () => {
		const response = await request(app).get("/api/v1/nope");
		expect(response.body).toMatchObject({ success: false, code: "RESOURCE_NOT_FOUND" });
	});
});
