"use client";
import { useQuery } from "@tanstack/react-query";

/**
 * Subscribe to a cache entry that something ELSE writes — here, the SSE stream
 * pushing torrent state in via `setQueryData`. There is nothing to fetch, but a
 * component still needs to re-render when the entry changes.
 *
 * TanStack v5 requires a `queryFn` to EXIST even when `enabled: false`; omitting
 * it throws "No queryFn was passed as an option" at runtime rather than failing
 * the build. The function below never executes — `enabled: false` guarantees it
 * — it exists only to satisfy that contract.
 *
 * Keep `fallback` a module-level constant so the identity is stable.
 */
export function useCacheOnly<T>(queryKey: readonly unknown[], fallback: T): T {
	const { data } = useQuery<T>({
		queryKey,
		queryFn: () => fallback,
		enabled: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	return data ?? fallback;
}
