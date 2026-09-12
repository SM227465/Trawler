import { afterEach, describe, expect, it, vi } from "vitest";
import { RcloneClient, RcloneError } from "../client";

/**
 * These sequences are transcripts, not inventions: they are what rclone
 * v1.75.1 actually answered over `config/create` with `nonInteractive` set.
 *
 * The bug they guard against is silent and expensive. Without `nonInteractive`
 * rclone ignores the token it is handed, starts a browser flow on a server
 * with no browser, and blocks until the request times out — which the UI can
 * only report as a provider that did not answer.
 */

type Step = { State: string; Option: null | { Name: string; DefaultStr?: string; Required?: boolean }; Error: string };

/** Replays a recorded conversation and records what we answered. */
function daemon(steps: Step[]) {
	const sent: Array<Record<string, unknown>> = [];
	let i = 0;
	vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
		sent.push(JSON.parse(init.body));
		const step = steps[i++];
		if (!step) throw new Error("rclone was called more times than the transcript has steps");
		return { ok: true, status: 200, text: async () => JSON.stringify({ ...step, Result: "" }) } as Response;
	});
	return sent;
}

const DONE: Step = { State: "", Option: null, Error: "" };
const token = '{"access_token":"fake","refresh_token":"fake"}';

afterEach(() => vi.unstubAllGlobals());

describe("createRemote", () => {
	it("keeps the token it was given instead of starting a browser flow", async () => {
		const sent = daemon([
			{
				State: "*oauth-confirm,teamdrive,oauth,",
				Option: { Name: "config_refresh_token", DefaultStr: "true" },
				Error: "",
			},
			{ State: "teamdrive_ok", Option: { Name: "config_change_team_drive", DefaultStr: "false" }, Error: "" },
			DONE,
		]);

		await new RcloneClient("http://rclone:5572").createRemote("gdrive", "drive", { token });

		// Yes to "Token already configured - replace it?" is what opens the browser.
		expect((sent[1].opt as Record<string, unknown>).result).toBe("false");
		// Everything else takes rclone's own default.
		expect((sent[2].opt as Record<string, unknown>).result).toBe("false");
		// Non-interactive on every call, or the daemon blocks on the first one.
		expect(sent.every((b) => (b.opt as Record<string, boolean>).nonInteractive)).toBe(true);
		expect(sent).toHaveLength(3);
	});

	it("finishes in one call for a backend that asks nothing", async () => {
		const sent = daemon([DONE]);
		await new RcloneClient("http://rclone:5572").createRemote("r2", "s3", { provider: "Cloudflare" });
		expect(sent).toHaveLength(1);
	});

	it("surfaces a step that failed rather than asked", async () => {
		daemon([
			{ State: "*oauth-confirm,choose_type,,", Option: { Name: "config_refresh_token" }, Error: "" },
			{ State: "driveid", Option: null, Error: "Failed to query available drives: HTTP error 401" },
		]);

		await expect(new RcloneClient("http://rclone:5572").createRemote("od", "onedrive", { token })).rejects.toThrow(
			/Failed to query available drives/,
		);
	});

	it("refuses a question it cannot answer rather than guessing", async () => {
		daemon([{ State: "somewhere", Option: { Name: "config_driveid", Required: true }, Error: "" }]);

		await expect(new RcloneClient("http://rclone:5572").createRemote("od", "onedrive", { token })).rejects.toThrow(
			RcloneError,
		);
	});

	it("gives up rather than looping forever", async () => {
		const asking: Step = { State: "round", Option: { Name: "whatever", DefaultStr: "x" }, Error: "" };
		const sent = daemon(Array.from({ length: 12 }, () => asking));

		await expect(new RcloneClient("http://rclone:5572").createRemote("x", "drive", { token })).rejects.toThrow(
			RcloneError,
		);
		expect(sent.length).toBeLessThanOrEqual(10);
	});
});
