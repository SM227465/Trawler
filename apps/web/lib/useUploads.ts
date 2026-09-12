"use client";
import { useQuery } from "@tanstack/react-query";
import { api, type Upload } from "@/lib/api";

export const UPLOADS_KEY = ["uploads"];

/** Queued or running — the states that are still going to change. */
export const isLive = (u: Upload) => u.status === "running" || u.status === "queued";

/**
 * Every transfer the server remembers, shared by everything that shows them.
 *
 * One query key, so the header indicator, the Storage panel and the file
 * browser's badges are the same data on the same clock rather than three
 * pollers disagreeing with each other. Progress comes from rclone, so this is
 * the one place in the app that genuinely needs polling — and only while
 * something is actually moving.
 */
export function useUploads() {
	return useQuery({
		queryKey: UPLOADS_KEY,
		queryFn: api.uploads,
		refetchInterval: (q) => ((q.state.data ?? []).some(isLive) ? 2000 : false),
	});
}

/**
 * The latest transfer for each source path.
 *
 * The server returns recent transfers newest-first, so the first row seen for a
 * path is the current one. Restores are excluded: a file that came back down is
 * not a statement about what is on the remote.
 */
export function latestByPath(uploads: Upload[] | undefined): Map<string, Upload> {
	const byPath = new Map<string, Upload>();
	for (const u of uploads ?? []) {
		if (u.direction !== "up") continue;
		if (!byPath.has(u.srcPath)) byPath.set(u.srcPath, u);
	}
	return byPath;
}
