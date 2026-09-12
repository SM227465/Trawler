import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sizeOnDisk } from "../uploadService";

/**
 * This number decides whether a transfer is allowed to start, so it has to
 * match what rclone will actually move — over-counting refuses uploads that
 * would have fitted, and under-counting is how a 38 GB copy gets queued into a
 * 15 GB Drive.
 */
describe("sizeOnDisk", () => {
	let root: string;

	beforeAll(async () => {
		root = await mkdtemp(path.join(tmpdir(), "trawler-size-"));
		await writeFile(path.join(root, "a.bin"), Buffer.alloc(1000));
		await mkdir(path.join(root, "nested/deeper"), { recursive: true });
		await writeFile(path.join(root, "nested/b.bin"), Buffer.alloc(2000));
		await writeFile(path.join(root, "nested/deeper/c.bin"), Buffer.alloc(4000));
		// rclone does not follow these by default, so neither may we.
		await symlink(path.join(root, "a.bin"), path.join(root, "link.bin"));
	});

	afterAll(async () => {
		const { rm } = await import("node:fs/promises");
		await rm(root, { recursive: true, force: true });
	});

	it("sums a tree to every depth", async () => {
		expect(await sizeOnDisk(root)).toBe(7000);
	});

	it("measures a single file", async () => {
		expect(await sizeOnDisk(path.join(root, "nested/b.bin"))).toBe(2000);
	});

	it("counts a path that is gone as nothing rather than throwing", async () => {
		expect(await sizeOnDisk(path.join(root, "not-here"))).toBe(0);
	});
});
