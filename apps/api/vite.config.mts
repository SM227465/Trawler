import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

/**
 * Test environment.
 *
 * These used to come from a developer's untracked `apps/api/.env`, which meant
 * `pnpm test` failed on a fresh clone with an env-validation error and no clue
 * as to why. Defaults live here instead, so the suite is self-contained.
 *
 * Every value falls back to the real environment first, so CI (which provides a
 * throwaway Postgres service and its own secrets) overrides them untouched.
 *
 * The secrets below are deliberately fake and are never used against anything
 * real — they exist only to satisfy the zod schema at import time.
 */
const testEnv: Record<string, string> = {
	NODE_ENV: "test",
	DATABASE_URL: process.env.DATABASE_URL ?? "postgres://trawler:trawler@localhost:5432/trawler",
	JWT_SECRET: process.env.JWT_SECRET ?? "test-only-jwt-secret-not-real-at-all-32chars",
	REFRESH_SECRET: process.env.REFRESH_SECRET ?? "test-only-refresh-secret-not-real-32chars",
	OWNER_EMAIL: process.env.OWNER_EMAIL ?? "test@example.com",
	OWNER_PASSWORD: process.env.OWNER_PASSWORD ?? "test-password",
	DOWNLOADS_DIR: process.env.DOWNLOADS_DIR ?? "/downloads",
};

export default defineConfig({
	test: {
		env: testEnv,
		coverage: {
			exclude: ["**/node_modules/**", "**/index.ts, ", "vite.config.mts"],
		},
		globals: true,
		restoreMocks: true,
	},
	plugins: [tsconfigPaths()],
});
